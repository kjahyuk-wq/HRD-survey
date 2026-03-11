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
  ['courses', 'stats', 'pdf'].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  const tabNames = ['courses', 'stats', 'pdf'];
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', tabNames[i] === tab);
  });
  if (tab === 'stats') populateStatsSelect();
  if (tab === 'pdf') initPdfDragDrop();
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
  initExcelDragDrop();

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

function initExcelDragDrop() {
  const area = document.querySelector('.excel-upload-area');
  if (!area || area.dataset.dragInit) return;
  area.dataset.dragInit = '1';

  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', e => {
    if (!area.contains(e.relatedTarget)) area.classList.remove('drag-over');
  });
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.');
      return;
    }
    document.getElementById('excel-file-name').textContent = file.name;
    parseExcelFile(file);
  });
}

function handleExcelUpload(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('excel-file-name').textContent = file.name;
  parseExcelFile(file);
}

function parseExcelFile(file) {
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

      const parsed = [], errors = [];
      for (let i = 1; i < rows.length; i++) {
        const empNo = String(rows[i][0] || '').trim();
        const name  = String(rows[i][1] || '').trim();
        if (!empNo && !name) continue;
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
        html += errors.map(err => `<div class="excel-preview-error">⚠️ ${escapeHtml(err)}</div>`).join('');
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
let lastResponses = [];
let lastCourseName = '';

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
  lastCourseName = course;

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

    lastResponses = responses;
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

// ── 엑셀 내보내기 ──────────────────────────────
function exportStatsExcel() {
  if (!lastResponses.length) return;

  const wb = XLSX.utils.book_new();

  // 강사 키 수집
  const instKeySet = new Set();
  lastResponses.forEach(r => {
    let obj = r.instructors || {};
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return; } }
    Object.keys(obj).forEach(k => instKeySet.add(k));
  });
  const instKeys = [...instKeySet];

  // ── 시트1: 객관식 ──
  const instHeaders = instKeys.map(k => {
    const parts = k.split('__');
    return parts.length === 2 ? `[${parts[0]}] ${parts[1]} 강사` : `${k} 강사`;
  });
  const headers1 = ['순번', ...Q_LABELS, ...instHeaders];
  const sheet1Data = [headers1];

  lastResponses.forEach((r, idx) => {
    const row = [idx + 1];
    ['q1','q2','q3','q4','q5'].forEach(k => {
      const v = Number(r[k]);
      row.push((v >= 1 && v <= 5) ? 6 - v : '');
    });
    let instObj = r.instructors || {};
    if (typeof instObj === 'string') { try { instObj = JSON.parse(instObj); } catch { instObj = {}; } }
    instKeys.forEach(k => {
      const v = Number(instObj[k]);
      row.push((v >= 1 && v <= 5) ? 6 - v : '');
    });
    sheet1Data.push(row);
  });

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1Data), '객관식');

  // ── 시트2: 주관식 ──
  const sheet2Data = [['순번', '의견']];
  let commentIdx = 1;
  lastResponses.forEach(r => {
    const c = String(r.comment || '').trim();
    if (c) sheet2Data.push([commentIdx++, c]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2Data), '주관식');

  const filename = `${lastCourseName}_설문결과_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
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

// ── PDF 분석 탭 ──────────────────────────────
let pdfInstructors = []; // [{edu, name}]
let pdfStudents = [];    // [{no, name, dept}]

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function handlePdfUpload(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('pdf-file-name').textContent = file.name;
  parsePdfFile(file);
}

function initPdfDragDrop() {
  const area = document.getElementById('pdf-upload-area');
  if (!area || area.dataset.dragInit) return;
  area.dataset.dragInit = '1';
  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', e => {
    if (!area.contains(e.relatedTarget)) area.classList.remove('drag-over');
  });
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      alert('PDF 파일만 업로드할 수 있습니다.');
      return;
    }
    document.getElementById('pdf-file-name').textContent = file.name;
    parsePdfFile(file);
  });
}

async function parsePdfFile(file) {
  const status = document.getElementById('pdf-parse-status');
  const rawSection = document.getElementById('pdf-raw-section');
  const formSection = document.getElementById('pdf-form-section');

  rawSection.style.display = 'none';
  formSection.style.display = 'none';
  status.style.display = 'block';
  status.textContent = '📄 PDF 텍스트 추출 중...';

  try {
    // Ensure PDF.js worker is configured
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let allLines = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group text items by approximate Y position (reconstruct lines)
      const lineMap = new Map();
      textContent.items.forEach(item => {
        if (!item.str.trim()) return;
        const y = Math.round(item.transform[5] / 4) * 4;
        if (!lineMap.has(y)) lineMap.set(y, []);
        lineMap.get(y).push(item);
      });

      // Sort by Y descending (PDF y is bottom-up), then X ascending
      const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
      sortedYs.forEach(y => {
        const items = lineMap.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
        const lineText = items.map(i => i.str).join(' ').trim();
        if (lineText) allLines.push(lineText);
      });
      // Page separator
      if (pageNum < pdf.numPages) allLines.push('--- 페이지 구분 ---');
    }

    const fullText = allLines.join('\n');

    // Show raw text
    document.getElementById('pdf-raw-text').textContent = fullText;
    rawSection.style.display = 'block';

    // Parse fields
    parsePdfFields(fullText, allLines);
    formSection.style.display = 'block';

    status.textContent = `✅ 추출 완료 (${pdf.numPages}페이지). 아래에서 정보를 확인·수정 후 생성해 주세요.`;
    status.style.color = '#22c55e';

  } catch (e) {
    status.textContent = '❌ PDF를 읽을 수 없습니다. 파일이 손상되었거나 텍스트가 포함되지 않은 이미지 PDF일 수 있습니다.';
    status.style.color = '#ef4444';
  }
}

function parsePdfFields(text, lines) {
  // ── 과정명 ──
  let courseName = '';
  const coursePatterns = [
    /과정명\s*[:：]\s*(.+)/,
    /교육과정명\s*[:：]\s*(.+)/,
    /교육과정\s*[:：]\s*(.+)/,
    /과\s*정\s*명\s*[:：]\s*(.+)/,
  ];
  for (const p of coursePatterns) {
    const m = text.match(p);
    if (m) { courseName = m[1].replace(/\s+/g, ' ').trim(); break; }
  }
  // Fallback: first non-empty line that's not a header keyword
  if (!courseName && lines.length > 0) {
    const skip = /^(대전|인재개발원|관리자|교육|훈련|리플릿|leaflet|---)/i;
    const candidate = lines.find(l => l.length >= 4 && l.length <= 60 && !skip.test(l));
    if (candidate) courseName = candidate.trim();
  }

  // ── 교육 기간 ──
  let period = '';
  const periodPatterns = [
    /(?:교육기간|교육\s*기간|기\s*간|교육일시|일\s*시)\s*[:：]\s*(.+)/,
  ];
  for (const p of periodPatterns) {
    const m = text.match(p);
    if (m) { period = m[1].replace(/\s+/g, ' ').trim(); break; }
  }
  if (!period) {
    const dateM = text.match(/(\d{4}[.\-\/]\s*\d{1,2}[.\-\/]\s*\d{1,2}\s*[~～\-]\s*\d{4}[.\-\/]\s*\d{1,2}[.\-\/]\s*\d{1,2})/);
    if (dateM) period = dateM[1].replace(/\s+/g, '').trim();
  }

  // ── 교육 장소 ──
  let location = '';
  const locationPatterns = [
    /(?:교육장소|교육\s*장소|장\s*소|훈련장소)\s*[:：]\s*(.+)/,
  ];
  for (const p of locationPatterns) {
    const m = text.match(p);
    if (m) { location = m[1].replace(/\s+/g, ' ').trim(); break; }
  }

  // ── 수강인원 ──
  let capacity = '';
  const capPatterns = [
    /(?:수강인원|교육인원|정\s*원|수강\s*인원)\s*[:：]\s*(.+)/,
  ];
  for (const p of capPatterns) {
    const m = text.match(p);
    if (m) { capacity = m[1].replace(/\s+/g, ' ').trim(); break; }
  }

  // ── 교육목표 ──
  let objective = '';
  const objM = text.match(/교육목표\s*[:：]?\s*([\s\S]*?)(?=\n(?:교육내용|교육기간|기간|장소|강사|수강|시간표|일정|교육생|\d+\.|•|-{3})|$)/);
  if (objM) objective = objM[1].replace(/\s+/g, ' ').trim().substring(0, 300);

  // Set form values
  document.getElementById('pdf-course-name').value = courseName;
  document.getElementById('pdf-period').value = period;
  document.getElementById('pdf-location').value = location;
  document.getElementById('pdf-capacity').value = capacity;
  document.getElementById('pdf-objective').value = objective;

  // ── 강사 파싱 ──
  pdfInstructors = [];
  const instSet = new Set();

  // Pattern 1: "강사명 : 홍길동" or "강사 : 홍길동"
  const instLinePatterns = [
    /(?:강사명|강\s*사)\s*[:：]\s*([가-힣]{2,5})/g,
  ];
  for (const p of instLinePatterns) {
    for (const m of text.matchAll(p)) {
      const name = m[1].trim();
      if (!instSet.has(name)) {
        instSet.add(name);
        pdfInstructors.push({ edu: courseName || '전 과목', name });
      }
    }
  }

  // Pattern 2: Schedule table lines - "시간 | 과목 | 강사명" style
  // Look for Korean name (2-4 chars) preceded by Korean subject words
  const schedulePattern = /([가-힣\s]{3,20})\s+([가-힣]{2,4})\s*(?:강사|교수|박사|원장)?(?:\s|$)/g;
  const nameOnlyPattern = /^([가-힣]{2,4})\s*(?:강사|교수|박사)?$/;
  lines.forEach(line => {
    // Lines that look like schedule: contain time pattern
    if (/\d{1,2}:\d{2}/.test(line) || /교시/.test(line)) {
      const parts = line.split(/\s{2,}|\t|[|│]/);
      parts.forEach(part => {
        const trimmed = part.trim();
        const nm = trimmed.match(/^([가-힣]{2,4})\s*(?:강사|교수|박사|원장)?$/);
        if (nm) {
          const name = nm[1];
          if (!instSet.has(name) && name.length >= 2) {
            instSet.add(name);
            pdfInstructors.push({ edu: courseName || '전 과목', name });
          }
        }
      });
    }
  });

  renderPdfInstructors();

  // ── 교육생 파싱 ──
  pdfStudents = [];
  const stuSet = new Set();

  // Pattern: number (1-3 digits) + Korean name (2-4 chars) + department
  // Handle both space-separated and table-style
  lines.forEach(line => {
    // Try pattern: "1 홍길동 시정혁신과" or "1. 홍길동 시정혁신과"
    const m = line.match(/^(\d{1,3})[\.\)]?\s+([가-힣]{2,5})\s+(.{2,30})$/);
    if (m) {
      const no = parseInt(m[1]);
      const name = m[2].trim();
      const dept = m[3].trim();
      const key = `${no}_${name}`;
      if (no >= 1 && no <= 200 && !stuSet.has(key)) {
        // Filter out obviously wrong entries
        if (!/교육목표|과정명|강사|기간|장소|시간표/.test(name + dept)) {
          stuSet.add(key);
          pdfStudents.push({ no, name, dept });
        }
      }
    }
  });

  // Sort by number
  pdfStudents.sort((a, b) => a.no - b.no);
  renderPdfStudents();
}

function toggleRawText() {
  const el = document.getElementById('pdf-raw-text');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ── 강사 목록 렌더링 ──
function renderPdfInstructors() {
  const list = document.getElementById('pdf-instructor-list');
  document.getElementById('pdf-inst-count').textContent = pdfInstructors.length + '명';
  if (pdfInstructors.length === 0) {
    list.innerHTML = '<div class="pdf-empty-msg">등록된 강사가 없습니다. 아래에서 직접 추가해 주세요.</div>';
    return;
  }
  list.innerHTML = pdfInstructors.map((inst, i) => `
    <div class="pdf-item-row">
      <span class="pdf-item-tag">${escapeHtml(inst.edu)}</span>
      <span class="pdf-item-name">👨‍🏫 ${escapeHtml(inst.name)}</span>
      <button class="delete-btn" onclick="removePdfInstructor(${i})">삭제</button>
    </div>`).join('');
}

function addPdfInstructor() {
  const edu = document.getElementById('pdf-inst-edu').value.trim();
  const name = document.getElementById('pdf-inst-name').value.trim();
  if (!edu) { document.getElementById('pdf-inst-edu').focus(); return; }
  if (!name) { document.getElementById('pdf-inst-name').focus(); return; }
  pdfInstructors.push({ edu, name });
  document.getElementById('pdf-inst-edu').value = '';
  document.getElementById('pdf-inst-name').value = '';
  renderPdfInstructors();
}

function removePdfInstructor(idx) {
  pdfInstructors.splice(idx, 1);
  renderPdfInstructors();
}

// ── 교육생 목록 렌더링 ──
function renderPdfStudents() {
  const list = document.getElementById('pdf-student-list');
  document.getElementById('pdf-stu-count').textContent = pdfStudents.length + '명';
  if (pdfStudents.length === 0) {
    list.innerHTML = '<div class="pdf-empty-msg">등록된 교육생이 없습니다. 아래에서 직접 추가하거나 PDF를 확인해 주세요.</div>';
    return;
  }
  list.innerHTML = `
    <div class="student-table-wrap" style="margin-bottom:0.8rem;">
      <table class="student-table">
        <thead><tr><th>연번</th><th>이름</th><th>소속</th><th></th></tr></thead>
        <tbody>
          ${pdfStudents.map((s, i) => `
            <tr>
              <td>${s.no}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.dept)}</td>
              <td><button class="delete-btn" onclick="removePdfStudent(${i})">삭제</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function addPdfStudent() {
  const no = parseInt(document.getElementById('pdf-stu-no').value);
  const name = document.getElementById('pdf-stu-name').value.trim();
  const dept = document.getElementById('pdf-stu-dept').value.trim();
  if (!no || no < 1) { document.getElementById('pdf-stu-no').focus(); return; }
  if (!name) { document.getElementById('pdf-stu-name').focus(); return; }
  pdfStudents.push({ no, name, dept: dept || '-' });
  pdfStudents.sort((a, b) => a.no - b.no);
  document.getElementById('pdf-stu-no').value = '';
  document.getElementById('pdf-stu-name').value = '';
  document.getElementById('pdf-stu-dept').value = '';
  renderPdfStudents();
}

function removePdfStudent(idx) {
  pdfStudents.splice(idx, 1);
  renderPdfStudents();
}

// ── 만족도 조사 생성 ──
async function generateSurvey() {
  const courseName = document.getElementById('pdf-course-name').value.trim();
  if (!courseName) {
    alert('과정명을 입력해 주세요.');
    document.getElementById('pdf-course-name').focus();
    return;
  }

  const btn = document.getElementById('pdf-generate-btn');
  const statusEl = document.getElementById('pdf-generate-status');
  btn.disabled = true;
  btn.textContent = '생성 중...';
  statusEl.style.display = 'block';
  statusEl.style.color = '#0066cc';

  try {
    // 1. 교육과정 생성
    statusEl.textContent = '📋 교육과정 생성 중...';
    await postData({ action: 'addCourse', name: courseName });
    await delay(800);

    // 2. 강사 등록
    for (let i = 0; i < pdfInstructors.length; i++) {
      const inst = pdfInstructors[i];
      statusEl.textContent = `👨‍🏫 강사 등록 중... (${i + 1}/${pdfInstructors.length}) ${inst.name}`;
      await postData({ action: 'addInstructor', course: courseName, name: inst.name, education: inst.edu || courseName });
      await delay(400);
    }

    // 3. 수강생 등록
    for (let i = 0; i < pdfStudents.length; i++) {
      const stu = pdfStudents[i];
      statusEl.textContent = `👥 수강생 등록 중... (${i + 1}/${pdfStudents.length}) ${stu.name}`;
      await postData({ action: 'addStudent', name: stu.name, empNo: String(stu.no), course: courseName });
      await delay(300);
    }

    statusEl.style.color = '#22c55e';
    statusEl.innerHTML = `✅ 만족도 조사 생성 완료!<br>
      <span style="color:#333;">과정명: <strong>${escapeHtml(courseName)}</strong> · 강사 ${pdfInstructors.length}명 · 수강생 ${pdfStudents.length}명</span>`;

    btn.textContent = '✅ 생성 완료';

    // Refresh course list in background
    await loadCourseList();

    // Ask to navigate
    setTimeout(() => {
      if (confirm(`"${courseName}" 만족도 조사가 생성되었습니다.\n교육과정·수강생 관리 탭으로 이동하시겠습니까?`)) {
        switchTab('courses');
      }
    }, 500);

  } catch (e) {
    statusEl.style.color = '#ef4444';
    statusEl.textContent = '❌ 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    btn.disabled = false;
    btn.textContent = '✅ 만족도 조사 생성';
  }
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
window.exportStatsExcel = exportStatsExcel;
window.handlePdfUpload = handlePdfUpload;
window.toggleRawText = toggleRawText;
window.addPdfInstructor = addPdfInstructor;
window.removePdfInstructor = removePdfInstructor;
window.addPdfStudent = addPdfStudent;
window.removePdfStudent = removePdfStudent;
window.generateSurvey = generateSurvey;
