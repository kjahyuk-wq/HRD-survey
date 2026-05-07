import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs,
  addDoc, deleteDoc, doc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr, formatDateTime } from './admin-utils.js';
import { loadXLSX } from './admin-excel.js';

// ── 패널 단위 상태 ──────────────────────────────
// panelIdx → 학생 배열 / 엑셀 파싱 결과 / 분반 union 캐시
const studentsCache = {};
const excelStudentData = {};
const panelGroupsUnion = {};  // panelIdx → ['1조','2조',...] (회차들에 정의된 분반 union)

// 그 과정의 모든 회차에 정의된 분반 이름의 union을 계산
async function fetchRoundGroupsUnion(courseId) {
  try {
    const snap = await getDocs(collection(db, 'courses', courseId, 'rounds'));
    const set = new Set();
    snap.docs.forEach(d => {
      const groups = Array.isArray(d.data().groups) ? d.data().groups : [];
      groups.forEach(g => set.add(g));
    });
    return Array.from(set).sort();
  } catch (_) {
    return [];
  }
}

// ── 수강생 관리 ──────────────────────────────
export async function loadStudents(courseId, panelIdx) {
  if (!courseId || panelIdx === undefined) return;
  initExcelDragDrop(panelIdx);

  const loadingEl = document.getElementById(`stu-loading-${panelIdx}`);
  const listEl    = document.getElementById(`stu-list-${panelIdx}`);
  const emptyEl   = document.getElementById(`stu-empty-${panelIdx}`);
  const statsEl   = document.getElementById(`stu-stats-bar-${panelIdx}`);
  if (!listEl) return;

  if (loadingEl) loadingEl.style.display = 'block';
  listEl.innerHTML = '';
  if (emptyEl)  emptyEl.style.display = 'none';
  if (statsEl)  statsEl.innerHTML = '';

  try {
    // 학생 + 회차 분반 union 동시 fetch
    const [snap, groupsUnion] = await Promise.all([
      getDocs(collection(db, 'courses', courseId, 'students')),
      fetchRoundGroupsUnion(courseId)
    ]);
    const students = snap.docs.map(d => ({
      ...d.data(),
      _id: d.id,
      completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null
    })).sort((a, b) => Number(a.empNo) - Number(b.empNo));
    studentsCache[panelIdx] = students;
    panelGroupsUnion[panelIdx] = groupsUnion;
    syncStudentGroupSelect(panelIdx, groupsUnion);
    if (loadingEl) loadingEl.style.display = 'none';

    const total = students.length;
    const done = students.filter(s => s.completed).length;

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stu-stat">
          <span>전체 <strong>${total}명</strong></span>
          <span class="stu-done">완료 <strong>${done}명</strong></span>
          <span class="stu-pending">미완료 <strong>${total - done}명</strong></span>
          <div class="stu-progress-wrap">
            <div class="stu-progress-bar" style="width:${total > 0 ? (done/total*100) : 0}%"></div>
          </div>
        </div>`;
    }

    if (!students.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    const hasGroups = groupsUnion.length > 0;
    const groupCol = hasGroups ? '<th>분반</th>' : '';
    const groupCellFn = s => {
      if (!hasGroups) return '';
      const g = (s.group || '').trim();
      return g
        ? `<td><span class="rg-tag">${escapeHtml(g)}</span></td>`
        : '<td><span class="rg-empty">미배정</span></td>';
    };

    const cid = escapeAttr(courseId);
    listEl.innerHTML = `
      <div class="student-bulk-actions">
        <button class="bulk-delete-btn" id="stu-bulk-delete-btn-${panelIdx}" onclick="deleteSelectedStudents('${cid}', ${panelIdx})" disabled>선택 삭제</button>
      </div>
      <div class="student-table-wrap">
        <table class="student-table">
          <thead><tr>
            <th style="width:36px"><input type="checkbox" id="stu-select-all-${panelIdx}" onclick="toggleSelectAll(${panelIdx}, this)"></th>
            <th>이름</th><th>교번</th>${groupCol}<th>상태</th><th></th>
          </tr></thead>
          <tbody>
            ${students.map((s, idx) => `
              <tr id="stu-row-${panelIdx}-${idx}">
                <td><input type="checkbox" class="stu-checkbox-${panelIdx}" data-id="${escapeAttr(s._id)}" data-name="${escapeAttr(s.name)}" data-empno="${escapeAttr(s.empNo)}" onchange="updateBulkDeleteBtn(${panelIdx})"></td>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.empNo)}</td>
                ${groupCellFn(s)}
                <td>${s.completed
                  ? `<span class="status-done">완료</span>${s.completedAt ? `<br><small class="completed-at">${formatDateTime(s.completedAt)}</small>` : ''}`
                  : `<span class="status-pending">미완료</span>`}
                </td>
                <td>
                  <div class="inst-action-btns">
                    <button class="inst-edit-btn" onclick="startEditStudent('${cid}', ${panelIdx}, ${idx})">수정</button>
                    <button class="delete-btn" onclick="deleteStudent('${cid}', ${panelIdx}, '${escapeAttr(s.name)}','${escapeAttr(s.empNo)}','${escapeAttr(s._id)}',this)">삭제</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    if (loadingEl) loadingEl.textContent = '불러오기 실패';
  }
}

// 분반 union이 있으면 추가 폼의 분반 셀렉트와 엑셀 안내문 C열을 노출, 없으면 숨김
function syncStudentGroupSelect(panelIdx, groupsUnion) {
  const sel = document.getElementById(`new-stu-group-${panelIdx}`);
  const cHint = document.getElementById(`stu-excel-c-hint-${panelIdx}`);
  if (!sel) return;
  if (groupsUnion.length === 0) {
    sel.style.display = 'none';
    sel.innerHTML = '<option value="">-- 분반 --</option>';
    if (cHint) cHint.style.display = 'none';
    return;
  }
  sel.style.display = '';
  sel.innerHTML = '<option value="">-- 분반 --</option>' +
    groupsUnion.map(g => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join('');
  if (cHint) cHint.style.display = '';
}

export async function addStudent(courseId, panelIdx) {
  const nameEl  = document.getElementById(`new-stu-name-${panelIdx}`);
  const empNoEl = document.getElementById(`new-stu-empno-${panelIdx}`);
  const groupEl = document.getElementById(`new-stu-group-${panelIdx}`);
  const name = nameEl?.value.trim() || '';
  const empNo = empNoEl?.value.trim() || '';
  // 분반 union 있으면 셀렉트 값 사용, 없으면 group 미저장
  const hasGroups = (panelGroupsUnion[panelIdx] || []).length > 0;
  const group = (hasGroups && groupEl) ? (groupEl.value || '').trim() : '';

  if (!name) { nameEl?.focus(); return; }
  if (!/^\d+$/.test(empNo) || parseInt(empNo) < 1) { alert('교번을 올바르게 입력해 주세요. (1 이상의 숫자)'); return; }

  const btn = document.getElementById(`stu-add-btn-${panelIdx}`);
  if (btn) { btn.disabled = true; btn.textContent = '등록 중...'; }

  try {
    const data = { name, empNo, completed: false, completedAt: null };
    if (group) data.group = group;
    await addDoc(collection(db, 'courses', courseId, 'students'), data);
    if (nameEl) nameEl.value = '';
    if (empNoEl) empNoEl.value = '';
    if (groupEl) groupEl.value = '';
    await loadStudents(courseId, panelIdx);
  } catch (e) {
    console.error('addStudent 실패:', e);
    alert(`등록 중 오류가 발생했습니다.\n${e?.code || ''} ${e?.message || ''}`.trim());
  }
  finally { if (btn) { btn.disabled = false; btn.textContent = '+ 등록'; } }
}

export function toggleSelectAll(panelIdx, checkbox) {
  document.querySelectorAll(`.stu-checkbox-${panelIdx}`).forEach(cb => cb.checked = checkbox.checked);
  updateBulkDeleteBtn(panelIdx);
}

export function updateBulkDeleteBtn(panelIdx) {
  const all = document.querySelectorAll(`.stu-checkbox-${panelIdx}`);
  const checked = document.querySelectorAll(`.stu-checkbox-${panelIdx}:checked`);
  const btn = document.getElementById(`stu-bulk-delete-btn-${panelIdx}`);
  const selectAll = document.getElementById(`stu-select-all-${panelIdx}`);
  if (btn) {
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length > 0 ? `선택 삭제 (${checked.length}명)` : '선택 삭제';
  }
  if (selectAll && all.length > 0) {
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    selectAll.checked = checked.length === all.length;
  }
}

export async function deleteSelectedStudents(courseId, panelIdx) {
  const checked = document.querySelectorAll(`.stu-checkbox-${panelIdx}:checked`);
  if (!checked.length) return;
  const count = checked.length;
  if (!confirm(`선택한 ${count}명의 수강생을 삭제하시겠습니까?\n해당 수강생들의 설문 응답도 함께 삭제됩니다.`)) return;
  const btn = document.getElementById(`stu-bulk-delete-btn-${panelIdx}`);
  if (btn) { btn.disabled = true; btn.textContent = '삭제 중...'; }
  try {
    await Promise.all(Array.from(checked).map(async cb => {
      const studentId = cb.dataset.id;
      const name = cb.dataset.name;
      const empNo = cb.dataset.empno;
      const respSnap = await getDocs(query(collection(db, 'courses', courseId, 'responses'), where('empNo', '==', empNo)));
      const matching = respSnap.docs.filter(d => d.data().name === name);
      await Promise.all(matching.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'courses', courseId, 'students', studentId));
    }));
    await loadStudents(courseId, panelIdx);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    if (btn) { btn.disabled = false; btn.textContent = `선택 삭제 (${count}명)`; }
  }
}

export async function deleteStudent(courseId, panelIdx, name, empNo, studentId, btnEl) {
  if (!confirm(`"${name}" 수강생을 삭제하시겠습니까?\n해당 수강생의 설문 응답도 함께 삭제됩니다.`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    const respSnap = await getDocs(query(collection(db, 'courses', courseId, 'responses'), where('empNo', '==', empNo)));
    const matching = respSnap.docs.filter(d => d.data().name === name);
    await Promise.all(matching.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'courses', courseId, 'students', studentId));
    await loadStudents(courseId, panelIdx);
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

// ── 수강생 수정 ──────────────────────────────
export function startEditStudent(courseId, panelIdx, idx) {
  const s = studentsCache[panelIdx]?.[idx];
  if (!s) return;
  const row = document.getElementById(`stu-row-${panelIdx}-${idx}`);
  if (!row) return;
  const cid = escapeAttr(courseId);
  const groupsUnion = panelGroupsUnion[panelIdx] || [];
  const hasGroups = groupsUnion.length > 0;

  // 분반 정의된 과정에서만 분반 td 노출 (테이블 컬럼 정렬 유지)
  const groupTd = hasGroups
    ? `<td>
        <select id="edit-stu-group-${panelIdx}-${idx}" class="stu-group-select-edit">
          <option value="">미배정</option>
          ${groupsUnion.map(g => `<option value="${escapeAttr(g)}"${(s.group || '') === g ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('')}
        </select>
      </td>`
    : '';

  row.innerHTML = `
    <td><input type="checkbox" disabled></td>
    <td><input type="text" id="edit-stu-name-${panelIdx}-${idx}" value="${escapeAttr(s.name)}" maxlength="20" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td><input type="number" id="edit-stu-empno-${panelIdx}-${idx}" value="${escapeAttr(s.empNo)}" min="1" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    ${groupTd}
    <td></td>
    <td>
      <div class="inst-action-btns">
        <button class="inst-save-btn" onclick="saveEditStudent('${cid}', ${panelIdx}, ${idx})">저장</button>
        <button class="inst-cancel-btn" onclick="cancelEditStudent('${cid}', ${panelIdx})">취소</button>
      </div>
    </td>`;
  document.getElementById(`edit-stu-name-${panelIdx}-${idx}`)?.focus();
}

export async function saveEditStudent(courseId, panelIdx, idx) {
  const s = studentsCache[panelIdx]?.[idx];
  if (!s) return;
  const nameEl  = document.getElementById(`edit-stu-name-${panelIdx}-${idx}`);
  const empNoEl = document.getElementById(`edit-stu-empno-${panelIdx}-${idx}`);
  const groupEl = document.getElementById(`edit-stu-group-${panelIdx}-${idx}`);
  const name  = nameEl?.value.trim();
  const empNo = empNoEl?.value.trim();
  if (!name)  { nameEl?.focus(); return; }
  if (!empNo || !/^\d+$/.test(empNo) || parseInt(empNo) < 1) {
    alert('교번을 올바르게 입력해 주세요. (1 이상의 숫자)');
    empNoEl?.focus(); return;
  }
  const hasGroups = (panelGroupsUnion[panelIdx] || []).length > 0;

  const saveBtn = document.querySelector(`#stu-row-${panelIdx}-${idx} .inst-save-btn`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
  try {
    const updateData = { name, empNo };
    if (hasGroups && groupEl) {
      updateData.group = (groupEl.value || '').trim();  // 빈 문자열이면 '미배정'
    }
    await updateDoc(doc(db, 'courses', courseId, 'students', s._id), updateData);
    await loadStudents(courseId, panelIdx);
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
  }
}

export async function cancelEditStudent(courseId, panelIdx) {
  await loadStudents(courseId, panelIdx);
}

// ── 엑셀 일괄 등록 ──────────────────────────────
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

function initExcelDragDrop(panelIdx) {
  initDocDragGuard();
  const area = document.getElementById(`stu-panel-${panelIdx}`)?.querySelector('.stu-excel-area');
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
    const nameEl = document.getElementById(`stu-excel-name-${panelIdx}`);
    if (nameEl) nameEl.textContent = file.name;
    parseExcelFile(panelIdx, file);
  });
}

export async function handleExcelUpload(panelIdx, input) {
  const file = input.files[0];
  if (!file) return;
  await loadXLSX();
  const nameEl = document.getElementById(`stu-excel-name-${panelIdx}`);
  if (nameEl) nameEl.textContent = file.name;
  parseExcelFile(panelIdx, file);
}

function parseExcelFile(panelIdx, file) {
  const previewEl  = document.getElementById(`stu-excel-preview-${panelIdx}`);
  const progressEl = document.getElementById(`stu-excel-progress-${panelIdx}`);
  const btn        = document.getElementById(`stu-excel-btn-${panelIdx}`);
  if (previewEl)  previewEl.style.display = 'none';
  if (progressEl) progressEl.style.display = 'none';
  if (btn) btn.disabled = true;
  excelStudentData[panelIdx] = [];

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const groupsUnion = panelGroupsUnion[panelIdx] || [];
      const groupsSet = new Set(groupsUnion);  // 빠른 검증

      const parsed = [], errors = [];
      for (let i = 1; i < rows.length; i++) {
        const empNo = String(rows[i][0] || '').trim();
        const name  = String(rows[i][1] || '').trim();
        const group = String(rows[i][2] || '').trim();  // C열 분반 (선택)
        if (!empNo && !name && !group) continue;
        if (!empNo || !/^\d+$/.test(empNo) || parseInt(empNo) < 1) {
          errors.push(`${i+1}행: 교번이 올바르지 않습니다. (값: "${empNo}")`);
          continue;
        }
        if (!name) {
          errors.push(`${i+1}행: 이름이 없습니다.`);
          continue;
        }
        // 분반이 입력됐는데 회차에 정의되지 않은 이름이면 경고 (저장은 진행)
        if (group && groupsUnion.length > 0 && !groupsSet.has(group)) {
          errors.push(`${i+1}행: 분반 "${group}"이(가) 어느 회차에도 정의되지 않았습니다. (그대로 저장됨)`);
        }
        parsed.push({ empNo, name, group });
      }

      if (!previewEl) return;
      previewEl.style.display = 'block';

      if (parsed.length === 0 && errors.length === 0) {
        previewEl.innerHTML = '<div class="excel-preview-error">데이터가 없습니다. 파일을 확인해 주세요.</div>';
        return;
      }

      let html = `<strong>총 ${parsed.length}명 인식됨</strong>`;
      if (errors.length > 0) {
        html += errors.map(err => `<div class="excel-preview-error">${escapeHtml(err)}</div>`).join('');
      }
      html += parsed.map((s, i) => {
        const groupTag = s.group ? ` · <span class="rg-tag">${escapeHtml(s.group)}</span>` : '';
        return `<div class="excel-preview-row">${i+1}. 교번 ${escapeHtml(s.empNo)} · ${escapeHtml(s.name)}${groupTag}</div>`;
      }).join('');
      previewEl.innerHTML = html;

      if (parsed.length > 0) {
        excelStudentData[panelIdx] = parsed;
        if (btn) btn.disabled = false;
      }
    } catch(err) {
      if (previewEl) {
        previewEl.style.display = 'block';
        previewEl.innerHTML = '<div class="excel-preview-error">파일을 읽을 수 없습니다. 엑셀 형식(.xlsx/.xls)인지 확인해 주세요.</div>';
      }
    }
  };
  reader.readAsArrayBuffer(file);
}

export async function uploadExcelStudents(courseId, panelIdx) {
  const data = excelStudentData[panelIdx];
  if (!data || data.length === 0) return;

  const btn = document.getElementById(`stu-excel-btn-${panelIdx}`);
  if (btn) btn.disabled = true;
  const progress = document.getElementById(`stu-excel-progress-${panelIdx}`);
  if (progress) progress.style.display = 'block';

  const studentsRef = collection(db, 'courses', courseId, 'students');
  const total = data.length;
  const CHUNK = 400; // Firestore batch 한도 500 미만으로 안전 마진
  let success = 0, fail = 0;

  for (let start = 0; start < total; start += CHUNK) {
    const slice = data.slice(start, start + CHUNK);
    if (progress) progress.textContent = `등록 중... (${start + slice.length}/${total})`;
    const batch = writeBatch(db);
    for (const { empNo, name, group } of slice) {
      const docData = { name, empNo, completed: false, completedAt: null };
      if (group) docData.group = group;
      batch.set(doc(studentsRef), docData);
    }
    try {
      await batch.commit();
      success += slice.length;
    } catch (_) {
      fail += slice.length;
    }
  }

  if (progress) progress.textContent = `완료: ${success}명 등록${fail > 0 ? `, ${fail}명 실패` : ''}`;
  excelStudentData[panelIdx] = [];
  const inputEl = document.getElementById(`stu-excel-input-${panelIdx}`);
  const nameEl  = document.getElementById(`stu-excel-name-${panelIdx}`);
  const previewEl = document.getElementById(`stu-excel-preview-${panelIdx}`);
  if (inputEl) inputEl.value = '';
  if (nameEl) nameEl.textContent = '선택된 파일 없음 · 또는 파일을 이 영역으로 끌어다 놓으세요';
  if (previewEl) previewEl.style.display = 'none';

  await loadStudents(courseId, panelIdx);
}
