const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxPs9zKMeSrAsHDFgXsBVRcntGPCvQA08Z6Y9xUFWmEN8EUgWiQNLulNt73AC7GwSmf/exec";

// ⚠️ 관리자 비밀번호 (변경 가능)
const ADMIN_PASSWORD = "hrd2024!";

const Q_LABELS = [
  'Q1. 교육 내용의 업무 역량 도움',
  'Q2. 강사 전문성 및 교수 능력',
  'Q3. 교육 일정 및 운영 방식',
  'Q4. 교육 시설 및 환경',
  'Q5. 동료 추천 의향',
];

function checkLogin() {
  const pw = document.getElementById('pw-input').value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadData();
  } else {
    document.getElementById('pw-error').style.display = 'block';
    document.getElementById('pw-input').value = '';
  }
}

function logout() {
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('pw-input').value = '';
}

async function loadData() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('stats-area').style.display = 'none';
  document.getElementById('no-data').style.display = 'none';

  try {
    const res = await fetch(SCRIPT_URL);
    const responses = await res.json();

    if (!responses || responses.length === 0) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('no-data').style.display = 'block';
      return;
    }

    renderStats(responses);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('stats-area').style.display = 'block';
  } catch (e) {
    console.error(e);
    document.getElementById('loading').textContent = '데이터를 불러오는 중 오류가 발생했습니다.';
  }
}

function renderStats(responses) {
  const n = responses.length;
  const keys = ['q1', 'q2', 'q3', 'q4', 'q5'];

  const avgs = keys.map(k => {
    const sum = responses.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
    return sum / n;
  });

  const overallAvg = avgs.reduce((a, b) => a + b, 0) / 5;
  const bestIdx = avgs.indexOf(Math.max(...avgs));
  const worstIdx = avgs.indexOf(Math.min(...avgs));

  document.getElementById('total-count').textContent = n + '명';
  document.getElementById('overall-avg').textContent = overallAvg.toFixed(2);
  document.getElementById('best-q').textContent = `Q${bestIdx + 1} (${avgs[bestIdx].toFixed(1)})`;
  document.getElementById('worst-q').textContent = `Q${worstIdx + 1} (${avgs[worstIdx].toFixed(1)})`;

  const qStatsEl = document.getElementById('question-stats');
  qStatsEl.innerHTML = avgs.map((avg, i) => {
    const pct = (avg / 5 * 100).toFixed(1);
    const color = avg >= 4.5 ? '#22c55e' : avg >= 3.5 ? '#0066cc' : avg >= 2.5 ? '#f59e0b' : '#ef4444';
    const dist = [1,2,3,4,5].map(v => responses.filter(r => Number(r[keys[i]]) === v).length);

    return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${Q_LABELS[i]}</span>
          <span class="q-stat-avg" style="color:${color}">${avg.toFixed(2)}점</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="dist-row">
          ${dist.map((cnt, j) => `
            <div class="dist-item">
              <div class="dist-bar-wrap">
                <div class="dist-bar" style="height:${n > 0 ? (cnt/n*60) : 0}px;background:${color}"></div>
              </div>
              <div class="dist-label">${j+1}점</div>
              <div class="dist-count">${cnt}명</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  const comments = responses.filter(r => r.comment && String(r.comment).trim());
  document.getElementById('comment-count').textContent = comments.length + '건';
  const commentsEl = document.getElementById('comments-list');
  if (comments.length === 0) {
    commentsEl.innerHTML = '<div class="no-comment">작성된 의견이 없습니다.</div>';
  } else {
    commentsEl.innerHTML = comments.map(r => `
      <div class="comment-item">
        <div class="comment-date">${formatDate(r.submittedAt)}</div>
        <div class="comment-text">${escapeHtml(String(r.comment))}</div>
      </div>
    `).join('');
  }

  const tbody = document.getElementById('responses-body');
  tbody.innerHTML = [...responses].reverse().map(r => {
    const scores = keys.map(k => Number(r[k]) || 0);
    const avg = (scores.reduce((a,b) => a+b, 0) / 5).toFixed(1);
    return `
      <tr>
        <td>${formatDate(r.submittedAt)}</td>
        ${scores.map(s => `<td class="score-cell score-${s}">${s}</td>`).join('')}
        <td class="avg-cell">${avg}</td>
      </tr>
    `;
  }).join('');
}

function formatDate(val) {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.checkLogin = checkLogin;
window.logout = logout;
window.loadData = loadData;
