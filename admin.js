const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxUTvtAHRy8g1oSMlp3kJCEN6OUlhasmO1fR_9NWJQLPAJ3RCojRTyYXvKBJHVJI3hK/exec";
const ADMIN_PASSWORD = "hrd2024!";

const Q_LABELS = [
  'Q1. 교육 내용의 업무 역량 도움',
  'Q2. 강사 전문성 및 교수 능력',
  'Q3. 교육 일정 및 운영 방식',
  'Q4. 교육 시설 및 환경',
  'Q5. 동료 추천 의향',
];

// ── 로그인 ──────────────────────────────
function checkLogin() {
  const pw = document.getElementById('pw-input').value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadCourseList();
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

// ── 탭 전환 ──────────────────────────────
function switchTab(tab) {
  document.getElementById('tab-courses').style.display = tab === 'courses' ? 'block' : 'none';
  document.getElementById('tab-stats').style.display = tab === 'stats' ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0) === (tab === 'courses'));
  });
  if (tab === 'stats') populateStatsSelect();
}

// ── 교육과정 관리 ──────────────────────────────
async function loadCourseList() {
  document.getElementById('course-manage-loading').style.display = 'block';
  document.getElementById('course-manage-list').innerHTML = '';
  document.getElementById('course-manage-empty').style.display = 'none';

  try {
    const res = await fetch(SCRIPT_URL + '?action=courses');
    const courses = await res.json();
    document.getElementById('course-manage-loading').style.display = 'none';
    document.getElementById('course-count').textContent = courses.length + '개';

    if (!courses.length) {
      document.getElementById('course-manage-empty').style.display = 'block';
      return;
    }

    document.getElementById('course-manage-list').innerHTML = courses.map(name => `
      <div class="course-manage-item">
        <span class="course-manage-name">📚 ${name}</span>
        <button class="delete-btn" onclick="deleteCourse('${escapeAttr(name)}', this)">삭제</button>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('course-manage-loading').textContent = '불러오기 실패';
  }
}

async function addCourse() {
  const input = document.getElementById('new-course-input');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const btn = document.querySelector('.add-btn');
  btn.disabled = true;
  btn.textContent = '추가 중...';

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addCourse', name })
    });
    input.value = '';
    await new Promise(r => setTimeout(r, 800));
    await loadCourseList();
  } catch (e) {
    alert('추가 중 오류가 발생했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '+ 추가';
  }
}

async function deleteCourse(name, btnEl) {
  if (!confirm(`"${name}" 과정을 삭제하시겠습니까?\n(기존 설문 데이터는 유지됩니다)`)) return;

  btnEl.disabled = true;
  btnEl.textContent = '삭제 중...';

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteCourse', name })
    });
    await new Promise(r => setTimeout(r, 800));
    await loadCourseList();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    btnEl.disabled = false;
    btnEl.textContent = '삭제';
  }
}

// ── 통계 ──────────────────────────────
async function populateStatsSelect() {
  try {
    const res = await fetch(SCRIPT_URL + '?action=courses');
    const courses = await res.json();
    const sel = document.getElementById('stats-course-select');
    sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
      courses.map(c => `<option value="${escapeAttr(c)}">${c}</option>`).join('');
  } catch (e) {}
}

async function loadStats() {
  const course = document.getElementById('stats-course-select').value;
  if (!course) return;

  document.getElementById('stats-placeholder').style.display = 'none';
  document.getElementById('stats-loading').style.display = 'block';
  document.getElementById('stats-area').style.display = 'none';
  document.getElementById('stats-no-data').style.display = 'none';

  try {
    const res = await fetch(`${SCRIPT_URL}?action=responses&course=${encodeURIComponent(course)}`);
    const responses = await res.json();
    document.getElementById('stats-loading').style.display = 'none';

    if (!responses || responses.length === 0) {
      document.getElementById('stats-no-data').style.display = 'block';
      return;
    }

    renderStats(responses);
    document.getElementById('stats-area').style.display = 'block';
  } catch (e) {
    document.getElementById('stats-loading').textContent = '데이터를 불러오지 못했습니다.';
  }
}

function renderStats(responses) {
  const n = responses.length;
  const keys = ['q1', 'q2', 'q3', 'q4', 'q5'];

  const avgs = keys.map(k => responses.reduce((acc, r) => acc + (Number(r[k]) || 0), 0) / n);
  const overallAvg = avgs.reduce((a, b) => a + b, 0) / 5;
  const bestIdx = avgs.indexOf(Math.max(...avgs));
  const worstIdx = avgs.indexOf(Math.min(...avgs));

  document.getElementById('total-count').textContent = n + '명';
  document.getElementById('overall-avg').textContent = overallAvg.toFixed(2);
  document.getElementById('best-q').textContent = `Q${bestIdx + 1} (${avgs[bestIdx].toFixed(1)})`;
  document.getElementById('worst-q').textContent = `Q${worstIdx + 1} (${avgs[worstIdx].toFixed(1)})`;

  document.getElementById('question-stats').innerHTML = avgs.map((avg, i) => {
    const pct = (avg / 5 * 100).toFixed(1);
    const color = avg >= 4.5 ? '#22c55e' : avg >= 3.5 ? '#0066cc' : avg >= 2.5 ? '#f59e0b' : '#ef4444';
    const dist = [1,2,3,4,5].map(v => responses.filter(r => Number(r[keys[i]]) === v).length);
    return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${Q_LABELS[i]}</span>
          <span class="q-stat-avg" style="color:${color}">${avg.toFixed(2)}점</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="dist-row">
          ${dist.map((cnt, j) => `
            <div class="dist-item">
              <div class="dist-bar-wrap"><div class="dist-bar" style="height:${n>0?(cnt/n*60):0}px;background:${color}"></div></div>
              <div class="dist-label">${j+1}점</div>
              <div class="dist-count">${cnt}명</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }).join('');

  const comments = responses.filter(r => r.comment && String(r.comment).trim());
  document.getElementById('comment-count').textContent = comments.length + '건';
  document.getElementById('comments-list').innerHTML = comments.length
    ? comments.map(r => `
        <div class="comment-item">
          <div class="comment-date">${formatDate(r.submittedAt)}</div>
          <div class="comment-text">${escapeHtml(String(r.comment))}</div>
        </div>`).join('')
    : '<div class="no-comment">작성된 의견이 없습니다.</div>';

  document.getElementById('responses-body').innerHTML = [...responses].reverse().map(r => {
    const scores = keys.map(k => Number(r[k]) || 0);
    const avg = (scores.reduce((a,b) => a+b, 0) / 5).toFixed(1);
    return `<tr>
      <td>${formatDate(r.submittedAt)}</td>
      ${scores.map(s => `<td class="score-cell score-${s}">${s}</td>`).join('')}
      <td class="avg-cell">${avg}</td>
    </tr>`;
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

function escapeAttr(str) {
  return String(str).replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

window.checkLogin = checkLogin;
window.logout = logout;
window.switchTab = switchTab;
window.addCourse = addCourse;
window.deleteCourse = deleteCourse;
window.loadStats = loadStats;
