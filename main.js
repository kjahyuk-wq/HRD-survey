let history = [];

function generateLotto() {
  const numbers = [];
  while (numbers.length < 6) {
    const n = Math.floor(Math.random() * 45) + 1;
    if (!numbers.includes(n)) numbers.push(n);
  }
  numbers.sort((a, b) => a - b);

  renderBalls(numbers);
  addHistory(numbers);
}

function getBallColor(n) {
  if (n <= 10) return '#fbc400';
  if (n <= 20) return '#69c8f2';
  if (n <= 30) return '#ff7272';
  if (n <= 40) return '#aaaaaa';
  return '#b0d840';
}

function renderBalls(numbers) {
  const container = document.getElementById('balls-container');
  container.innerHTML = '';
  numbers.forEach((n, i) => {
    const ball = document.createElement('div');
    ball.className = 'ball';
    ball.textContent = n;
    ball.style.backgroundColor = getBallColor(n);
    ball.style.animationDelay = `${i * 0.1}s`;
    container.appendChild(ball);
  });
}

function addHistory(numbers) {
  history.unshift(numbers);
  if (history.length > 5) history.pop();

  const container = document.getElementById('history');
  if (history.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = '<h3>최근 추첨 기록</h3>';
  history.forEach((nums, idx) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `<span class="history-index">${idx + 1}회</span>` +
      nums.map(n =>
        `<span class="history-ball" style="background:${getBallColor(n)}">${n}</span>`
      ).join('');
    container.appendChild(row);
  });
}
