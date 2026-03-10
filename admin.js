const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwLF8v4YMXcd-d8uKuX4_cx48kA0cRFvBkGKyeS3X4XqoAPrm9jSfLTJ58GQl8v1AAE/exec";
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
    } else {
      document.getElementById('course-manage-list').innerHTML = courses.map((name, idx) => `
        <div class="course-manage-item" id="course-item-${idx}">
          <div class="course-manage-row">
            <span class="course-manage-name">📚 ${name}</span>
            <div class="course-manage-actions">
              <button class="instructor-btn" onclick="toggleInstructors('${escapeAttr(name)}', ${idx})">👨‍🏫 강사 관리</button>
              <button class="delete-btn" onclick="deleteCourse('${escapeAttr(name)}', this)">삭제</button>
            </div>
          </div>
          <div class="instructor-panel" id="inst-panel-${idx}" style="display:none;"></div>
        </div>`).join('');
    }

    // 수강생 관리 드롭다운 업데이트
    const sel = document.getElementById('student-course-select');
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
      courses.map(c => `<option value="${escapeAttr(c)}">${c}</option>`).join('');
    if (prev) sel.value = prev;

  } catch (e) {
    document.getElementById('course-manage-loading').textContent = '불러오기 실패';
  }
}

async function addCourse() {
  const input = document.getElementById('new-course-input');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const btn = document.querySelector('.add-btn');
  btn.disabled = true; btn.textContent = '추가 중...';

  try {
    await postData({ action: 'addCourse', name });
    input.value = '';
    await delay(800);
    await loadCourseList();
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); }
  finally { btn.disabled = false; btn.textContent = '+ 추가'; }
}

async function deleteCourse(name, btnEl) {
  if (!confirm(`"${name}" 과정을 삭제하시겠습니까?\n(기존 설문 데이터는 유지됩니다)`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    await postData({ action: 'deleteCourse', name });
    await delay(800);
    await loadCourseList();
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

// ── 강사 관리 ──────────────────────────────
async function toggleInstructors(courseName, idx) {
  const panel = document.getElementById(`inst-panel-${idx}`);
  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    await loadInstructors(courseName, idx);
  } else {
    panel.style.display = 'none';
  }
}

async function loadInstructors(courseName, panelIdx) {
  const panel = document.getElementById(`inst-panel-${panelIdx}`);
  panel.innerHTML = '<div class="inst-loading">불러오는 중...</div>';
  try {
    const res = await fetch(`${SCRIPT_URL}?action=instructors&course=${encodeURIComponent(courseName)}`);
    const instructors = await res.json();
    renderInstructorPanel(courseName, panelIdx, instructors);
  } catch (e) {
    panel.innerHTML = '<div class="inst-loading">불러오기 실패</div>';
  }
}

function renderInstructorPanel(courseName, panelIdx, instructors) {
  const panel = document.getElementById(`inst-panel-${panelIdx}`);
  const ec = escapeAttr(courseName);
  const listHtml = instructors.length === 0
    ? '<div class="inst-empty">등록된 강사가 없습니다. 강사를 추가해 주세요.</div>'
    : instructors.map((inst, i) => {
        const name = typeof inst === 'string' ? inst : inst.name;
        const edu  = typeof inst === 'string' ? '' : (inst.education || '');
        const label = edu ? `<span class="inst-edu-tag">${escapeHtml(edu)}</span> ${escapeHtml(name)}` : escapeHtml(name);
        const en = escapeAttr(name), ee = escapeAttr(edu);
        return `<div class="inst-item">
          <span class="inst-label">${label}</span>
          <button class="delete-btn" onclick="deleteInstructor('${ec}', ${panelIdx}, '${en}', '${ee}', this)">삭제</button>
        </div>`;
      }).join('');

  panel.innerHTML = `
    <div class="inst-add-row">
      <input type="text" id="inst-edu-${panelIdx}" placeholder="교육명 (예: AI 기초과정)" maxlength="50">
      <input type="text" id="inst-name-${panelIdx}" placeholder="강사명 (예: 홍길동)" maxlength="20">
      <button class="add-btn inst-add-btn" onclick="addInstructor('${ec}', ${panelIdx})">+ 추가</button>
    </div>
    <div class="inst-list" id="inst-list-${panelIdx}">${listHtml}</div>`;
}

async function addInstructor(courseName, panelIdx) {
  const edu  = document.getElementById(`inst-edu-${panelIdx}`).value.trim();
  const name = document.getElementById(`inst-name-${panelIdx}`).value.trim();
  if (!edu)  { document.getElementById(`inst-edu-${panelIdx}`).focus(); return; }
  if (!name) { document.getElementById(`inst-name-${panelIdx}`).focus(); return; }

  const btn = document.querySelector(`#inst-panel-${panelIdx} .inst-add-btn`);
  btn.disabled = true; btn.textContent = '추가 중...';
  try {
    await postData({ action: 'addInstructor', course: courseName, name, education: edu });
    document.getElementById(`inst-edu-${panelIdx}`).value = '';
    document.getElementById(`inst-name-${panelIdx}`).value = '';
    await delay(800);
    await loadInstructors(courseName, panelIdx);
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); btn.disabled = false; btn.textContent = '+ 추가'; }
}

async function deleteInstructor(courseName, panelIdx, name, education, btnEl) {
  if (!confirm(`"${name}" 강사를 삭제하시겠습니까?`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    await postData({ action: 'deleteInstructor', course: courseName, name, education });
    await delay(800);
    await loadInstructors(courseName, panelIdx);
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

// ── 수강생 관리 ──────────────────────────────
async function loadStudents() {
  const course = document.getElementById('student-course-select').value;
  document.getElementById('student-placeholder').style.display = course ? 'none' : 'block';
  document.getElementById('student-section').style.display = course ? 'block' : 'none';
  if (!course) return;

  document.getElementById('student-loading').style.display = 'block';
  document.getElementById('student-list').innerHTML = '';
  document.getElementById('student-empty').style.display = 'none';
  document.getElementById('student-stats-bar').innerHTML = '';

  try {
    const res = await fetch(`${SCRIPT_URL}?action=students&course=${encodeURIComponent(course)}`);
    const students = await res.json();
    document.getElementById('student-loading').style.display = 'none';

    const total = students.length;
    const done = students.filter(s => s.completed).length;

    document.getElementById('student-stats-bar').innerHTML = `
      <div class="stu-stat">
        <span>전체 <strong>${total}명</strong></span>
        <span class="stu-done">완료 <strong>${done}명</strong></span>
        <span class="stu-pending">미완료 <strong>${total - done}명</strong></span>
        <div class="stu-progress-wrap">
          <div class="stu-progress-bar" style="width:${total > 0 ? (done/total*100) : 0}%"></div>
        </div>
      </div>`;

    if (!students.length) {
      document.getElementById('student-empty').style.display = 'block';
      return;
    }

    document.getElementById('student-list').innerHTML = `
      <div class="student-table-wrap">
        <table class="student-table">
          <thead><tr><th>이름</th><th>교번</th><th>상태</th><th></th></tr></thead>
          <tbody>
            ${students.map(s => `
              <tr>
                <td>${s.name}</td>
                <td>${s.empNo}</td>
                <td>${s.completed
                  ? `<span class="status-done">✅ 완료</span>`
                  : `<span class="status-pending">⏳ 미완료</span>`}
                </td>
                <td><button class="delete-btn" onclick="deleteStudent('${escapeAttr(s.name)}','${escapeAttr(s.empNo)}','${escapeAttr(course)}',this)">삭제</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    document.getElementById('student-loading').textContent = '불러오기 실패';
  }
}

async function addStudent() {
  const course = document.getElementById('student-course-select').value;
  const name = document.getElementById('new-student-name').value.trim();
  const empNo = document.getElementById('new-student-empno').value.trim();

  if (!course) { alert('교육과정을 먼저 선택해 주세요.'); return; }
  if (!name) { document.getElementById('new-student-name').focus(); return; }
  if (!/^\d+$/.test(empNo) || parseInt(empNo) < 1) { alert('교번을 올바르게 입력해 주세요. (1 이상의 숫자)'); return; }

  const addBtns = document.querySelectorAll('.add-btn');
  addBtns.forEach(b => { b.disabled = true; b.textContent = '등록 중...'; });

  try {
    await postData({ action: 'addStudent', name, empNo, course });
    document.getElementById('new-student-name').value = '';
    document.getElementById('new-student-empno').value = '';
    await delay(800);
    await loadStudents();
  } catch (e) { alert('등록 중 오류가 발생했습니다.'); }
  finally { addBtns.forEach(b => { b.disabled = false; b.textContent = '+ 등록'; }); }
}

async function deleteStudent(name, empNo, course, btnEl) {
  if (!confirm(`"${name}" 수강생을 삭제하시겠습니까?`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    await postData({ action: 'deleteStudent', name, empNo, course });
    await delay(800);
    await loadStudents();
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

// ── 엑셀 일괄 등록 ──────────────────────────────
let excelStudentData = [];

function handleExcelUpload(input) {
  const file = input.files[0];
  if (!file) return;

  document.getElementById('excel-file-name').textContent = file.name;
  document.getElementById('excel-preview').style.display = 'none';
  document.getElementById('excel-progress').style.display = 'none';
  document.getElementById('excel-upload-btn').disabled = true;
  excelStudentData = [];

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // 2행부터 읽기 (1행은 헤더)
      const parsed = [];
      const errors = [];
      for (let i = 1; i < rows.length; i++) {
        const empNo = String(rows[i][0] || '').trim();
        const name  = String(rows[i][1] || '').trim();
        if (!empNo && !name) continue; // 빈 행 스킵
        if (!empNo || !/^\d+$/.test(empNo) || parseInt(empNo) < 1) {
          errors.push(`${i+1}행: 교번이 올바르지 않습니다. (값: "${empNo}")`);
          continue;
        }
        if (!name) {
          errors.push(`${i+1}행: 이름이 없습니다.`);
          continue;
        }
        parsed.push({ empNo, name });
      }

      const preview = document.getElementById('excel-preview');
      preview.style.display = 'block';

      if (parsed.length === 0 && errors.length === 0) {
        preview.innerHTML = '<div class="excel-preview-error">데이터가 없습니다. 파일을 확인해 주세요.</div>';
        return;
      }

      let html = `<strong>총 ${parsed.length}명 인식됨</strong>`;
      if (errors.length > 0) {
        html += errors.map(e => `<div class="excel-preview-error">⚠️ ${escapeHtml(e)}</div>`).join('');
      }
      html += parsed.map((s, i) =>
        `<div class="excel-preview-row">${i+1}. 교번 ${escapeHtml(s.empNo)} · ${escapeHtml(s.name)}</div>`
      ).join('');
      preview.innerHTML = html;

      if (parsed.length > 0) {
        excelStudentData = parsed;
        document.getElementById('excel-upload-btn').disabled = false;
      }
    } catch(err) {
      const preview = document.getElementById('excel-preview');
      preview.style.display = 'block';
      preview.innerHTML = '<div class="excel-preview-error">파일을 읽을 수 없습니다. 엑셀 형식(.xlsx/.xls)인지 확인해 주세요.</div>';
    }
  };
  reader.readAsArrayBuffer(file);
}

async function uploadExcelStudents() {
  const course = document.getElementById('student-course-select').value;
  if (!course) { alert('교육과정을 먼저 선택해 주세요.'); return; }
  if (excelStudentData.length === 0) return;

  const btn = document.getElementById('excel-upload-btn');
  btn.disabled = true;
  const progress = document.getElementById('excel-progress');
  progress.style.display = 'block';

  let success = 0, fail = 0;
  for (let i = 0; i < excelStudentData.length; i++) {
    const { empNo, name } = excelStudentData[i];
    progress.textContent = `등록 중... (${i+1}/${excelStudentData.length}) ${name}`;
    try {
      await postData({ action: 'addStudent', name, empNo, course });
      success++;
    } catch(_) {
      fail++;
    }
  }

  progress.textContent = `✅ 완료: ${success}명 등록${fail > 0 ? `, ❌ ${fail}명 실패` : ''}`;
  excelStudentData = [];
  document.getElementById('excel-file-input').value = '';
  document.getElementById('excel-file-name').textContent = '선택된 파일 없음';
  document.getElementById('excel-preview').style.display = 'none';

  await delay(800);
  await loadStudents();
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
    const [resResponses, resStudents] = await Promise.all([
      fetch(`${SCRIPT_URL}?action=responses&course=${encodeURIComponent(course)}`),
      fetch(`${SCRIPT_URL}?action=students&course=${encodeURIComponent(course)}`)
    ]);
    const responses = await resResponses.json();
    const students = await resStudents.json();

    document.getElementById('stats-loading').style.display = 'none';

    if (!responses || responses.length === 0) {
      document.getElementById('stats-no-data').style.display = 'block';
      return;
    }

    renderStats(responses, students);
    document.getElementById('stats-area').style.display = 'block';
  } catch (e) {
    document.getElementById('stats-loading').textContent = '데이터를 불러오지 못했습니다.';
  }
}

function renderStats(responses, students) {
  const n = responses.length;
  const totalStudents = students.length;
  const completedStudents = students.filter(s => s.completed).length;
  const rate = totalStudents > 0 ? Math.round(completedStudents / totalStudents * 100) : 0;
  const notCompleted = students.filter(s => !s.completed);

  document.getElementById('total-students').textContent = totalStudents + '명';
  document.getElementById('completion-rate').textContent = rate + '%';
  document.getElementById('completion-detail').textContent = `${completedStudents} / ${totalStudents}명`;
  document.getElementById('not-completed').textContent = notCompleted.length + '명';

  // 미참여자 목록
  const ncSection = document.getElementById('not-completed-section');
  if (notCompleted.length > 0) {
    ncSection.style.display = 'block';
    document.getElementById('not-completed-list').innerHTML = notCompleted.map(s =>
      `<span class="nc-badge">${s.name}</span>`
    ).join('');
  } else {
    ncSection.style.display = 'none';
  }

  // 항목별 평균
  const keys = ['q1', 'q2', 'q3', 'q4', 'q5'];
  const avgs = keys.map(k => responses.reduce((acc, r) => acc + (Number(r[k]) || 0), 0) / n);
  const overallAvg = avgs.reduce((a, b) => a + b, 0) / 5;
  document.getElementById('overall-avg').textContent = overallAvg.toFixed(2);

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
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  // 강사별 만족도 통계
  const instScoreMap = {}; // key → [scores]
  responses.forEach(r => {
    if (!r.instructors) return;
    let obj = r.instructors;
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return; } }
    Object.entries(obj).forEach(([key, score]) => {
      if (!instScoreMap[key]) instScoreMap[key] = [];
      const v = Number(score);
      if (v >= 1 && v <= 5) instScoreMap[key].push(v);
    });
  });

  const instKeys = Object.keys(instScoreMap);
  if (instKeys.length > 0) {
    document.getElementById('instructor-stats-section').style.display = 'block';
    document.getElementById('instructor-stats').innerHTML = instKeys.map(key => {
      const scores = instScoreMap[key];
      const cnt = scores.length;
      const avg = scores.reduce((a, b) => a + b, 0) / cnt;
      const pct = (avg / 5 * 100).toFixed(1);
      const color = avg >= 4.5 ? '#22c55e' : avg >= 3.5 ? '#0066cc' : avg >= 2.5 ? '#f59e0b' : '#ef4444';
      const dist = [1,2,3,4,5].map(v => scores.filter(s => s === v).length);
      // key 형식: "교육명__강사명" 또는 "강사명"
      const parts = key.split('__');
      const label = parts.length === 2
        ? `👨‍🏫 [${escapeHtml(parts[0])}] ${escapeHtml(parts[1])} 강사`
        : `👨‍🏫 ${escapeHtml(key)} 강사`;
      return `
        <div class="q-stat-card">
          <div class="q-stat-header">
            <span class="q-stat-label">${label}</span>
            <span class="q-stat-avg" style="color:${color}">${avg.toFixed(2)}점</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="dist-row">
            ${dist.map((c, j) => `
              <div class="dist-item">
                <div class="dist-bar-wrap"><div class="dist-bar" style="height:${cnt>0?(c/cnt*60):0}px;background:${color}"></div></div>
                <div class="dist-label">${j+1}점</div>
                <div class="dist-count">${c}명</div>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');
  } else {
    document.getElementById('instructor-stats-section').style.display = 'none';
  }

  const comments = responses.filter(r => r.comment && String(r.comment).trim());
  document.getElementById('comment-count').textContent = comments.length + '건';
  document.getElementById('comments-list').innerHTML = comments.length
    ? comments.map(r => `
        <div class="comment-item">
          <div class="comment-date">익명 · ${formatDate(r.submittedAt)}</div>
          <div class="comment-text">${escapeHtml(String(r.comment))}</div>
        </div>`).join('')
    : '<div class="no-comment">작성된 의견이 없습니다.</div>';
}

// ── 유틸 ──────────────────────────────
function postData(body) {
  return fetch(SCRIPT_URL, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

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
window.toggleInstructors = toggleInstructors;
window.addInstructor = addInstructor;
window.deleteInstructor = deleteInstructor;
window.loadStudents = loadStudents;
window.addStudent = addStudent;
window.deleteStudent = deleteStudent;
window.handleExcelUpload = handleExcelUpload;
window.uploadExcelStudents = uploadExcelStudents;
window.loadStats = loadStats;
