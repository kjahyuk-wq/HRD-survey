import { db } from './firebase-config.js';
import {
  collection, query, orderBy, getDocs,
  addDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr } from './admin-utils.js';
import { loadXLSX } from './admin-excel.js';

// ── 교육과정 관리 ──────────────────────────────
export async function loadCourseList() {
  document.getElementById('course-manage-loading').style.display = 'block';
  document.getElementById('course-manage-list').innerHTML = '';
  document.getElementById('course-manage-empty').style.display = 'none';

  try {
    const snap = await getDocs(collection(db, 'courses'));
    document.getElementById('course-manage-loading').style.display = 'none';

    state.courseIdMap = {};
    const courses = snap.docs.map(d => {
      state.courseIdMap[d.data().name] = d.id;
      return d.data().name;
    });

    document.getElementById('course-count').textContent = courses.length + '개';

    if (!courses.length) {
      document.getElementById('course-manage-empty').style.display = 'block';
    } else {
      document.getElementById('course-manage-list').innerHTML = courses.map((name, idx) => `
        <div class="course-manage-item" id="course-item-${idx}">
          <div class="course-manage-row">
            <span class="course-manage-name">📚 ${escapeHtml(name)}</span>
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
      courses.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    if (prev) sel.value = prev;

  } catch (e) {
    document.getElementById('course-manage-loading').textContent = '불러오기 실패';
  }
}

export async function addCourse() {
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

export async function deleteCourse(name, btnEl) {
  if (!confirm(`"${name}" 과정을 삭제하시겠습니까?\n(기존 설문 데이터는 유지됩니다)`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    const courseId = state.courseIdMap[name];
    await deleteSubcollection(courseId, 'instructors');
    await deleteSubcollection(courseId, 'students');
    await deleteSubcollection(courseId, 'responses');
    await deleteDoc(doc(db, 'courses', courseId));
    await loadCourseList();
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

export async function deleteSubcollection(courseId, subcollectionName) {
  const snap = await getDocs(collection(db, 'courses', courseId, subcollectionName));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// ── 강사 엑셀 일괄 등록 ──────────────────────────────
const instExcelData = {};

export function handleInstExcelUpload(panelIdx, input) {
  const fileName = input.files[0]?.name || '선택된 파일 없음';
  document.getElementById(`inst-excel-name-${panelIdx}`).textContent = fileName;
  if (input.files[0]) parseInstExcelFile(panelIdx, input.files[0]);
}

async function parseInstExcelFile(panelIdx, file) {
  document.getElementById(`inst-excel-preview-${panelIdx}`).style.display = 'none';
  document.getElementById(`inst-excel-progress-${panelIdx}`).style.display = 'none';
  document.getElementById(`inst-excel-btn-${panelIdx}`).disabled = true;
  instExcelData[panelIdx] = [];

  await loadXLSX();
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const parsed = [], errors = [];
      for (let i = 1; i < rows.length; i++) {
        const edu  = String(rows[i][0] || '').trim();
        const name = String(rows[i][1] || '').trim();
        if (!edu && !name) continue;
        if (!edu) { errors.push(`${i+1}행: 강의명이 없습니다.`); continue; }
        if (!name) { errors.push(`${i+1}행: 강사명이 없습니다.`); continue; }
        parsed.push({ edu, name });
      }

      const preview = document.getElementById(`inst-excel-preview-${panelIdx}`);
      preview.style.display = 'block';

      if (parsed.length === 0 && errors.length === 0) {
        preview.innerHTML = '<div class="excel-preview-error">데이터가 없습니다. 파일을 확인해 주세요.</div>';
        return;
      }

      let html = `<strong>총 ${parsed.length}건 인식됨</strong>`;
      if (errors.length > 0) {
        html += errors.map(err => `<div class="excel-preview-error">⚠️ ${escapeHtml(err)}</div>`).join('');
      }
      html += parsed.map((s, i) =>
        `<div class="excel-preview-row">${i+1}. [${escapeHtml(s.edu)}] ${escapeHtml(s.name)}</div>`
      ).join('');
      preview.innerHTML = html;

      if (parsed.length > 0) {
        instExcelData[panelIdx] = parsed;
        document.getElementById(`inst-excel-btn-${panelIdx}`).disabled = false;
      }
    } catch(err) {
      const preview = document.getElementById(`inst-excel-preview-${panelIdx}`);
      preview.style.display = 'block';
      preview.innerHTML = '<div class="excel-preview-error">파일을 읽을 수 없습니다. 엑셀 형식(.xlsx/.xls)인지 확인해 주세요.</div>';
    }
  };
  reader.readAsArrayBuffer(file);
}

export async function uploadExcelInstructors(courseName, panelIdx) {
  const data = instExcelData[panelIdx];
  if (!data || data.length === 0) return;

  const btn = document.getElementById(`inst-excel-btn-${panelIdx}`);
  btn.disabled = true;
  const progress = document.getElementById(`inst-excel-progress-${panelIdx}`);
  progress.style.display = 'block';

  const courseId = state.courseIdMap[courseName];
  let success = 0, fail = 0;
  for (let i = 0; i < data.length; i++) {
    const { edu, name } = data[i];
    progress.textContent = `등록 중... (${i+1}/${data.length}) ${name}`;
    try {
      await addDoc(collection(db, 'courses', courseId, 'instructors'), { name, education: edu, createdAt: serverTimestamp() });
      success++;
    } catch(_) {
      fail++;
    }
  }

  progress.textContent = `✅ 완료: ${success}건 등록${fail > 0 ? `, ❌ ${fail}건 실패` : ''}`;
  instExcelData[panelIdx] = [];
  document.getElementById(`inst-excel-input-${panelIdx}`).value = '';
  document.getElementById(`inst-excel-name-${panelIdx}`).textContent = '선택된 파일 없음';
  document.getElementById(`inst-excel-preview-${panelIdx}`).style.display = 'none';

  await loadInstructors(courseName, panelIdx);
}

// ── 강사 관리 ──────────────────────────────
export async function toggleInstructors(courseName, idx) {
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
    const courseId = state.courseIdMap[courseName];
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
    : `<div class="student-bulk-actions">
        <button class="bulk-delete-btn" id="inst-bulk-delete-btn-${panelIdx}" onclick="deleteSelectedInstructors('${ec}', ${panelIdx})" disabled>선택 삭제</button>
      </div>
      <table class="student-table">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" id="inst-select-all-${panelIdx}" onclick="toggleInstSelectAll(${panelIdx}, this)"></th>
          <th>강의명</th><th>강사명</th><th></th>
        </tr></thead>
        <tbody>
          ${instructors.map((inst) => {
            const name = typeof inst === 'string' ? inst : inst.name;
            const edu  = typeof inst === 'string' ? '' : (inst.education || '');
            const en = escapeAttr(name), ee = escapeAttr(edu), eid = escapeAttr(inst._id || '');
            return `<tr>
              <td><input type="checkbox" class="inst-checkbox-${panelIdx}" data-id="${eid}" data-name="${en}" onchange="updateInstBulkDeleteBtn(${panelIdx})"></td>
              <td>${escapeHtml(edu)}</td>
              <td>${escapeHtml(name)}</td>
              <td><button class="delete-btn" onclick="deleteInstructor('${ec}', ${panelIdx}, '${en}', '${ee}', '${eid}', this)">삭제</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

  panel.innerHTML = `
    <div class="inst-add-row">
      <input type="text" id="inst-edu-${panelIdx}" placeholder="교육명 (예: AI 기초과정)" maxlength="50">
      <input type="text" id="inst-name-${panelIdx}" placeholder="강사명 (예: 홍길동)" maxlength="20">
      <button class="add-btn inst-add-btn" onclick="addInstructor('${ec}', ${panelIdx})">+ 추가</button>
    </div>
    <div class="excel-upload-area" style="margin-top:.5rem;">
      <div class="excel-upload-label">📂 엑셀 일괄 등록 <span class="excel-tip">A열: 강의명 / B열: 강사명 / 2행부터 데이터</span></div>
      <div class="excel-upload-row">
        <label class="excel-file-btn" for="inst-excel-input-${panelIdx}">파일 선택</label>
        <input type="file" id="inst-excel-input-${panelIdx}" accept=".xlsx,.xls" style="display:none" onchange="handleInstExcelUpload(${panelIdx}, this)">
        <span id="inst-excel-name-${panelIdx}" class="excel-file-name">선택된 파일 없음</span>
        <button class="add-btn" id="inst-excel-btn-${panelIdx}" onclick="uploadExcelInstructors('${ec}', ${panelIdx})" disabled>일괄 등록</button>
      </div>
      <div id="inst-excel-preview-${panelIdx}" class="excel-preview" style="display:none;"></div>
      <div id="inst-excel-progress-${panelIdx}" class="excel-progress" style="display:none;"></div>
    </div>
    <div class="inst-list" id="inst-list-${panelIdx}">${listHtml}</div>`;
}

export async function addInstructor(courseName, panelIdx) {
  const edu  = document.getElementById(`inst-edu-${panelIdx}`).value.trim();
  const name = document.getElementById(`inst-name-${panelIdx}`).value.trim();
  if (!edu)  { document.getElementById(`inst-edu-${panelIdx}`).focus(); return; }
  if (!name) { document.getElementById(`inst-name-${panelIdx}`).focus(); return; }

  const btn = document.querySelector(`#inst-panel-${panelIdx} .inst-add-btn`);
  btn.disabled = true; btn.textContent = '추가 중...';
  try {
    const courseId = state.courseIdMap[courseName];
    await addDoc(collection(db, 'courses', courseId, 'instructors'), { name, education: edu, createdAt: serverTimestamp() });
    document.getElementById(`inst-edu-${panelIdx}`).value = '';
    document.getElementById(`inst-name-${panelIdx}`).value = '';
    await loadInstructors(courseName, panelIdx);
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); btn.disabled = false; btn.textContent = '+ 추가'; }
}

export async function deleteInstructor(courseName, panelIdx, name, education, instId, btnEl) {
  if (!confirm(`"${name}" 강사를 삭제하시겠습니까?`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    const courseId = state.courseIdMap[courseName];
    await deleteDoc(doc(db, 'courses', courseId, 'instructors', instId));
    await loadInstructors(courseName, panelIdx);
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

export function toggleInstSelectAll(panelIdx, checkbox) {
  document.querySelectorAll(`.inst-checkbox-${panelIdx}`).forEach(cb => cb.checked = checkbox.checked);
  updateInstBulkDeleteBtn(panelIdx);
}

export function updateInstBulkDeleteBtn(panelIdx) {
  const all = document.querySelectorAll(`.inst-checkbox-${panelIdx}`);
  const checked = document.querySelectorAll(`.inst-checkbox-${panelIdx}:checked`);
  const btn = document.getElementById(`inst-bulk-delete-btn-${panelIdx}`);
  const selectAll = document.getElementById(`inst-select-all-${panelIdx}`);
  if (btn) {
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length > 0 ? `선택 삭제 (${checked.length}명)` : '선택 삭제';
  }
  if (selectAll && all.length > 0) {
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    selectAll.checked = checked.length === all.length;
  }
}

export async function deleteSelectedInstructors(courseName, panelIdx) {
  const checked = document.querySelectorAll(`.inst-checkbox-${panelIdx}:checked`);
  if (!checked.length) return;
  const count = checked.length;
  if (!confirm(`선택한 ${count}명의 강사를 삭제하시겠습니까?`)) return;
  const btn = document.getElementById(`inst-bulk-delete-btn-${panelIdx}`);
  btn.disabled = true; btn.textContent = '삭제 중...';
  try {
    const courseId = state.courseIdMap[courseName];
    await Promise.all(Array.from(checked).map(cb => deleteDoc(doc(db, 'courses', courseId, 'instructors', cb.dataset.id))));
    await loadInstructors(courseName, panelIdx);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    btn.disabled = false; btn.textContent = `선택 삭제 (${count}명)`;
  }
}
