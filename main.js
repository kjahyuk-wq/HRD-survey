const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxPs9zKMeSrAsHDFgXsBVRcntGPCvQA08Z6Y9xUFWmEN8EUgWiQNLulNt73AC7GwSmf/exec";

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
        q1: answers[0], q2: answers[1], q3: answers[2],
        q4: answers[3], q5: answers[4],
        comment: document.getElementById('comment').value.trim()
      })
    });

    document.getElementById('survey-form').style.display = 'none';
    const result = document.getElementById('result');
    result.style.display = 'block';
    result.scrollIntoView({ behavior: 'smooth' });

  } catch (e) {
    console.error(e);
    btnText.textContent = '설문 제출하기';
    btn.disabled = false;
    alert('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

window.submitSurvey = submitSurvey;
