import { db } from './firebase-config.js';
import {
  collection, query, where, orderBy, getDocs,
  addDoc, deleteDoc, doc, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const ADMIN_PASSWORD = "hrd2024!";

// 과정명 → Firestore doc ID 매핑
let courseIdMap = {};

const Q_LABELS = [
  'Q1. 과정 목적 달성을 위한 교육기간',
  'Q2. 과정 목적 달성을 위한 교과편성',
  'Q3. 과정 목적 달성을 위한 강사선정',
  'Q4. 교육내용 및 수준',
  'Q5. 과정장 및 직원 교육과정 운영',
  'Q6. 과정 전반적인 만족도',
  'Q7. 교육내용의 향후 업무·개인생활 도움',
  'Q8. 식당 음식의 질 및 서비스',
  'Q9. 교육시설 및 편의시설 수준',
];

const QUESTION_CATEGORIES = [
  { label: '📅 교육기간', indices: [0] },
  { label: '📋 교육운영', indices: [1, 2, 3, 4, 5] },
  { label: '🎯 교육효과', indices: [6] },
  { label: '🏢 시설환경', indices: [7, 8] },
];

const DEMO_QUESTIONS = [
  { key: 'q11', label: 'Q11. 귀하의 근무처', options: ['시 본청', '시 사업소', '구', '동', '기타'] },
  { key: 'q12', label: 'Q12. 귀하의 직급', options: ['5급', '6급', '7급', '8급', '9급', '기타'] },
  { key: 'q13', label: 'Q13. 귀하의 직렬', options: ['행정직', '기술직', '연구직', '관리운영직', '기타'] },
  { key: 'q14', label: 'Q14. 귀하의 연령', options: ['20대', '30대', '40대', '50대'] },
  { key: 'q15', label: 'Q15. 귀하의 성별', options: ['남', '여'] },
  { key: 'q16', label: 'Q16. 입교 동기', options: ['업무능력 개발', '교육이수 점수 취득', '심신의 재충전', '자기개발', '기타'] },
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
  ['courses', 'stats', 'preview', 'attendance'].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  const tabNames = ['courses', 'preview', 'stats', 'attendance'];
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', tabNames[i] === tab);
  });
  if (tab === 'stats') populateStatsSelect();
  if (tab === 'preview') populatePreviewSelect();
  if (tab === 'attendance') initAttendanceTab();
}

// ── 설문 미리보기 ──────────────────────────────
async function populatePreviewSelect() {
  try {
    const snap = await getDocs(collection(db, 'courses'));
    snap.docs.forEach(d => { courseIdMap[d.data().name] = d.id; });
    const courses = snap.docs.map(d => d.data().name);
    const sel = document.getElementById('preview-course-select');
    const current = sel.value;
    sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
      courses.map(c => `<option value="${escapeAttr(c)}"${c === current ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
    if (current) loadPreviewInstructors();
  } catch (e) {}
}

async function loadPreviewInstructors() {
  const course = document.getElementById('preview-course-select').value;
  const badge = document.getElementById('preview-course-badge');
  const container = document.getElementById('preview-instructor-questions');

  badge.textContent = course || '교육과정을 선택하세요';

  if (!course) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="loading" style="text-align:center;padding:1rem;">강사 정보 불러오는 중...</div>';
  try {
    const courseId = courseIdMap[course];
    const instSnap = await getDocs(query(collection(db, 'courses', courseId, 'instructors'), orderBy('createdAt')));
    const instructors = instSnap.docs.map(d => d.data());

    if (instructors.length === 0) {
      container.innerHTML = '<div class="no-data" style="margin:0.5rem 0;">등록된 강사가 없습니다.</div>';
      return;
    }

    container.innerHTML = instructors.map((inst, i) => {
      const qNum = 17 + i;
      const nameLabel = inst.education ? `${escapeHtml(inst.education)} · ${escapeHtml(inst.name)}` : escapeHtml(inst.name);
      const ratingHtml = [1,2,3,4,5].map((v, vi) => {
        const labels = ['매우 불만족','불만족','보통','만족','매우 만족'];
        return `<label class="rating-label"><input type="radio" name="pq${qNum}" value="${v}"><span class="rating-btn">${v}<br><small>${labels[vi]}</small></span></label>`;
      }).join('');
      return `<div class="q-card">
        <div class="q-num">Q${qNum}</div>
        <div class="q-txt">
          <div style="font-size:.8rem;color:#888;margin-bottom:.3rem;">👨‍🏫 강사 만족도 · ${nameLabel}</div>
          강사의 전반적인 강의 만족도는?
        </div>
        <div class="rating-group">${ratingHtml}</div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="no-data">강사 정보를 불러오지 못했습니다.</div>';
  }
}

// ── 교육과정 관리 ──────────────────────────────
async function loadCourseList() {
  document.getElementById('course-manage-loading').style.display = 'block';
  document.getElementById('course-manage-list').innerHTML = '';
  document.getElementById('course-manage-empty').style.display = 'none';

  try {
    const snap = await getDocs(collection(db, 'courses'));
    document.getElementById('course-manage-loading').style.display = 'none';

    courseIdMap = {};
    const courses = snap.docs.map(d => {
      courseIdMap[d.data().name] = d.id;
      return d.data().name;
    });

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
    await addDoc(collection(db, 'courses'), { name });
    input.value = '';
    await loadCourseList();
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); }
  finally { btn.disabled = false; btn.textContent = '+ 추가'; }
}

async function deleteCourse(name, btnEl) {
  if (!confirm(`"${name}" 과정을 삭제하시겠습니까?\n(기존 설문 데이터는 유지됩니다)`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    const courseId = courseIdMap[name];
    await deleteSubcollection(courseId, 'instructors');
    await deleteSubcollection(courseId, 'students');
    await deleteSubcollection(courseId, 'responses');
    await deleteDoc(doc(db, 'courses', courseId));
    await loadCourseList();
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

async function deleteSubcollection(courseId, subcollectionName) {
  const snap = await getDocs(collection(db, 'courses', courseId, subcollectionName));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
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
    const courseId = courseIdMap[courseName];
    const snap = await getDocs(query(collection(db, 'courses', courseId, 'instructors'), orderBy('createdAt')));
    const instructors = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
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
    : instructors.map((inst) => {
        const name = typeof inst === 'string' ? inst : inst.name;
        const edu  = typeof inst === 'string' ? '' : (inst.education || '');
        const label = edu ? `<span class="inst-edu-tag">${escapeHtml(edu)}</span> ${escapeHtml(name)}` : escapeHtml(name);
        const en = escapeAttr(name), ee = escapeAttr(edu), eid = escapeAttr(inst._id || '');
        return `<div class="inst-item">
          <span class="inst-label">${label}</span>
          <button class="delete-btn" onclick="deleteInstructor('${ec}', ${panelIdx}, '${en}', '${ee}', '${eid}', this)">삭제</button>
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
    const courseId = courseIdMap[courseName];
    await addDoc(collection(db, 'courses', courseId, 'instructors'), { name, education: edu, createdAt: serverTimestamp() });
    document.getElementById(`inst-edu-${panelIdx}`).value = '';
    document.getElementById(`inst-name-${panelIdx}`).value = '';
    await loadInstructors(courseName, panelIdx);
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); btn.disabled = false; btn.textContent = '+ 추가'; }
}

async function deleteInstructor(courseName, panelIdx, name, education, instId, btnEl) {
  if (!confirm(`"${name}" 강사를 삭제하시겠습니까?`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    const courseId = courseIdMap[courseName];
    await deleteDoc(doc(db, 'courses', courseId, 'instructors', instId));
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
    const courseId = courseIdMap[course];
    const snap = await getDocs(collection(db, 'courses', courseId, 'students'));
    const students = snap.docs.map(d => ({
      ...d.data(),
      _id: d.id,
      completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null
    })).sort((a, b) => Number(a.empNo) - Number(b.empNo));
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
      <div class="student-bulk-actions">
        <button class="bulk-delete-btn" id="bulk-delete-btn" onclick="deleteSelectedStudents()" disabled>선택 삭제</button>
      </div>
      <div class="student-table-wrap">
        <table class="student-table">
          <thead><tr>
            <th style="width:36px"><input type="checkbox" id="select-all-checkbox" onclick="toggleSelectAll(this)"></th>
            <th>이름</th><th>교번</th><th>상태</th><th></th>
          </tr></thead>
          <tbody>
            ${students.map(s => `
              <tr>
                <td><input type="checkbox" class="student-checkbox" data-id="${escapeAttr(s._id)}" data-name="${escapeAttr(s.name)}" data-empno="${escapeAttr(s.empNo)}" onchange="updateBulkDeleteBtn()"></td>
                <td>${s.name}</td>
                <td>${s.empNo}</td>
                <td>${s.completed
                  ? `<span class="status-done">✅ 완료</span>${s.completedAt ? `<br><small class="completed-at">${formatDateTime(s.completedAt)}</small>` : ''}`
                  : `<span class="status-pending">⏳ 미완료</span>`}
                </td>
                <td><button class="delete-btn" onclick="deleteStudent('${escapeAttr(s.name)}','${escapeAttr(s.empNo)}','${escapeAttr(course)}','${escapeAttr(s._id)}',this)">삭제</button></td>
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
    const courseId = courseIdMap[course];
    await addDoc(collection(db, 'courses', courseId, 'students'), {
      name, empNo, completed: false, completedAt: null
    });
    document.getElementById('new-student-name').value = '';
    document.getElementById('new-student-empno').value = '';
    await loadStudents();
  } catch (e) { alert('등록 중 오류가 발생했습니다.'); }
  finally { addBtns.forEach(b => { b.disabled = false; b.textContent = '+ 등록'; }); }
}

function toggleSelectAll(checkbox) {
  document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = checkbox.checked);
  updateBulkDeleteBtn();
}

function updateBulkDeleteBtn() {
  const all = document.querySelectorAll('.student-checkbox');
  const checked = document.querySelectorAll('.student-checkbox:checked');
  const btn = document.getElementById('bulk-delete-btn');
  const selectAll = document.getElementById('select-all-checkbox');
  if (btn) {
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length > 0 ? `선택 삭제 (${checked.length}명)` : '선택 삭제';
  }
  if (selectAll && all.length > 0) {
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    selectAll.checked = checked.length === all.length;
  }
}

async function deleteSelectedStudents() {
  const course = document.getElementById('student-course-select').value;
  const checked = document.querySelectorAll('.student-checkbox:checked');
  if (!checked.length) return;
  const count = checked.length;
  if (!confirm(`선택한 ${count}명의 수강생을 삭제하시겠습니까?\n해당 수강생들의 설문 응답도 함께 삭제됩니다.`)) return;
  const btn = document.getElementById('bulk-delete-btn');
  btn.disabled = true;
  btn.textContent = '삭제 중...';
  try {
    const courseId = courseIdMap[course];
    await Promise.all(Array.from(checked).map(async cb => {
      const studentId = cb.dataset.id;
      const name = cb.dataset.name;
      const empNo = cb.dataset.empno;
      const respSnap = await getDocs(query(collection(db, 'courses', courseId, 'responses'), where('empNo', '==', empNo)));
      const matching = respSnap.docs.filter(d => d.data().name === name);
      await Promise.all(matching.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'courses', courseId, 'students', studentId));
    }));
    await loadStudents();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    btn.disabled = false;
    btn.textContent = `선택 삭제 (${count}명)`;
  }
}

async function deleteStudent(name, empNo, course, studentId, btnEl) {
  if (!confirm(`"${name}" 수강생을 삭제하시겠습니까?\n해당 수강생의 설문 응답도 함께 삭제됩니다.`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    const courseId = courseIdMap[course];
    const respSnap = await getDocs(query(collection(db, 'courses', courseId, 'responses'), where('empNo', '==', empNo)));
    const matching = respSnap.docs.filter(d => d.data().name === name);
    await Promise.all(matching.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'courses', courseId, 'students', studentId));
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

  const courseId = courseIdMap[course];
  let success = 0, fail = 0;
  for (let i = 0; i < excelStudentData.length; i++) {
    const { empNo, name } = excelStudentData[i];
    progress.textContent = `등록 중... (${i+1}/${excelStudentData.length}) ${name}`;
    try {
      await addDoc(collection(db, 'courses', courseId, 'students'), {
        name, empNo, completed: false, completedAt: null
      });
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

  await loadStudents();
}

// ── 통계 ──────────────────────────────
let lastResponses = [];
let lastCourseName = '';
let lastOrderedInstructorKeys = [];

async function populateStatsSelect() {
  try {
    const snap = await getDocs(collection(db, 'courses'));
    snap.docs.forEach(d => { courseIdMap[d.data().name] = d.id; });
    const courses = snap.docs.map(d => d.data().name);
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
    const courseId = courseIdMap[course];
    const [responsesSnap, studentsSnap, instructorsSnap] = await Promise.all([
      getDocs(collection(db, 'courses', courseId, 'responses')),
      getDocs(collection(db, 'courses', courseId, 'students')),
      getDocs(query(collection(db, 'courses', courseId, 'instructors'), orderBy('createdAt')))
    ]);

    const responses = responsesSnap.docs.map(d => ({
      ...d.data(),
      submittedAt: d.data().submittedAt?.toDate?.()?.toISOString() ?? null
    }));
    const students = studentsSnap.docs.map(d => ({
      ...d.data(),
      completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null
    }));
    const orderedInstructorKeys = instructorsSnap.docs.map(d => {
      const { name, education } = d.data();
      return education ? `${education}__${name}` : name;
    });

    document.getElementById('stats-loading').style.display = 'none';

    if (!responses || responses.length === 0) {
      document.getElementById('stats-no-data').style.display = 'block';
      return;
    }

    lastResponses = responses;
    lastOrderedInstructorKeys = orderedInstructorKeys;
    renderStats(responses, students, orderedInstructorKeys);
    document.getElementById('stats-area').style.display = 'block';
  } catch (e) {
    document.getElementById('stats-loading').textContent = '데이터를 불러오지 못했습니다.';
  }
}

function renderStats(responses, students, orderedInstructorKeys = []) {
  const n = responses.length;
  const totalStudents = students.length;
  const completedStudents = students.filter(s => s.completed).length;
  const rate = totalStudents > 0 ? Math.round(completedStudents / totalStudents * 100) : 0;
  const notCompleted = students.filter(s => !s.completed);

  document.getElementById('total-students').textContent = totalStudents + '명';
  document.getElementById('completion-rate').textContent = rate + '%';
  document.getElementById('completion-detail').textContent = `${completedStudents} / ${totalStudents}명`;
  document.getElementById('not-completed').textContent = notCompleted.length + '명';

  const ncSection = document.getElementById('not-completed-section');
  if (notCompleted.length > 0) {
    ncSection.style.display = 'block';
    document.getElementById('not-completed-list').innerHTML = notCompleted.map(s =>
      `<span class="nc-badge">${s.name}</span>`
    ).join('');
  } else {
    ncSection.style.display = 'none';
  }

  const keys = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'];
  const avgs = keys.map(k => responses.reduce((acc, r) => acc + (Number(r[k]) || 0), 0) / n);
  const dists = keys.map((k) => [1,2,3,4,5].map(v => responses.filter(r => Number(r[k]) === v).length));
  const hasData = keys.map((k, i) => dists[i].some(c => c > 0));
  const validAvgs = avgs.filter((_, i) => hasData[i]);

  const makeQCard = (avg, i, dist) => {
    if (!hasData[i]) return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${Q_LABELS[i]}</span>
          <span class="q-stat-avg" style="color:#aaa;">응답 없음</span>
        </div>
        <div style="color:#bbb;font-size:0.82rem;padding:0.3rem 0;">아직 수집된 응답이 없습니다.</div>
      </div>`;
    const pct = (avg / 5 * 100).toFixed(1);
    const color = avg >= 4.5 ? '#22c55e' : avg >= 3.5 ? '#0066cc' : avg >= 2.5 ? '#f59e0b' : '#ef4444';
    const satisfyPct = n > 0 ? ((dist[3] + dist[4]) / n * 100).toFixed(1) : '0.0';
    return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${Q_LABELS[i]}</span>
          <span class="q-stat-avg" style="color:${color}">${avg.toFixed(2)}점</span>
          <span class="q-stat-satisfy">만족이상 ${satisfyPct}%</span>
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
  };

  document.getElementById('question-stats').innerHTML = QUESTION_CATEGORIES.map(cat => {
    const validIdx = cat.indices.filter(i => hasData[i]);
    const catValidAvgs = validIdx.map(i => avgs[i]);
    const catAvg = catValidAvgs.length > 0 ? catValidAvgs.reduce((a, b) => a + b, 0) / catValidAvgs.length : null;
    const catColor = catAvg !== null ? (catAvg >= 4.5 ? '#22c55e' : catAvg >= 3.5 ? '#0066cc' : catAvg >= 2.5 ? '#f59e0b' : '#ef4444') : '#aaa';
    const catSatisfyTotal = validIdx.reduce((sum, i) => sum + dists[i].reduce((a, b) => a + b, 0), 0);
    const catSatisfyCount = validIdx.reduce((sum, i) => sum + dists[i][3] + dists[i][4], 0);
    const catSatisfyPct = catSatisfyTotal > 0 ? (catSatisfyCount / catSatisfyTotal * 100).toFixed(1) : null;
    const catAvgHtml = catAvg !== null
      ? `<span class="cat-header-avg" style="color:${catColor}">평균 ${catAvg.toFixed(2)}점 &nbsp;·&nbsp; 만족이상 ${catSatisfyPct}%</span>`
      : '';
    return `<div class="cat-header">${cat.label}${catAvgHtml}</div>` +
      cat.indices.map(i => makeQCard(avgs[i], i, dists[i])).join('');
  }).join('');

  const instScoreMap = {};
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

  // Firestore 입력 순서(orderedInstructorKeys)를 우선 사용하고, 없으면 응답 데이터 순으로 fallback
  const allInstKeys = Object.keys(instScoreMap);
  const instKeys = orderedInstructorKeys.filter(k => instScoreMap[k])
    .concat(allInstKeys.filter(k => !orderedInstructorKeys.includes(k)));
  if (instKeys.length > 0) {
    document.getElementById('instructor-stats-section').style.display = 'block';
    const allInstScores = instKeys.flatMap(k => instScoreMap[k]);
    const instTotalAvg = allInstScores.reduce((a, b) => a + b, 0) / allInstScores.length;
    const instTotalColor = instTotalAvg >= 4.5 ? '#22c55e' : instTotalAvg >= 3.5 ? '#0066cc' : instTotalAvg >= 2.5 ? '#f59e0b' : '#ef4444';
    const instTotalSatisfyPct = allInstScores.length > 0 ? (allInstScores.filter(s => s >= 4).length / allInstScores.length * 100).toFixed(1) : '0.0';
    document.getElementById('instructor-stats').innerHTML = `
      <div class="inst-total-summary">
        <span class="inst-total-label">강사 전체 평균</span>
        <span class="inst-total-avg" style="color:${instTotalColor}">${instTotalAvg.toFixed(2)}점</span>
        <span class="q-stat-satisfy">만족이상 ${instTotalSatisfyPct}%</span>
      </div>` + instKeys.map(key => {
      const scores = instScoreMap[key];
      const cnt = scores.length;
      const avg = scores.reduce((a, b) => a + b, 0) / cnt;
      const pct = (avg / 5 * 100).toFixed(1);
      const color = avg >= 4.5 ? '#22c55e' : avg >= 3.5 ? '#0066cc' : avg >= 2.5 ? '#f59e0b' : '#ef4444';
      const dist = [1,2,3,4,5].map(v => scores.filter(s => s === v).length);
      const instSatisfyPct = cnt > 0 ? ((dist[3] + dist[4]) / cnt * 100).toFixed(1) : '0.0';
      const parts = key.split('__');
      const label = parts.length === 2
        ? `👨‍🏫 [${escapeHtml(parts[0])}] ${escapeHtml(parts[1])} 강사`
        : `👨‍🏫 ${escapeHtml(key)} 강사`;
      return `
        <div class="q-stat-card">
          <div class="q-stat-header">
            <span class="q-stat-label">${label}</span>
            <span class="q-stat-avg" style="color:${color}">${avg.toFixed(2)}점</span>
            <span class="q-stat-satisfy">만족이상 ${instSatisfyPct}%</span>
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

  // 전체 평균: Q1~Q9 + 각 강사 개별 평균 (반올림된 값 기준, 엑셀 셀 선택과 일치)
  const allScoresForOverall = validAvgs.map(v => Number(v.toFixed(2)));
  instKeys.forEach(k => {
    const scores = instScoreMap[k];
    if (scores && scores.length > 0) {
      allScoresForOverall.push(Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)));
    }
  });
  const overallAvg = allScoresForOverall.length > 0 ? allScoresForOverall.reduce((a, b) => a + b, 0) / allScoresForOverall.length : 0;
  document.getElementById('overall-avg').textContent = overallAvg.toFixed(2);

  document.getElementById('demographics-stats-section').style.display = 'block';
  document.getElementById('demographics-stats').innerHTML = DEMO_QUESTIONS.map(dq => {
    const counts = dq.options.map(opt => responses.filter(r => r[dq.key] === opt).length);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) {
      return `
        <div class="q-stat-card">
          <div class="q-stat-header">
            <span class="q-stat-label">${dq.label}</span>
            <span class="q-stat-avg" style="color:#aaa;">응답 없음</span>
          </div>
          <div style="color:#bbb;font-size:0.82rem;padding:0.3rem 0;">아직 수집된 응답이 없습니다.</div>
        </div>`;
    }
    return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${dq.label}</span>
          <span class="q-stat-avg" style="color:#555;">${total}명 응답</span>
        </div>
        <div class="demo-dist">
          ${dq.options.map((opt, i) => {
            const cnt = counts[i];
            const pct = total > 0 ? (cnt / total * 100).toFixed(1) : 0;
            return `
              <div class="demo-item">
                <span class="demo-label">${i + 1}. ${escapeHtml(opt)}</span>
                <div class="bar-track" style="flex:1;"><div class="bar-fill" style="width:${pct}%;background:#0066cc;"></div></div>
                <span class="demo-count">${cnt}명 (${pct}%)</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  const subjectiveTypes = [
    { key: 'q10_comment', label: 'Q10. 기타 편의시설 건의사항' },
    { key: 'comment1', label: '소감 및 건의사항' },
    { key: 'comment2', label: '만족도 평가 개선 필요 부분' },
    { key: 'comment3', label: '전반적인 과목 및 강사 건의' },
    { key: 'comment', label: '기타 의견 (이전 양식)' },
  ];
  let totalCommentCount = 0;
  let commentListHtml = '';
  subjectiveTypes.forEach(({ key, label }) => {
    const items = responses.filter(r => r[key] && String(r[key]).trim());
    if (!items.length) return;
    totalCommentCount += items.length;
    commentListHtml += `<div class="comment-sub-title">${escapeHtml(label)}</div>`;
    commentListHtml += items.map(r => `
      <div class="comment-item">
        <div class="comment-date">익명 · ${formatDate(r.submittedAt)}</div>
        <div class="comment-text">${escapeHtml(String(r[key]))}</div>
      </div>`).join('');
  });
  document.getElementById('comment-count').textContent = totalCommentCount + '건';
  document.getElementById('comments-list').innerHTML = commentListHtml || '<div class="no-comment">작성된 의견이 없습니다.</div>';
}

// ── 엑셀 내보내기 ──────────────────────────────
function exportStatsExcel() {
  if (!lastResponses.length) return;

  const wb = XLSX.utils.book_new();

  const instKeySet = new Set();
  lastResponses.forEach(r => {
    let obj = r.instructors || {};
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return; } }
    Object.keys(obj).forEach(k => instKeySet.add(k));
  });
  const allInstKeys = [...instKeySet];
  // Firestore 입력 순서를 우선 사용하고, 없으면 응답 데이터 순으로 fallback
  const instKeys = lastOrderedInstructorKeys.filter(k => instKeySet.has(k))
    .concat(allInstKeys.filter(k => !lastOrderedInstructorKeys.includes(k)));

  const instHeaders = instKeys.map(k => {
    const parts = k.split('__');
    return parts.length === 2 ? `[${parts[0]}] ${parts[1]} 강사` : `${k} 강사`;
  });
  const totalCols = 9 + 1 + 6 + instKeys.length;
  const headers1 = ['순번', ...Array.from({length: totalCols}, (_, i) => i + 1)];
  const sheet1Data = [headers1];

  lastResponses.forEach((r, idx) => {
    const row = [idx + 1];
    ['q1','q2','q3','q4','q5','q6','q7','q8','q9'].forEach(k => {
      const v = Number(r[k]);
      row.push((v >= 1 && v <= 5) ? 6 - v : '');
    });
    row.push('');
    DEMO_QUESTIONS.forEach(dq => {
      const val = String(r[dq.key] || '').trim();
      const i = val ? dq.options.indexOf(val) + 1 : '';
      row.push(i > 0 ? `${i}_0` : '');
    });
    let instObj = r.instructors || {};
    if (typeof instObj === 'string') { try { instObj = JSON.parse(instObj); } catch { instObj = {}; } }
    instKeys.forEach(k => {
      const v = Number(instObj[k]);
      row.push((v >= 1 && v <= 5) ? `${6 - v}_0` : '');
    });
    sheet1Data.push(row);
  });

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1Data), '객관식');

  const sheet2Headers = [
    '순번',
    'Q10. 기타 편의시설 건의사항',
    '소감 및 건의사항',
    '만족도 평가 개선 필요 부분',
    '전반적인 과목 및 강사 건의',
  ];
  const sheet2Data = [sheet2Headers];
  let commentIdx = 1;
  lastResponses.forEach(r => {
    const q10 = String(r.q10_comment || '').trim();
    const c1 = String(r.comment1 || r.comment || '').trim();
    const c2 = String(r.comment2 || '').trim();
    const c3 = String(r.comment3 || '').trim();
    if (q10 || c1 || c2 || c3) {
      sheet2Data.push([commentIdx++, q10, c1, c2, c3]);
    }
  });
  if (sheet2Data.length === 1) {
    sheet2Data.push(['', '(수집된 주관식 응답이 없습니다)', '', '', '']);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2Data), '주관식');

  const filename = `${lastCourseName}_설문결과_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ── 결과 보기용 엑셀 내보내기 ──────────────────────────────
function exportResultsExcel() {
  if (!lastResponses.length) return;

  const responses = lastResponses;
  const n = responses.length;
  const wb = XLSX.utils.book_new();

  // ── 시트1: 만족도 통계 ──
  const keys = ['q1','q2','q3','q4','q5','q6','q7','q8','q9'];
  const avgs = keys.map(k => responses.reduce((acc, r) => acc + (Number(r[k]) || 0), 0) / n);
  const dists = keys.map(k => [1,2,3,4,5].map(v => responses.filter(r => Number(r[k]) === v).length));
  const satisfyPcts = dists.map(d => n > 0 ? (d[3] + d[4]) / n * 100 : 0);

  const instScoreMap2 = {};
  responses.forEach(r => {
    let obj = r.instructors || {};
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return; } }
    Object.entries(obj).forEach(([key, score]) => {
      if (!instScoreMap2[key]) instScoreMap2[key] = [];
      const v = Number(score);
      if (v >= 1 && v <= 5) instScoreMap2[key].push(v);
    });
  });
  const instKeySet2 = new Set(Object.keys(instScoreMap2));
  const instKeys2 = lastOrderedInstructorKeys.filter(k => instKeySet2.has(k))
    .concat([...instKeySet2].filter(k => !lastOrderedInstructorKeys.includes(k)));

  // 전체 평균: 반올림된 값 기준으로 계산 (엑셀 셀 선택과 일치)
  const validAvgs = avgs.filter((_, i) => dists[i].some(c => c > 0));
  const allScoresForOverall2 = validAvgs.map(v => Number(v.toFixed(2)));
  instKeys2.forEach(k => {
    const scores = instScoreMap2[k];
    if (scores && scores.length > 0) {
      allScoresForOverall2.push(Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)));
    }
  });
  const overallAvg = allScoresForOverall2.length > 0 ? allScoresForOverall2.reduce((a, b) => a + b, 0) / allScoresForOverall2.length : 0;

  const statsData = [
    ['교육과정', lastCourseName, '', '', '', '', '', ''],
    ['응답자 수', n + '명', '', '', '', '', '', ''],
    ['작성일', new Date().toLocaleDateString('ko-KR'), '', '', '', '', '', ''],
    ['전체 평균 (Q1~Q9 + 강사)', Number(overallAvg.toFixed(2)), '', '', '', '', '', ''],
    [],
    ['항목', '평균점수', '만족이상(%)', '1점(명)', '2점(명)', '3점(명)', '4점(명)', '5점(명)'],
  ];

  keys.forEach((k, i) => {
    statsData.push([
      Q_LABELS[i],
      Number(avgs[i].toFixed(2)),
      Number(satisfyPcts[i].toFixed(1)),
      dists[i][0], dists[i][1], dists[i][2], dists[i][3], dists[i][4]
    ]);
  });

  if (instKeys2.length > 0) {
    statsData.push([]);
    statsData.push(['── 강사별 만족도 ──', '', '', '', '', '', '', '']);
    const allInstScores2 = instKeys2.flatMap(k => instScoreMap2[k]);
    const instTotalAvg2 = allInstScores2.reduce((a, b) => a + b, 0) / allInstScores2.length;
    const instTotalSatisfyPct2 = allInstScores2.filter(s => s >= 4).length / allInstScores2.length * 100;
    statsData.push(['강사 전체 평균', Number(instTotalAvg2.toFixed(2)), Number(instTotalSatisfyPct2.toFixed(1)), '', '', '', '', '']);
    instKeys2.forEach(key => {
      const scores = instScoreMap2[key];
      const cnt = scores.length;
      const avg = scores.reduce((a, b) => a + b, 0) / cnt;
      const dist = [1,2,3,4,5].map(v => scores.filter(s => s === v).length);
      const satisfyPct = cnt > 0 ? (dist[3] + dist[4]) / cnt * 100 : 0;
      const parts = key.split('__');
      const label = parts.length === 2 ? `[${parts[0]}] ${parts[1]} 강사` : `${key} 강사`;
      statsData.push([label, Number(avg.toFixed(2)), Number(satisfyPct.toFixed(1)), dist[0], dist[1], dist[2], dist[3], dist[4]]);
    });
  }

  const ws1 = XLSX.utils.aoa_to_sheet(statsData);
  ws1['!cols'] = [{ wch: 42 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws1, '만족도 통계');

  // ── 시트2: 응답자 특성 ──
  const demoData = [
    ['교육과정', lastCourseName],
    ['응답자 수', n + '명'],
    [],
  ];
  DEMO_QUESTIONS.forEach(dq => {
    const counts = dq.options.map(opt => responses.filter(r => r[dq.key] === opt).length);
    const total = counts.reduce((a, b) => a + b, 0);
    demoData.push([dq.label, '인원(명)', '비율(%)']);
    dq.options.forEach((opt, i) => {
      const pct = total > 0 ? counts[i] / total * 100 : 0;
      demoData.push([`  ${opt}`, counts[i], Number(pct.toFixed(1))]);
    });
    demoData.push(['  합계', total, '']);
    demoData.push([]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(demoData);
  ws2['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, '응답자 특성');

  // ── 시트3: 주관식 의견 ──
  const commentData = [
    ['교육과정', lastCourseName],
    ['응답자 수', n + '명'],
    [],
    ['순번', 'Q10. 기타 편의시설 건의사항', '소감 및 건의사항', '만족도 평가 개선 필요 부분', '전반적인 과목 및 강사 건의'],
  ];
  let cidx = 1;
  responses.forEach(r => {
    const q10 = String(r.q10_comment || '').trim();
    const c1 = String(r.comment1 || r.comment || '').trim();
    const c2 = String(r.comment2 || '').trim();
    const c3 = String(r.comment3 || '').trim();
    if (q10 || c1 || c2 || c3) commentData.push([cidx++, q10, c1, c2, c3]);
  });
  if (commentData.length === 4) commentData.push(['', '(수집된 주관식 응답이 없습니다)', '', '', '']);
  const ws3 = XLSX.utils.aoa_to_sheet(commentData);
  ws3['!cols'] = [{ wch: 6 }, { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, ws3, '주관식 의견');

  // ── 분야별 카테고리 평균 계산 ──
  const catDefs = [
    { label: '교육기간', keys: ['q1'] },
    { label: '교육운영', keys: ['q2','q3','q4','q5','q6'] },
    { label: '교육효과', keys: ['q7'] },
    { label: '시설환경', keys: ['q8','q9'] },
  ];
  const catAvgs = catDefs.map(cat => {
    const vals = cat.keys.map(k => responses.reduce((a, r) => a + (Number(r[k]) || 0), 0) / n);
    return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
  });
  const allInstScores3 = instKeys2.flatMap(k => instScoreMap2[k]);
  const instCatAvg = allInstScores3.length > 0
    ? Number((allInstScores3.reduce((a, b) => a + b, 0) / allInstScores3.length).toFixed(2))
    : null;
  const chartLabels = [...catDefs.map(c => c.label), '강사'];
  const chartValues = [...catAvgs, instCatAvg];

  const filename = `${lastCourseName}_만족도결과_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);

  // ── 분야별 만족도 막대그래프 PNG 다운로드 ──
  const chartPng = generateCategoryChart(lastCourseName, chartLabels, chartValues);
  setTimeout(() => {
    const a = document.createElement('a');
    a.href = chartPng;
    a.download = `${lastCourseName}_분야별만족도_${new Date().toISOString().slice(0,10)}.png`;
    a.click();
  }, 400);
}

function generateCategoryChart(courseName, labels, values) {
  // 87.5×67.67mm 표시 기준, 3배 해상도로 제작
  const W = 875, H = 677;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const ml = 68, mr = 24, mt = 72, mb = 82;
  const cw = W - ml - mr, ch = H - mt - mb;

  // 배경
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 제목
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('분야별 만족도 현황', W / 2, 44);

  // Y축 그리드 및 레이블
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px sans-serif';
  for (let v = 0; v <= 5; v++) {
    const y = mt + ch - (v / 5) * ch;
    ctx.strokeStyle = v === 0 ? '#94a3b8' : '#dde3ed';
    ctx.lineWidth = v === 0 ? 2.5 : 1;
    ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + cw, y); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillText(String(v), ml - 8, y + 8);
  }

  // X축
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(ml, mt + ch); ctx.lineTo(ml + cw, mt + ch); ctx.stroke();

  // 막대
  const n = labels.length;
  const slotW = cw / n;
  const barW = slotW * 0.58;

  labels.forEach((label, i) => {
    const val = values[i];
    if (val === null || isNaN(val)) return;

    const x = ml + slotW * i + (slotW - barW) / 2;
    const barH = (val / 5) * ch;
    const y = mt + ch - barH;

    // 막대 (파란색 그라데이션)
    const grad = ctx.createLinearGradient(x, y, x, mt + ch);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#1e40af');
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barW, barH, [5, 5, 0, 0]);
    } else {
      ctx.rect(x, y, barW, barH);
    }
    ctx.fill();

    // 막대 상단 점수
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(val.toFixed(2), x + barW / 2, y - 11);

    // X축 레이블
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(label, x + barW / 2, mt + ch + 50);
  });

  return canvas.toDataURL('image/png');
}

// ── 유틸 ──────────────────────────────
function formatDate(val) {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
window.toggleSelectAll = toggleSelectAll;
window.updateBulkDeleteBtn = updateBulkDeleteBtn;
window.deleteSelectedStudents = deleteSelectedStudents;
window.handleExcelUpload = handleExcelUpload;
window.uploadExcelStudents = uploadExcelStudents;
window.loadStats = loadStats;
window.exportStatsExcel = exportStatsExcel;
window.exportResultsExcel = exportResultsExcel;
window.loadPreviewInstructors = loadPreviewInstructors;

// ── 출결관리 ──────────────────────────────
const ATT_TOKEN_SECONDS = 30;
// TODO: Cloudflare Pages 도메인으로 변경하세요
const DEPLOY_BASE_URL = 'https://hrd-survey.pages.dev';

let attSessionId = null;
let attCountdownInterval = null;
let attUnsubscribe = null;
let attLogData = [];

function generateAttToken() {
  const slot = Math.floor(Date.now() / (ATT_TOKEN_SECONDS * 1000));
  return btoa(slot.toString()).replace(/=/g, '');
}

function initAttendanceTab() {
  if (attSessionId) {
    document.getElementById('att-qr-card').style.display = 'block';
    document.getElementById('att-log-card').style.display = 'block';
  }
}

function startAttendanceSession() {
  const course = document.getElementById('att-course-name').value.trim();
  const session = document.getElementById('att-session-label').value;
  if (!course) {
    document.getElementById('att-course-name').focus();
    alert('과정명을 입력해 주세요.');
    return;
  }
  stopAttendanceSession(true);
  attSessionId = `${course}__${session}`;
  document.getElementById('att-session-info').textContent = `${course} · ${session}`;
  document.getElementById('att-qr-card').style.display = 'block';
  document.getElementById('att-log-card').style.display = 'block';
  renderAttQR();
  startAttCountdown();
  subscribeAttendanceLogs();
}

function stopAttendanceSession(silent = false) {
  if (!silent && !attSessionId) return;
  if (attCountdownInterval) { clearInterval(attCountdownInterval); attCountdownInterval = null; }
  if (attUnsubscribe) { attUnsubscribe(); attUnsubscribe = null; }
  if (!silent) {
    attSessionId = null;
    attLogData = [];
    document.getElementById('att-qr-card').style.display = 'none';
    document.getElementById('att-log-card').style.display = 'none';
  }
}

function renderAttQR() {
  if (!attSessionId) return;
  const token = generateAttToken();
  const parts = attSessionId.split('__');
  const course = encodeURIComponent(parts[0]);
  const session = encodeURIComponent(parts[1] || '');
  const url = `${DEPLOY_BASE_URL}/attend.html?token=${token}&session=${session}&course=${course}`;
  const canvas = document.getElementById('att-qr-canvas');
  QRCode.toCanvas(canvas, url, {
    width: 260,
    margin: 2,
    color: { dark: '#1e293b', light: '#ffffff' }
  }, err => { if (err) console.error('QR 생성 오류:', err); });
}

function startAttCountdown() {
  if (attCountdownInterval) clearInterval(attCountdownInterval);
  const update = () => {
    if (!attSessionId) return;
    const now = Date.now();
    const slotStart = Math.floor(now / (ATT_TOKEN_SECONDS * 1000)) * ATT_TOKEN_SECONDS * 1000;
    const elapsed = (now - slotStart) / 1000;
    const remaining = ATT_TOKEN_SECONDS - elapsed;
    document.getElementById('att-countdown-label').textContent =
      `다음 QR 갱신까지 ${Math.ceil(remaining)}초`;
    document.getElementById('att-countdown-bar').style.width =
      `${(remaining / ATT_TOKEN_SECONDS) * 100}%`;
    if (remaining <= 1) setTimeout(renderAttQR, 1100);
  };
  update();
  attCountdownInterval = setInterval(update, 1000);
}

function subscribeAttendanceLogs() {
  if (attUnsubscribe) attUnsubscribe();
  if (!attSessionId) return;
  const q = query(
    collection(db, 'attendance_logs'),
    where('sessionId', '==', attSessionId),
    orderBy('attendedAt', 'desc')
  );
  attUnsubscribe = onSnapshot(q, snap => {
    attLogData = snap.docs.map(d => ({
      ...d.data(),
      attendedAt: d.data().attendedAt?.toDate?.()?.toISOString() ?? null
    }));
    renderAttLogs();
  });
}

function renderAttLogs() {
  const tbody = document.getElementById('att-log-tbody');
  const empty = document.getElementById('att-log-empty');
  const badge = document.getElementById('att-count-badge');
  badge.textContent = `${attLogData.length}명`;
  if (!attLogData.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = attLogData.map(log => `
    <tr>
      <td>${escapeHtml(log.name || '')}</td>
      <td>${escapeHtml(String(log.participantCode || ''))}</td>
      <td>${escapeHtml(log.sessionLabel || '')}</td>
      <td>${formatDateTime(log.attendedAt)}</td>
    </tr>`).join('');
}

function exportAttendanceExcel() {
  if (!attLogData.length) { alert('출석 데이터가 없습니다.'); return; }
  const wb = XLSX.utils.book_new();
  const data = [
    ['이름', '교번', '과정명', '세션', '출석시간'],
    ...attLogData.map(log => [
      log.name || '',
      log.participantCode || '',
      log.courseName || '',
      log.sessionLabel || '',
      log.attendedAt ? formatDateTime(log.attendedAt) : ''
    ])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:10},{wch:8},{wch:20},{wch:12},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws, '출석명단');
  const parts = (attSessionId || 'attendance').split('__');
  XLSX.writeFile(wb, `출석_${parts[0]}_${parts[1] || ''}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function toggleAttendanceFullscreen() {
  const card = document.getElementById('att-qr-card');
  if (!document.fullscreenElement) {
    card.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

window.startAttendanceSession = startAttendanceSession;
window.stopAttendanceSession = stopAttendanceSession;
window.exportAttendanceExcel = exportAttendanceExcel;
window.toggleAttendanceFullscreen = toggleAttendanceFullscreen;
