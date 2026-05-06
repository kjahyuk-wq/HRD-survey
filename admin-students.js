import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs,
  addDoc, deleteDoc, doc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr, formatDateTime } from './admin-utils.js';
import { loadXLSX } from './admin-excel.js';

// ── 수강생 관리 ──────────────────────────────
let studentsCache = [];

export async function loadStudents() {
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
    const courseId = state.courseIdMap[course];
    const snap = await getDocs(collection(db, 'courses', courseId, 'students'));
    const students = snap.docs.map(d => ({
      ...d.data(),
      _id: d.id,
      completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null
    })).sort((a, b) => Number(a.empNo) - Number(b.empNo));
    studentsCache = students;
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
            ${students.map((s, idx) => `
              <tr id="student-row-${idx}">
                <td><input type="checkbox" class="student-checkbox" data-id="${escapeAttr(s._id)}" data-name="${escapeAttr(s.name)}" data-empno="${escapeAttr(s.empNo)}" onchange="updateBulkDeleteBtn()"></td>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.empNo)}</td>
                <td>${s.completed
                  ? `<span class="status-done">✅ 완료</span>${s.completedAt ? `<br><small class="completed-at">${formatDateTime(s.completedAt)}</small>` : ''}`
                  : `<span class="status-pending">⏳ 미완료</span>`}
                </td>
                <td>
                  <div class="inst-action-btns">
                    <button class="inst-edit-btn" onclick="startEditStudent(${idx})">수정</button>
                    <button class="delete-btn" onclick="deleteStudent('${escapeAttr(s.name)}','${escapeAttr(s.empNo)}','${escapeAttr(course)}','${escapeAttr(s._id)}',this)">삭제</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    document.getElementById('student-loading').textContent = '불러오기 실패';
  }
}

export async function addStudent() {
  const course = document.getElementById('student-course-select').value;
  const name = document.getElementById('new-student-name').value.trim();
  const empNo = document.getElementById('new-student-empno').value.trim();

  if (!course) { alert('교육과정을 먼저 선택해 주세요.'); return; }
  if (!name) { document.getElementById('new-student-name').focus(); return; }
  if (!/^\d+$/.test(empNo) || parseInt(empNo) < 1) { alert('교번을 올바르게 입력해 주세요. (1 이상의 숫자)'); return; }

  const addBtns = document.querySelectorAll('.add-btn');
  addBtns.forEach(b => { b.disabled = true; b.textContent = '등록 중...'; });

  try {
    const courseId = state.courseIdMap[course];
    await addDoc(collection(db, 'courses', courseId, 'students'), {
      name, empNo, completed: false, completedAt: null
    });
    document.getElementById('new-student-name').value = '';
    document.getElementById('new-student-empno').value = '';
    await loadStudents();
  } catch (e) { alert('등록 중 오류가 발생했습니다.'); }
  finally { addBtns.forEach(b => { b.disabled = false; b.textContent = '+ 등록'; }); }
}

export function toggleSelectAll(checkbox) {
  document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = checkbox.checked);
  updateBulkDeleteBtn();
}

export function updateBulkDeleteBtn() {
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

export async function deleteSelectedStudents() {
  const course = document.getElementById('student-course-select').value;
  const checked = document.querySelectorAll('.student-checkbox:checked');
  if (!checked.length) return;
  const count = checked.length;
  if (!confirm(`선택한 ${count}명의 수강생을 삭제하시겠습니까?\n해당 수강생들의 설문 응답도 함께 삭제됩니다.`)) return;
  const btn = document.getElementById('bulk-delete-btn');
  btn.disabled = true;
  btn.textContent = '삭제 중...';
  try {
    const courseId = state.courseIdMap[course];
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

export async function deleteStudent(name, empNo, course, studentId, btnEl) {
  if (!confirm(`"${name}" 수강생을 삭제하시겠습니까?\n해당 수강생의 설문 응답도 함께 삭제됩니다.`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    const courseId = state.courseIdMap[course];
    const respSnap = await getDocs(query(collection(db, 'courses', courseId, 'responses'), where('empNo', '==', empNo)));
    const matching = respSnap.docs.filter(d => d.data().name === name);
    await Promise.all(matching.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'courses', courseId, 'students', studentId));
    await loadStudents();
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

// ── 수강생 수정 ──────────────────────────────
export function startEditStudent(idx) {
  const s = studentsCache[idx];
  if (!s) return;
  const row = document.getElementById(`student-row-${idx}`);
  if (!row) return;
  const course = document.getElementById('student-course-select').value;
  const ec = escapeAttr(course);
  row.innerHTML = `
    <td><input type="checkbox" disabled></td>
    <td><input type="text" id="edit-stu-name-${idx}" value="${escapeAttr(s.name)}" maxlength="20" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td><input type="number" id="edit-stu-empno-${idx}" value="${escapeAttr(s.empNo)}" min="1" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td></td>
    <td>
      <div class="inst-action-btns">
        <button class="inst-save-btn" onclick="saveEditStudent(${idx})">저장</button>
        <button class="inst-cancel-btn" onclick="cancelEditStudent()">취소</button>
      </div>
    </td>`;
  document.getElementById(`edit-stu-name-${idx}`)?.focus();
}

export async function saveEditStudent(idx) {
  const s = studentsCache[idx];
  if (!s) return;
  const course = document.getElementById('student-course-select').value;
  const nameEl  = document.getElementById(`edit-stu-name-${idx}`);
  const empNoEl = document.getElementById(`edit-stu-empno-${idx}`);
  const name  = nameEl?.value.trim();
  const empNo = empNoEl?.value.trim();
  if (!name)  { nameEl?.focus(); return; }
  if (!empNo || !/^\d+$/.test(empNo) || parseInt(empNo) < 1) {
    alert('교번을 올바르게 입력해 주세요. (1 이상의 숫자)');
    empNoEl?.focus(); return;
  }
  const saveBtn = document.querySelector(`#student-row-${idx} .inst-save-btn`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
  try {
    const courseId = state.courseIdMap[course];
    await updateDoc(doc(db, 'courses', courseId, 'students', s._id), { name, empNo });
    await loadStudents();
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
  }
}

export async function cancelEditStudent() {
  await loadStudents();
}

// ── 엑셀 일괄 등록 ──────────────────────────────
let excelStudentData = [];
let _docDragGuardInit = false;

function initDocDragGuard() {
  if (_docDragGuardInit) return;
  _docDragGuardInit = true;
  // 드롭 영역을 살짝 벗어나 떨어뜨려도 브라우저가 파일을 여는 동작 차단
  ['dragover', 'drop'].forEach(ev => {
    window.addEventListener(ev, e => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
      }
    }, false);
  });
}

function initExcelDragDrop() {
  initDocDragGuard();
  const area = document.querySelector('.excel-upload-area');
  if (!area || area.dataset.dragInit) return;
  area.dataset.dragInit = '1';

  area.addEventListener('dragenter', e => {
    e.preventDefault();
    e.stopPropagation();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', e => {
    e.stopPropagation();
    if (!area.contains(e.relatedTarget)) area.classList.remove('drag-over');
  });
  area.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    area.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.');
      return;
    }
    try {
      await loadXLSX();
    } catch (err) {
      alert('엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
      return;
    }
    document.getElementById('excel-file-name').textContent = file.name;
    parseExcelFile(file);
  });
}

export async function handleExcelUpload(input) {
  const file = input.files[0];
  if (!file) return;
  await loadXLSX();
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

export async function uploadExcelStudents() {
  const course = document.getElementById('student-course-select').value;
  if (!course) { alert('교육과정을 먼저 선택해 주세요.'); return; }
  if (excelStudentData.length === 0) return;

  const btn = document.getElementById('excel-upload-btn');
  btn.disabled = true;
  const progress = document.getElementById('excel-progress');
  progress.style.display = 'block';

  const courseId = state.courseIdMap[course];
  const studentsRef = collection(db, 'courses', courseId, 'students');
  const total = excelStudentData.length;
  const CHUNK = 400; // Firestore batch 한도 500 미만으로 안전 마진
  let success = 0, fail = 0;

  for (let start = 0; start < total; start += CHUNK) {
    const slice = excelStudentData.slice(start, start + CHUNK);
    progress.textContent = `등록 중... (${start + slice.length}/${total})`;
    const batch = writeBatch(db);
    for (const { empNo, name } of slice) {
      batch.set(doc(studentsRef), { name, empNo, completed: false, completedAt: null });
    }
    try {
      await batch.commit();
      success += slice.length;
    } catch (_) {
      fail += slice.length;
    }
  }

  progress.textContent = `✅ 완료: ${success}명 등록${fail > 0 ? `, ❌ ${fail}명 실패` : ''}`;
  excelStudentData = [];
  document.getElementById('excel-file-input').value = '';
  document.getElementById('excel-file-name').textContent = '선택된 파일 없음';
  document.getElementById('excel-preview').style.display = 'none';

  await loadStudents();
}
