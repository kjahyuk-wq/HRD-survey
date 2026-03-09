const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxUTvtAHRy8g1oSMlp3kJCEN6OUlhasmO1fR_9NWJQLPAJ3RCojRTyYXvKBJHVJI3hK/exec";

let selectedCourse = '';

// 페이지 로드 시 교육과정 목록 불러오기
window.addEventListener('DOMContentLoaded', loadCourses);

async function loadCourses() {
  try {
    const res = await fetch(SCRIPT_URL + '?action=courses');
    const courses = await res.json();

    document.getElementById('course-loading').style.display = 'none';

    if (!courses || courses.length === 0) {
      document.getElementById('course-empty').style.display = 'block';
      return;
    }

    const listEl = document.getElementById('course-list');
    listEl.style.display = 'grid';
    listEl.innerHTML = courses.map(name => `
      <div class="course-card" onclick="selectCourse(this, '${escapeAttr(name)}')">
        <div class="course-card-icon">📚</div>
        <div class="course-card-name">${name}</div>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('course-loading').textContent = '목록을 불러오지 못했습니다. 새로고침 해주세요.';
  }
}

function selectCourse(el, name) {
  document.querySelectorAll('.course-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedCourse = name;
  document.getElementById('course-selected-name').textContent = name;
  document.getElementById('course-selected-area').style.display = 'block';
  document.getElementById('course-selected-area').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function startSurvey() {
  if (!selectedCourse) return;
  document.getElementById('screen-course').style.display = 'none';
  document.getElementById('screen-survey').style.display = 'block';
  document.getElementById('survey-course-badge').textContent = selectedCourse;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToCourse() {
  document.getElementById('screen-survey').style.display = 'none';
  document.getElementById('screen-course').style.display = 'block';
  document.querySelectorAll('input[type="radio"]').forEach(r => r.checked = false);
  document.getElementById('comment').value = '';
  document.getElementById('error-msg').style.display = 'none';
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
  const btnText = document.getElementById('btn-text');
  btn.disabled = true;
  btnText.textContent = '제출 중...';

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course: selectedCourse,
        q1: answers[0], q2: answers[1], q3: answers[2],
        q4: answers[3], q5: answers[4],
        comment: document.getElementById('comment').value.trim()
      })
    });

    document.getElementById('screen-survey').style.display = 'none';
    document.getElementById('screen-result').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    btnText.textContent = '설문 제출하기';
    btn.disabled = false;
    alert('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
