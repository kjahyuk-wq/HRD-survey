const questions = [
  'Q1. 교육 내용의 업무 역량 도움',
  'Q2. 강사 전문성 및 교수 능력',
  'Q3. 교육 일정 및 운영 방식',
  'Q4. 교육 시설 및 환경',
  'Q5. 동료 추천 의향',
];

function submitSurvey() {
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

  const avg = (answers.reduce((a, b) => a + b, 0) / answers.length).toFixed(1);
  const comment = document.getElementById('comment').value.trim();

  // 결과 요약 렌더링
  const summaryEl = document.getElementById('score-summary');
  summaryEl.innerHTML =
    questions.map((q, i) => `
      <div class="score-row">
        <span class="score-label">${q}</span>
        <span class="score-value">${answers[i]}점 ${'★'.repeat(answers[i])}${'☆'.repeat(5 - answers[i])}</span>
      </div>
    `).join('') +
    `<div class="score-avg"><span>평균 만족도</span><span>${avg} / 5.0</span></div>` +
    (comment ? `<div style="margin-top:0.8rem;font-size:0.85rem;color:#555;"><b>의견:</b> ${comment}</div>` : '');

  // 화면 전환
  document.getElementById('survey-form').style.display = 'none';
  const result = document.getElementById('result');
  result.style.display = 'block';
  result.scrollIntoView({ behavior: 'smooth' });
}

function resetSurvey() {
  document.querySelectorAll('input[type="radio"]').forEach(r => r.checked = false);
  document.getElementById('comment').value = '';
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('survey-form').style.display = 'block';
  document.getElementById('result').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
