import { db } from './firebase-config.js';
import {
  collection, query, orderBy, getDocs,
  addDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr } from './admin-utils.js';

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
