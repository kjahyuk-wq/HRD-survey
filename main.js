const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzDbv0sR9TBZavmK01hkFB_Lz8uTHBYGkPMnvjaGxbtpqzb3RuBtNcr8PslpJVrliT-/exec";

let currentUser = { name: '', phone: '', course: '' };

async function doLogin() {
  const name = document.getElementById('input-name').value.trim();
  const phone = document.getElementById('input-phone').value.trim();
  const errEl = document.getElementById('login-error');

  if (!name) { showLoginError('이름을 입력해 주세요.'); return; }
  if (!/^\d{4}$/.test(phone)) { showLoginError('휴대폰 번호 뒷 4자리를 숫자로 입력해 주세요.'); return; }

  errEl.style.display = 'none';
  const btn = document.getElementById('login-btn');
  document.getElementById('login-btn-text').textContent = '확인 중...';
  btn.disabled = true;

  try {
    const res = await fetch(`${SCRIPT_URL}?action=login&name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}`);
    const data = await res.json();

    if (!data.found) {
      showLoginError('등록된 수강생 정보를 찾을 수 없습니다.\n담당자에게 문의해 주세요.');
      btn.disabled = false;
      document.getElementById('login-btn-text').textContent = '확인하기';
      return;
    }

    if (data.completed) {
      showLoginError('이미 설문에 참여하셨습니다. 감사합니다.');
      btn.disabled = false;
      document.getElementById('login-btn-text').textContent = '확인하기';
      return;
    }

    currentUser = { name, phone, course: data.course };

    document.getElementById('page-login').style.display = 'none';
    document.getElementById('page-survey').style.display = 'block';
    document.getElementById('confirm-greeting').textContent = `${name}님, 안녕하세요!`;
    document.getElementById('confirm-course-name').textContent = data.course;
    document.getElementById('screen-confirm').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (e) {
    showLoginError('오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    btn.disabled = false;
    document.getElementById('login-btn-text').textContent = '확인하기';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function startSurvey() {
  document.getElementById('screen-confirm').style.display = 'none';
  document.getElementById('screen-survey').style.display = 'block';
  document.getElementById('survey-course-badge').textContent = currentUser.course;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitSurvey() {
  const answers = [];
  for (let i = 1; i <= 5; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (!selected) {
      document.getElementById('error-msg').style.display = 'block';
      document.querySelector(`[data-question="${i}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    answers.push(parseInt(selected.value));
  }

  document.getElementById('error-msg').style.display = 'none';
  const btn = document.getElementById('submit-btn');
  document.getElementById('btn-text').textContent = '제출 중...';
  btn.disabled = true;

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: currentUser.name,
        phone: currentUser.phone,
        course: currentUser.course,
        q1: answers[0], q2: answers[1], q3: answers[2],
        q4: answers[3], q5: answers[4],
        comment: document.getElementById('comment').value.trim()
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
