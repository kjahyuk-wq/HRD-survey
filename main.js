const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwgGfRVw9M7UOl8MGYy2k3b-TM82iql90kGW7NOU6RNde6-DjcAAic_aORyFoRAjbgi/exec";

let currentUser = { name: '', empNo: '', course: '', instructors: [] };
let instructorFetchPromise = null;

async function doLogin() {
  const name = document.getElementById('input-name').value.trim();
  const empNo = document.getElementById('input-empno').value.trim();

  if (!name) { showLoginError('이름을 입력해 주세요.'); return; }
  if (!/^\d+$/.test(empNo) || parseInt(empNo) < 1) { showLoginError('교번을 올바르게 입력해 주세요. (1 이상의 숫자)'); return; }

  document.getElementById('login-error').style.display = 'none';
  const btn = document.getElementById('login-btn');
  document.getElementById('login-btn-text').textContent = '확인 중...';
  btn.disabled = true;

  try {
    const res = await fetch(`${SCRIPT_URL}?action=login&name=${encodeURIComponent(name)}&empNo=${encodeURIComponent(empNo)}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { showLoginError('서버 연결에 문제가 발생했습니다.\n잠시 후 다시 시도해 주세요.'); reset(); return; }

    if (!data.found) {
      showLoginError('등록된 수강생 정보를 찾을 수 없습니다.\n이름 또는 교번을 확인하거나 담당자에게 문의해 주세요.');
      reset(); return;
    }
    if (data.completed) {
      showLoginError('이미 설문에 참여하셨습니다.\n감사합니다!');
      reset(); return;
    }

    currentUser = { name, empNo, course: data.course, instructors: [] };

    // 강사 목록 fetch 완료 후 화면 표시
    instructorFetchPromise = fetch(`${SCRIPT_URL}?action=instructors&course=${encodeURIComponent(data.course)}`)
      .then(r => r.json())
      .then(list => {
        const instructors = Array.isArray(list) ? list : [];
        currentUser.instructors = instructors;
      })
      .catch(() => { currentUser.instructors = []; });

    await instructorFetchPromise;

    document.getElementById('page-login').style.display = 'none';
    document.getElementById('page-survey').style.display = 'block';
    document.getElementById('confirm-greeting').textContent = `${name}님, 안녕하세요!`;
    document.getElementById('confirm-course-name').textContent = data.course;
    updateSurveyMeta(currentUser.instructors.length);
    document.getElementById('screen-confirm').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (e) {
    showLoginError('네트워크 오류가 발생했습니다.\n인터넷 연결을 확인 후 다시 시도해 주세요.');
    reset();
  }

  function reset() {
    btn.disabled = false;
    document.getElementById('login-btn-text').textContent = '확인하기';
  }
}

function updateSurveyMeta(instructorCount) {
  const totalQ = 19 + instructorCount; // Q1~Q16 고정(16문항) + 강사문항 + 주관식 3문항
  const mins = Math.max(3, Math.round(totalQ * 0.4));
  document.getElementById('survey-q-count').textContent = `총 ${totalQ}문항`;
  document.getElementById('survey-time').textContent = `약 ${mins}분`;
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function startSurvey() {
  document.getElementById('screen-confirm').style.display = 'none';
  document.getElementById('screen-survey').style.display = 'block';

  const badge = document.getElementById('survey-course-badge');
  badge.textContent = currentUser.course;
  badge.style.display = 'inline-block';

  // 미리 시작한 fetch가 아직 진행 중이면 완료될 때까지 대기
  if (instructorFetchPromise) await instructorFetchPromise;

  // 강사 문항 동적 생성
  renderInstructorQuestions(currentUser.instructors);
  updateSurveyMeta(currentUser.instructors.length);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderInstructorQuestions(instructors) {
  const container = document.getElementById('instructor-questions');
  if (!instructors || instructors.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = instructors.map((inst, idx) => {
    const qNum = 17 + idx;
    const inputName = `instructor_${idx}`;
    const instName = typeof inst === 'string' ? inst : inst.name;
    const edu = typeof inst === 'string' ? '' : inst.education;
    const label = edu
      ? `[${escapeHtml(edu)}] ${escapeHtml(instName)} 강사의 강의 만족도는 어떠셨습니까?`
      : `${escapeHtml(instName)} 강사의 강의 만족도는 어떠셨습니까?`;
    return `
      <div class="q-card">
        <div class="q-num">Q${qNum}</div>
        <div class="q-txt">${label}</div>
        <div class="rating-group" data-question="${qNum}">
          ${[1,2,3,4,5].map((v, i) => {
            const labels = ['매우 불만족','불만족','보통','만족','매우 만족'];
            return `<label class="rating-label">
              <input type="radio" name="${inputName}" value="${v}">
              <span class="rating-btn">${v}<br><small>${labels[i]}</small></span>
            </label>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

async function submitSurvey() {
  // Q1-Q9 리커트 수집
  const answers = [];
  for (let i = 1; i <= 9; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (!selected) {
      document.getElementById('error-msg').style.display = 'block';
      document.querySelector(`[data-question="${i}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    answers.push(parseInt(selected.value));
  }

  // Q10 주관식 (선택)
  const q10Comment = document.getElementById('q10-comment').value.trim();

  // Q11-Q16 인구통계 수집 (필수)
  const demographics = {};
  for (let i = 11; i <= 16; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (!selected) {
      document.getElementById('error-msg').style.display = 'block';
      document.querySelector(`[data-question="${i}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    demographics[`q${i}`] = selected.value;
  }

  // 강사 평가 수집
  const instructorScores = {};
  for (let idx = 0; idx < currentUser.instructors.length; idx++) {
    const selected = document.querySelector(`input[name="instructor_${idx}"]:checked`);
    if (!selected) {
      document.getElementById('error-msg').style.display = 'block';
      document.querySelector(`[data-question="${17 + idx}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const inst = currentUser.instructors[idx];
    const instName = typeof inst === 'string' ? inst : inst.name;
    const edu = typeof inst === 'string' ? '' : inst.education;
    const key = edu ? `${edu}__${instName}` : instName;
    instructorScores[key] = parseInt(selected.value);
  }

  // 후반 주관식 3문항 (선택)
  const comment1 = document.getElementById('comment1').value.trim();
  const comment2 = document.getElementById('comment2').value.trim();
  const comment3 = document.getElementById('comment3').value.trim();

  document.getElementById('error-msg').style.display = 'none';
  const btn = document.getElementById('submit-btn');
  document.getElementById('btn-text').textContent = '제출 중...';
  btn.disabled = true;

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: currentUser.name, empNo: currentUser.empNo, course: currentUser.course,
        q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4],
        q6: answers[5], q7: answers[6], q8: answers[7], q9: answers[8],
        q10_comment: q10Comment,
        q11: demographics.q11, q12: demographics.q12, q13: demographics.q13,
        q14: demographics.q14, q15: demographics.q15, q16: demographics.q16,
        instructors: instructorScores,
        comment1, comment2, comment3
      })
    });
    document.getElementById('screen-survey').style.display = 'none';
    document.getElementById('screen-result').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    document.getElementById('btn-text').textContent = '설문 제출하기';
    btn.disabled = false;
    alert('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
