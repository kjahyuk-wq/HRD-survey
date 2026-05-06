import { db } from './firebase-config.js';
import {
  collection, getDocs, getCountFromServer, query, where,
  addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr } from './admin-utils.js';
import { loadXLSX } from './admin-excel.js';
import { loadStudents } from './admin-students.js';

// 종료된 과정 토글 펼침 상태 (탭 재진입 시 유지)
let closedCoursesExpanded = false;

// ── 교육과정 관리 ──────────────────────────────
export async function loadCourseList() {
  document.getElementById('course-manage-loading').style.display = 'block';
  document.getElementById('course-manage-list').innerHTML = '';
  document.getElementById('course-manage-empty').style.display = 'none';

  try {
    const snap = await getDocs(collection(db, 'courses'));

    state.courseIdMap = {};
    state.courseActive = {};
    const courses = snap.docs.map(d => {
      const data = d.data();
      const isActive = data.active !== false;  // 필드 없으면 활성으로 간주 (마이그레이션)
      state.courseIdMap[data.name] = d.id;
      state.courseActive[data.name] = isActive;
      return { id: d.id, name: data.name, active: isActive };
    });
    // 진행중 우선, 입력 순서 유지
    courses.sort((a, b) => (a.active === b.active) ? 0 : (a.active ? -1 : 1));

    document.getElementById('course-count').textContent = courses.length + '개';
    document.getElementById('course-manage-loading').style.display = 'none';

    if (!courses.length) {
      document.getElementById('course-manage-empty').style.display = 'block';
      return;
    }

    // 각 과정마다 인덱스 부여 (active/closed 통합 인덱스 공간)
    courses.forEach((c, idx) => { c.idx = idx; });

    // 카드 골격 먼저 렌더 (요약 칩은 비동기로 채움)
    const activeCourses = courses.filter(c => c.active);
    const closedCourses = courses.filter(c => !c.active);

    let html = activeCourses.map(renderCourseItem).join('');
    if (closedCourses.length > 0) {
      const arrow = closedCoursesExpanded ? '▲' : '▼';
      const label = closedCoursesExpanded ? '숨기기' : '보기';
      html += `
        <div class="closed-courses-toggle" id="closed-courses-toggle" onclick="toggleClosedCourses()">
          <span id="closed-toggle-arrow">${arrow}</span>
          <span id="closed-toggle-label">종료된 과정 ${closedCourses.length}개 ${label}</span>
        </div>
        <div id="closed-courses-list" style="display:${closedCoursesExpanded ? 'block' : 'none'};">
          ${closedCourses.map(renderCourseItem).join('')}
        </div>`;
    }
    document.getElementById('course-manage-list').innerHTML = html;

    // 요약 칩 비동기 채움 (count aggregation은 doc 읽기 1회로 청구되어 가벼움)
    courses.forEach(async (c) => {
      try {
        const stuRef  = collection(db, 'courses', c.id, 'students');
        const instRef = collection(db, 'courses', c.id, 'instructors');
        const [totalSnap, doneSnap, instSnap] = await Promise.all([
          getCountFromServer(stuRef),
          getCountFromServer(query(stuRef, where('completed', '==', true))),
          getCountFromServer(instRef),
        ]);
        const total = totalSnap.data().count;
        const done  = doneSnap.data().count;
        const inst  = instSnap.data().count;
        const metaEl = document.getElementById(`course-meta-${c.idx}`);
        if (metaEl) {
          metaEl.innerHTML = `수강생 <strong>${total}명</strong>${total > 0 ? ` <span class="meta-done">(완료 ${done})</span>` : ''} · 강사 <strong>${inst}명</strong>`;
        }
      } catch (_) {
        const metaEl = document.getElementById(`course-meta-${c.idx}`);
        if (metaEl) metaEl.textContent = '요약 불러오기 실패';
      }
    });

  } catch (e) {
    document.getElementById('course-manage-loading').textContent = '불러오기 실패';
  }
}

function renderCourseItem({ name, active, idx }) {
  const en = escapeAttr(name);
  const statusBadge = active
    ? `<span class="course-status active">진행중</span>`
    : `<span class="course-status closed">종료</span>`;
  const toggleBtn = active
    ? `<button class="course-close-btn" onclick="toggleCourseActive('${en}', true, this)">종료</button>`
    : `<button class="course-reopen-btn" onclick="toggleCourseActive('${en}', false, this)">재활성</button>`;
  return `
    <div class="course-manage-item ${active ? '' : 'is-closed'}" id="course-item-${idx}">
      <div class="course-manage-row">
        <div class="course-manage-info">
          <span class="course-manage-name">📚 ${escapeHtml(name)} ${statusBadge}</span>
          <div class="course-meta" id="course-meta-${idx}">
            <span class="course-meta-skeleton">불러오는 중…</span>
          </div>
        </div>
        <div class="course-manage-actions">
          <button class="panel-toggle-btn inst-toggle" id="inst-toggle-${idx}" onclick="togglePanel('${en}', ${idx}, 'inst')">👨‍🏫 강사</button>
          <button class="panel-toggle-btn stu-toggle" id="stu-toggle-${idx}" onclick="togglePanel('${en}', ${idx}, 'stu')">👥 수강생</button>
          ${toggleBtn}
          <button class="delete-btn" onclick="deleteCourse('${en}', this)">삭제</button>
        </div>
      </div>
      <div class="instructor-panel" id="inst-panel-${idx}" style="display:none;"></div>
      <div class="student-panel" id="stu-panel-${idx}" style="display:none;">${renderStudentPanelHtml(en, idx)}</div>
    </div>`;
}

function renderStudentPanelHtml(en, idx) {
  return `
    <div class="add-student-row">
      <input type="text" id="new-stu-name-${idx}" placeholder="이름" maxlength="20">
      <input type="number" id="new-stu-empno-${idx}" placeholder="교번 (예: 1)" min="1"
        onkeydown="if(event.key==='Enter')addStudent('${en}', ${idx})">
      <button class="add-btn" id="stu-add-btn-${idx}" onclick="addStudent('${en}', ${idx})">+ 등록</button>
    </div>
    <div class="excel-upload-area stu-excel-area">
      <div class="excel-upload-label">📂 엑셀 일괄 등록 <span class="excel-tip">A열: 교번 / B열: 이름 / 2행부터 데이터</span></div>
      <div class="excel-upload-row">
        <label class="excel-file-btn" for="stu-excel-input-${idx}">파일 선택</label>
        <input type="file" id="stu-excel-input-${idx}" accept=".xlsx,.xls" style="display:none" onchange="handleExcelUpload(${idx}, this)">
        <span id="stu-excel-name-${idx}" class="excel-file-name">선택된 파일 없음 · 또는 파일을 이 영역으로 끌어다 놓으세요</span>
        <button class="add-btn" id="stu-excel-btn-${idx}" onclick="uploadExcelStudents('${en}', ${idx})" disabled>일괄 등록</button>
      </div>
      <div id="stu-excel-preview-${idx}" class="excel-preview" style="display:none;"></div>
      <div id="stu-excel-progress-${idx}" class="excel-progress" style="display:none;"></div>
    </div>
    <div class="student-stats-bar" id="stu-stats-bar-${idx}"></div>
    <div id="stu-loading-${idx}" class="loading" style="display:none;">불러오는 중...</div>
    <div id="stu-list-${idx}"></div>
    <div id="stu-empty-${idx}" class="no-data" style="display:none;">등록된 수강생이 없습니다.</div>
    <button class="icon-refresh-btn" onclick="loadStudents('${en}', ${idx})" title="새로고침">🔄 새로고침</button>`;
}

// 강사/수강생 패널 토글: 한 카드에서 둘 중 하나만 펼침 (탭 형태)
export async function togglePanel(courseName, idx, mode) {
  const instPanel = document.getElementById(`inst-panel-${idx}`);
  const stuPanel  = document.getElementById(`stu-panel-${idx}`);
  const instBtn   = document.getElementById(`inst-toggle-${idx}`);
  const stuBtn    = document.getElementById(`stu-toggle-${idx}`);
  if (!instPanel || !stuPanel) return;

  const isInst = mode === 'inst';
  const targetPanel = isInst ? instPanel : stuPanel;
  const otherPanel  = isInst ? stuPanel  : instPanel;
  const targetBtn   = isInst ? instBtn   : stuBtn;
  const otherBtn    = isInst ? stuBtn    : instBtn;

  // 이미 열려있으면 닫기
  if (targetPanel.style.display !== 'none') {
    targetPanel.style.display = 'none';
    targetBtn?.classList.remove('active');
    return;
  }
  // 다른 패널 닫고 타겟 열기
  otherPanel.style.display = 'none';
  otherBtn?.classList.remove('active');
  targetPanel.style.display = 'block';
  targetBtn?.classList.add('active');

  if (isInst) {
    await loadInstructors(courseName, idx);
  } else {
    await loadStudents(courseName, idx);
  }
}

// 종료된 과정 토글
export function toggleClosedCourses() {
  const list  = document.getElementById('closed-courses-list');
  const arrow = document.getElementById('closed-toggle-arrow');
  const label = document.getElementById('closed-toggle-label');
  if (!list) return;
  closedCoursesExpanded = !closedCoursesExpanded;
  list.style.display = closedCoursesExpanded ? 'block' : 'none';
  if (arrow) arrow.textContent = closedCoursesExpanded ? '▲' : '▼';
  if (label) {
    // "종료된 과정 N개 보기/숨기기" 형태에서 마지막 단어만 교체
    label.textContent = label.textContent.replace(
      closedCoursesExpanded ? '보기' : '숨기기',
      closedCoursesExpanded ? '숨기기' : '보기'
    );
  }
}

export async function addCourse() {
  const input = document.getElementById('new-course-input');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const btn = document.querySelector('.add-btn');
  btn.disabled = true; btn.textContent = '추가 중...';

  try {
    await addDoc(collection(db, 'courses'), { name, active: true });
    input.value = '';
    await loadCourseList();
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); }
  finally { btn.disabled = false; btn.textContent = '+ 추가'; }
}

// 활성 ↔ 종료 토글
export async function toggleCourseActive(name, currentActive, btnEl) {
  const newActive = !currentActive;
  const msg = newActive
    ? `"${name}" 과정을 다시 활성 상태로 전환하시겠습니까?\n수강생들이 다시 로그인할 수 있게 됩니다.`
    : `"${name}" 과정을 종료 처리하시겠습니까?\n\n• 수강생 로그인 차단(이름·교번 중복 충돌 방지)\n• 통계·응답 데이터는 그대로 보관됨\n• 언제든 재활성 가능`;
  if (!confirm(msg)) return;

  btnEl.disabled = true;
  const originalText = btnEl.textContent;
  btnEl.textContent = '처리 중...';
  try {
    const courseId = state.courseIdMap[name];
    await updateDoc(doc(db, 'courses', courseId), { active: newActive });
    await loadCourseList();
  } catch (e) {
    alert('상태 변경 중 오류가 발생했습니다.');
    btnEl.disabled = false;
    btnEl.textContent = originalText;
  }
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
  const currentInsts = panelInstructors[panelIdx] || [];
  const maxOrder = currentInsts.length > 0
    ? Math.max(...currentInsts.map(i => i.order ?? 0))
    : -10;

  const instRef = collection(db, 'courses', courseId, 'instructors');
  const total = data.length;
  const CHUNK = 400; // Firestore batch 한도 500 미만으로 안전 마진
  let success = 0, fail = 0;

  for (let start = 0; start < total; start += CHUNK) {
    const slice = data.slice(start, start + CHUNK);
    progress.textContent = `등록 중... (${start + slice.length}/${total})`;
    const batch = writeBatch(db);
    slice.forEach(({ edu, name }, j) => {
      batch.set(doc(instRef), {
        name, education: edu,
        createdAt: serverTimestamp(),
        order: maxOrder + (start + j + 1) * 10
      });
    });
    try {
      await batch.commit();
      success += slice.length;
    } catch (_) {
      fail += slice.length;
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

// 패널별 현재 강사 목록 저장 (순서 변경, 수정에 활용)
const panelInstructors = {};

async function loadInstructors(courseName, panelIdx) {
  const panel = document.getElementById(`inst-panel-${panelIdx}`);
  panel.innerHTML = '<div class="inst-loading">불러오는 중...</div>';
  try {
    const courseId = state.courseIdMap[courseName];
    const snap = await getDocs(collection(db, 'courses', courseId, 'instructors'));
    let instructors = snap.docs.map(d => ({ ...d.data(), _id: d.id }));

    // order 필드 기준 정렬 (없으면 createdAt 기준)
    instructors.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      const ta = a.createdAt?.seconds || 0;
      const tb = b.createdAt?.seconds || 0;
      return ta - tb;
    });

    // order 없는 항목에 초기값 부여 (메모리 내)
    instructors.forEach((inst, i) => {
      if (inst.order === undefined) inst.order = i * 10;
    });

    panelInstructors[panelIdx] = instructors;
    renderInstructorPanel(courseName, panelIdx, instructors);
  } catch (e) {
    panel.innerHTML = '<div class="inst-loading">불러오기 실패</div>';
  }
}

function renderInstructorPanel(courseName, panelIdx, instructors) {
  const panel = document.getElementById(`inst-panel-${panelIdx}`);
  const ec = escapeAttr(courseName);
  const total = instructors.length;

  const listHtml = total === 0
    ? '<div class="inst-empty">등록된 강사가 없습니다. 강사를 추가해 주세요.</div>'
    : `<div class="student-bulk-actions">
        <button class="bulk-delete-btn" id="inst-bulk-delete-btn-${panelIdx}" onclick="deleteSelectedInstructors('${ec}', ${panelIdx})" disabled>선택 삭제</button>
      </div>
      <table class="student-table">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" id="inst-select-all-${panelIdx}" onclick="toggleInstSelectAll(${panelIdx}, this)"></th>
          <th>강의명</th><th>강사명</th><th style="width:160px">순서 / 관리</th>
        </tr></thead>
        <tbody>
          ${instructors.map((inst, idx) => {
            const name = inst.name || '';
            const edu  = inst.education || '';
            const en = escapeAttr(name), ee = escapeAttr(edu), eid = escapeAttr(inst._id || '');
            return `<tr id="inst-row-${panelIdx}-${idx}">
              <td><input type="checkbox" class="inst-checkbox-${panelIdx}" data-id="${eid}" data-name="${en}" onchange="updateInstBulkDeleteBtn(${panelIdx})"></td>
              <td style="text-align:left">${escapeHtml(edu)}</td>
              <td style="text-align:left">${escapeHtml(name)}</td>
              <td>
                <div class="inst-action-btns">
                  <button class="inst-move-btn" onclick="moveInstructor('${ec}', ${panelIdx}, ${idx}, 'up')" ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
                  <button class="inst-move-btn" onclick="moveInstructor('${ec}', ${panelIdx}, ${idx}, 'down')" ${idx === total - 1 ? 'disabled' : ''} title="아래로">▼</button>
                  <button class="inst-edit-btn" onclick="startEditInstructor('${ec}', ${panelIdx}, ${idx})">수정</button>
                  <button class="delete-btn" onclick="deleteInstructor('${ec}', ${panelIdx}, '${en}', '${ee}', '${eid}', this)">삭제</button>
                </div>
              </td>
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
    const currentInsts = panelInstructors[panelIdx] || [];
    const maxOrder = currentInsts.length > 0
      ? Math.max(...currentInsts.map(i => i.order ?? 0))
      : -10;
    await addDoc(collection(db, 'courses', courseId, 'instructors'), {
      name, education: edu, createdAt: serverTimestamp(), order: maxOrder + 10
    });
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

// ── 순서 변경 ──────────────────────────────
export async function moveInstructor(courseName, panelIdx, idx, direction) {
  const instructors = panelInstructors[panelIdx];
  if (!instructors) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= instructors.length) return;

  const instA = instructors[idx];
  const instB = instructors[targetIdx];
  const courseId = state.courseIdMap[courseName];

  // order 값 교환
  const tempOrder = instA.order;
  instA.order = instB.order;
  instB.order = tempOrder;

  try {
    await Promise.all([
      updateDoc(doc(db, 'courses', courseId, 'instructors', instA._id), { order: instA.order }),
      updateDoc(doc(db, 'courses', courseId, 'instructors', instB._id), { order: instB.order }),
    ]);
    await loadInstructors(courseName, panelIdx);
  } catch (e) {
    alert('순서 변경 중 오류가 발생했습니다.');
    // 롤백
    const t = instA.order; instA.order = instB.order; instB.order = t;
  }
}

// ── 강사 수정 ──────────────────────────────
export function startEditInstructor(courseName, panelIdx, idx) {
  const inst = panelInstructors[panelIdx]?.[idx];
  if (!inst) return;
  const row = document.getElementById(`inst-row-${panelIdx}-${idx}`);
  if (!row) return;
  const ec = escapeAttr(courseName);
  row.innerHTML = `
    <td><input type="checkbox" disabled></td>
    <td><input type="text" id="edit-edu-${panelIdx}-${idx}" value="${escapeAttr(inst.education || '')}" maxlength="50" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td><input type="text" id="edit-name-${panelIdx}-${idx}" value="${escapeAttr(inst.name || '')}" maxlength="20" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td>
      <div class="inst-action-btns">
        <button class="inst-save-btn" onclick="saveEditInstructor('${ec}', ${panelIdx}, ${idx})">저장</button>
        <button class="inst-cancel-btn" onclick="cancelEditInstructor('${ec}', ${panelIdx})">취소</button>
      </div>
    </td>`;
  document.getElementById(`edit-edu-${panelIdx}-${idx}`)?.focus();
}

export async function saveEditInstructor(courseName, panelIdx, idx) {
  const inst = panelInstructors[panelIdx]?.[idx];
  if (!inst) return;
  const eduEl  = document.getElementById(`edit-edu-${panelIdx}-${idx}`);
  const nameEl = document.getElementById(`edit-name-${panelIdx}-${idx}`);
  const edu  = eduEl?.value.trim();
  const name = nameEl?.value.trim();
  if (!edu)  { eduEl?.focus(); return; }
  if (!name) { nameEl?.focus(); return; }

  const saveBtn = document.querySelector(`#inst-row-${panelIdx}-${idx} .inst-save-btn`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
  try {
    const courseId = state.courseIdMap[courseName];
    await updateDoc(doc(db, 'courses', courseId, 'instructors', inst._id), { name, education: edu });
    await loadInstructors(courseName, panelIdx);
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
  }
}

export async function cancelEditInstructor(courseName, panelIdx) {
  await loadInstructors(courseName, panelIdx);
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
