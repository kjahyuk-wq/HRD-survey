import { db } from './firebase-config.js';
import {
  collection, getDocs, getCountFromServer, query, where,
  addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr } from './admin-utils.js';
import { loadXLSX } from './admin-excel.js';
import { loadStudents, studentsCache } from './admin-students.js';
import { loadRounds } from './admin-rounds.js';

// 종료된 과정 토글 펼침 상태 (탭 재진입 시 유지)
let closedCoursesExpanded = false;

// 카드 idx → 과정 원본 데이터 (수정 진입 시 폼에 채울 용도)
const courseDataCache = {};

// ── 사내 프록시(행정망) 회복 헬퍼 ──────────────────────────────
// 1) 빈 결과 시 한 번 재시도: long-polling 채널 초기 응답이 비어오는 패턴 대응
// 2) localStorage stale-while-revalidate: 첫 응답이 늦거나 비어와도 직전 캐시를 즉시 표시
const LS_PREFIX = 'admin:cache:v1:';
function lsRead(key) {
  try { const raw = localStorage.getItem(LS_PREFIX + key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function lsWrite(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch {}
}
// 데이터 변경 직후 캐시 무효화. 변경 후 fresh 가 빈 결과로 와도(행정망 변조 또는
// 마지막 항목 삭제로 진짜 빈 상태) loadCourseList 의 "빈 결과 + hasCache → 캐시 유지"
// 분기가 stale 을 잡지 못해 삭제된 항목이 계속 보이던 문제 차단.
export function lsInvalidate(key) {
  try { localStorage.removeItem(LS_PREFIX + key); } catch {}
}

async function getDocsResilient(refOrQuery) {
  let snap = await getDocs(refOrQuery);
  if (snap.empty) {
    // 행정망 프록시가 첫 long-polling 응답을 변조해 빈 결과로 오는 패턴.
    // 800ms 후 한 번만 재시도 — 진짜 빈 컬렉션이면 이 비용은 한 번뿐.
    await new Promise(r => setTimeout(r, 800));
    snap = await getDocs(refOrQuery);
  }
  return snap;
}

// ISO 날짜 문자열 → "YYYY.MM.DD ~ YYYY.MM.DD" 표시 (둘 중 하나라도 없으면 null)
function formatDateRange(start, end) {
  if (!start || !end) return null;
  const f = s => String(s).replaceAll('-', '.');
  return `${f(start)} ~ ${f(end)}`;
}

// ── 직접 입력 날짜 필드 (YYYY-MM-DD): 4→2→2 자릿수 자동 포커스 이동 ──
// 네이티브 <input type="date">는 브라우저별로 연도가 6자리까지 입력되어 자동 이동이 안 되는 케이스가 있어
// 세 칸으로 분리해 maxlength 기반으로 일관 동작.
export function renderDateFields(prefix, isoValue) {
  const [y = '', m = '', d = ''] = String(isoValue || '').split('-');
  return `<span class="course-date-fields" data-date-prefix="${escapeAttr(prefix)}">
    <input type="text" inputmode="numeric" pattern="\\d*" maxlength="4" placeholder="YYYY"
      id="${prefix}-y" value="${escapeAttr(y)}" aria-label="연도" autocomplete="off">
    <span class="date-fields-sep">-</span>
    <input type="text" inputmode="numeric" pattern="\\d*" maxlength="2" placeholder="MM"
      id="${prefix}-m" value="${escapeAttr(m)}" aria-label="월" autocomplete="off">
    <span class="date-fields-sep">-</span>
    <input type="text" inputmode="numeric" pattern="\\d*" maxlength="2" placeholder="DD"
      id="${prefix}-d" value="${escapeAttr(d)}" aria-label="일" autocomplete="off">
  </span>`;
}

export function readDateFields(prefix) {
  const y = document.getElementById(`${prefix}-y`)?.value.trim() || '';
  const m = document.getElementById(`${prefix}-m`)?.value.trim() || '';
  const d = document.getElementById(`${prefix}-d`)?.value.trim() || '';
  if (!/^\d{4}$/.test(y)) return '';
  if (!/^\d{1,2}$/.test(m)) return '';
  if (!/^\d{1,2}$/.test(d)) return '';
  const mm = m.padStart(2, '0');
  const dd = d.padStart(2, '0');
  if (+mm < 1 || +mm > 12) return '';
  if (+dd < 1 || +dd > 31) return '';
  return `${y}-${mm}-${dd}`;
}

// 자릿수가 maxlength 도달 시 다음 칸으로 자동 포커스. 빈 칸에서 백스페이스 시 이전 칸으로.
export function wireDateFields(root) {
  if (!root) return;
  root.querySelectorAll('.course-date-fields').forEach(group => {
    const inputs = Array.from(group.querySelectorAll('input[type="text"]'));
    inputs.forEach((input, i) => {
      input.addEventListener('input', () => {
        const cleaned = input.value.replace(/\D/g, '');
        if (cleaned !== input.value) input.value = cleaned;
        if (input.value.length >= input.maxLength) {
          const next = inputs[i + 1];
          if (next) { next.focus(); next.select?.(); }
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && input.value === '' && i > 0) {
          const prev = inputs[i - 1];
          prev.focus();
          requestAnimationFrame(() => prev.setSelectionRange(prev.value.length, prev.value.length));
          e.preventDefault();
        }
      });
    });
  });
}

// ── 교육과정 관리 ──────────────────────────────
export async function loadCourseList() {
  // 새 과정 추가 폼의 날짜 입력 필드 최초 렌더 (값 유지: 비어있을 때만)
  const newDateWrap = document.getElementById('new-course-date-wrap');
  if (newDateWrap && !newDateWrap.querySelector('input')) {
    newDateWrap.innerHTML = `
      ${renderDateFields('new-course-start')}
      <span class="date-sep">~</span>
      ${renderDateFields('new-course-end')}`;
    wireDateFields(newDateWrap);
    // 종료일의 마지막 칸에서 Enter 누르면 등록
    document.getElementById('new-course-end-d')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addCourse();
    });
  }

  // 직전 캐시가 있으면 즉시 렌더 — 행정망 느린 첫 응답 동안 빈 화면 회피.
  // 백그라운드에서 fresh fetch 후 갱신 (stale-while-revalidate).
  const cached = lsRead('courses');
  const hasCache = Array.isArray(cached) && cached.length > 0;

  if (hasCache) {
    renderCourseList(cached);
    document.getElementById('course-manage-loading').style.display = 'none';
  } else {
    document.getElementById('course-manage-loading').style.display = 'block';
    document.getElementById('course-manage-list').innerHTML = '';
    document.getElementById('course-manage-empty').style.display = 'none';
  }

  try {
    const snap = await getDocsResilient(collection(db, 'courses'));
    const courses = snap.docs.map(d => {
      const data = d.data();
      const isActive = data.active !== false;
      return {
        id: d.id, name: data.name, active: isActive,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        type: data.type === 'leadership' ? 'leadership' : 'standard',
      };
    });

    // fresh 가 비어 왔지만 캐시는 있다 — 프록시 변조 가능성. 캐시 유지하고 종료.
    if (courses.length === 0 && hasCache) {
      document.getElementById('course-manage-loading').style.display = 'none';
      return;
    }

    renderCourseList(courses);
    document.getElementById('course-manage-loading').style.display = 'none';

    if (courses.length === 0) {
      document.getElementById('course-manage-empty').style.display = 'block';
      lsWrite('courses', []);
      return;
    }

    // 다음 새로고침에서 즉시 표시할 수 있도록 캐시 저장
    lsWrite('courses', courses);
  } catch (e) {
    if (!hasCache) {
      document.getElementById('course-manage-loading').textContent = '불러오기 실패';
    }
    // 캐시가 있으면 그대로 두고 침묵 — 사용자는 적어도 직전 데이터를 볼 수 있음
  }
}

// 코스 배열 → 정렬·렌더·요약칩 fetch (캐시 표시와 fresh 표시 양쪽에서 재사용)
function renderCourseList(rawCourses) {
  state.courseIdMap = {};
  state.courseActive = {};
  state.courseType = {};
  state.courseTypeById = {};
  const courses = rawCourses.map(c => {
    state.courseIdMap[c.name] = c.id;
    state.courseActive[c.name] = c.active;
    state.courseType[c.name] = c.type;
    state.courseTypeById[c.id] = c.type;
    return { ...c };
  });

  // 진행중 우선, 그 안에서는 시작일 내림차순. startDate 없는 데이터는 맨 뒤.
  courses.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const sa = a.startDate || '';
    const sb = b.startDate || '';
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return sb.localeCompare(sa);
  });

  document.getElementById('course-count').textContent = courses.length + '개';

  for (const k of Object.keys(courseDataCache)) delete courseDataCache[k];
  courses.forEach((c, idx) => {
    c.idx = idx;
    courseDataCache[idx] = { id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate, type: c.type };
  });

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
  const listEl = document.getElementById('course-manage-list');
  listEl.innerHTML = html;
  wireDateFields(listEl);

  // 요약 칩 — 카드별 카운트는 N × 3 RTT(행정망에서 가장 비싼 패턴).
  // (1) 직전 캐시가 있으면 즉시 표시, (2) 백그라운드에서 fresh 카운트 fetch.
  // 마지막 페이지 진입 후 30 초 이내 재진입 시 카운트도 즉시 보임.
  const renderMeta = (idx, total, done, inst) => {
    const metaEl = document.getElementById(`course-meta-${idx}`);
    if (!metaEl) return;
    metaEl.innerHTML = `수강생 <strong>${total}명</strong>${total > 0 ? ` <span class="meta-done">(완료 ${done})</span>` : ''} · 강사 <strong>${inst}명</strong>`;
  };

  courses.forEach((c) => {
    const cacheKey = `counts:${c.id}`;
    const cached = lsRead(cacheKey);
    if (cached && typeof cached.total === 'number') {
      renderMeta(c.idx, cached.total, cached.done, cached.inst);
    }
  });

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
      lsWrite(`counts:${c.id}`, { total, done, inst, at: Date.now() });
      renderMeta(c.idx, total, done, inst);
    } catch (_) {
      // 캐시가 이미 그려져 있으면 그대로 유지 — 침묵
      const metaEl = document.getElementById(`course-meta-${c.idx}`);
      if (metaEl && metaEl.innerHTML === '') metaEl.textContent = '요약 불러오기 실패';
    }
  });
}

function renderCourseItem({ id, name, active, idx, startDate, endDate, type }) {
  const cid = escapeAttr(id);
  const statusBadge = active
    ? `<span class="course-status active">진행중</span>`
    : `<span class="course-status closed">종료</span>`;
  const typeBadge = type === 'leadership'
    ? `<span class="course-type-badge leadership" title="회차별 분반 운영">중견리더</span>`
    : '';
  const dateLabel = formatDateRange(startDate, endDate);
  const dateHtml = dateLabel
    ? `<span class="course-date-range">${escapeHtml(dateLabel)}</span>`
    : '';

  // 중견리더 과정은 강사가 회차별로 달라지므로 [강사관리] 대신 [회차관리] 노출
  const isLeadership = type === 'leadership';
  const middleBtn = isLeadership
    ? `<button class="panel-toggle-btn round-toggle" id="round-toggle-${idx}" onclick="togglePanel('${cid}', ${idx}, 'rounds')" title="회차별 강사·분반 관리">회차관리</button>`
    : `<button class="panel-toggle-btn inst-toggle" id="inst-toggle-${idx}" onclick="togglePanel('${cid}', ${idx}, 'inst')">강사관리</button>`;

  // 진행중: 운영 액션 + 종료. 종료: 결과 조회 + 재활성/삭제만 (운영 데이터 변경 X)
  const actionBtns = active
    ? `<button class="panel-toggle-btn edit-toggle" id="edit-toggle-${idx}" onclick="togglePanel('${cid}', ${idx}, 'edit')" title="과정명·교육기간 수정">교육과정 수정</button>
       ${middleBtn}
       <button class="panel-toggle-btn stu-toggle" id="stu-toggle-${idx}" onclick="togglePanel('${cid}', ${idx}, 'stu')">수강생관리</button>
       <button class="goto-btn preview-btn" onclick="goToCourseTab('preview', '${cid}')" title="이 과정 설문 미리보기">설문 미리보기</button>
       <button class="goto-btn stats-btn" onclick="goToCourseTab('stats', '${cid}')" title="이 과정 설문 결과">설문 결과</button>
       <button class="course-close-btn" onclick="toggleCourseActive('${cid}', true, this)">종료</button>`
    : `<button class="goto-btn stats-btn" onclick="goToCourseTab('stats', '${cid}')" title="이 과정 설문 결과">설문 결과</button>
       <button class="course-reopen-btn" onclick="toggleCourseActive('${cid}', false, this)">재활성</button>
       <button class="delete-btn" onclick="deleteCourse('${cid}', this)" title="과정과 수강생·강사·응답 데이터를 모두 삭제">삭제</button>`;

  // 진행중일 때만 수정/강사(또는 회차)/수강생 패널 영역 렌더 (강사·수강생과 동일한 아코디언 패턴)
  const middlePanelHtml = isLeadership
    ? `<div class="round-panel" id="round-panel-${idx}" style="display:none;"></div>`
    : `<div class="instructor-panel" id="inst-panel-${idx}" style="display:none;"></div>`;
  const panelsHtml = active
    ? `<div class="course-edit-panel" id="edit-panel-${idx}" style="display:none;">${renderEditPanelHtml(idx, name, startDate, endDate)}</div>
       ${middlePanelHtml}
       <div class="student-panel" id="stu-panel-${idx}" style="display:none;">${renderStudentPanelHtml(cid, idx)}</div>`
    : '';

  return `
    <div class="course-manage-item ${active ? '' : 'is-closed'}" id="course-item-${idx}">
      <div class="course-manage-row">
        <div class="course-manage-info">
          <span class="course-manage-name">${escapeHtml(name)} ${statusBadge}${typeBadge}</span>
          ${dateHtml}
          <div class="course-meta" id="course-meta-${idx}">
            <span class="course-meta-skeleton">불러오는 중…</span>
          </div>
        </div>
        <div class="course-manage-actions">
          ${actionBtns}
        </div>
      </div>
      ${panelsHtml}
    </div>`;
}

function renderEditPanelHtml(idx, name, startDate, endDate) {
  return `
    <div class="course-edit-form">
      <label class="course-edit-field">
        <span class="edit-field-label">과정명</span>
        <input type="text" id="edit-course-name-${idx}" value="${escapeAttr(name || '')}" maxlength="100" placeholder="교육과정명">
      </label>
      <label class="course-edit-field">
        <span class="edit-field-label">교육기간</span>
        <div class="course-date-inputs">
          ${renderDateFields(`edit-course-start-${idx}`, startDate)}
          <span class="date-sep">~</span>
          ${renderDateFields(`edit-course-end-${idx}`, endDate)}
        </div>
      </label>
    </div>
    <div class="course-edit-actions">
      <button class="inst-save-btn" onclick="saveEditCourse(${idx})">저장</button>
      <button class="inst-cancel-btn" onclick="cancelEditCourse(${idx})">취소</button>
    </div>`;
}

function renderStudentPanelHtml(cid, idx) {
  return `
    <div class="add-student-row">
      <input type="text" id="new-stu-name-${idx}" placeholder="이름" maxlength="20">
      <input type="number" id="new-stu-empno-${idx}" placeholder="교번 (예: 1)" min="1"
        onkeydown="if(event.key==='Enter')addStudent('${cid}', ${idx})">
      <select id="new-stu-group-${idx}" class="stu-group-select" style="display:none;" title="분반 (중견리더 양성과정)">
        <option value="">-- 분반 --</option>
      </select>
      <button class="add-btn" id="stu-add-btn-${idx}" onclick="addStudent('${cid}', ${idx})">+ 등록</button>
    </div>
    <div class="excel-upload-area stu-excel-area">
      <div class="excel-upload-label">엑셀 일괄 등록 <span class="excel-tip">A열: 교번 / B열: 이름 / <span id="stu-excel-c-hint-${idx}" style="display:none;">C열: 분반 (선택) / </span>2행부터 데이터</span></div>
      <div class="excel-upload-row">
        <label class="excel-file-btn" for="stu-excel-input-${idx}">파일 선택</label>
        <input type="file" id="stu-excel-input-${idx}" accept=".xlsx,.xls" style="display:none" onchange="handleExcelUpload(${idx}, this)">
        <span id="stu-excel-name-${idx}" class="excel-file-name">선택된 파일 없음 · 또는 파일을 이 영역으로 끌어다 놓으세요</span>
        <button class="add-btn" id="stu-excel-btn-${idx}" onclick="uploadExcelStudents('${cid}', ${idx})" disabled>일괄 등록</button>
      </div>
      <div id="stu-excel-preview-${idx}" class="excel-preview" style="display:none;"></div>
      <div id="stu-excel-progress-${idx}" class="excel-progress" style="display:none;"></div>
    </div>
    <div class="student-stats-bar" id="stu-stats-bar-${idx}"></div>
    <div id="stu-loading-${idx}" class="loading" style="display:none;">불러오는 중...</div>
    <div id="stu-list-${idx}"></div>
    <div id="stu-empty-${idx}" class="no-data" style="display:none;">등록된 수강생이 없습니다.</div>
    <button class="icon-refresh-btn" onclick="loadStudents('${cid}', ${idx})" title="새로고침">새로고침</button>`;
}

// 한 카드의 수정·강사(또는 회차)·수강생 패널 토글 — 한 번에 하나만 열림 (아코디언)
// 단기과정: edit/inst/stu / 중견리더: edit/rounds/stu — 사용 안 하는 패널은 DOM에 없어 panels[m] 가 null
export async function togglePanel(courseId, idx, mode) {
  const panels = {
    edit:   document.getElementById(`edit-panel-${idx}`),
    inst:   document.getElementById(`inst-panel-${idx}`),
    stu:    document.getElementById(`stu-panel-${idx}`),
    rounds: document.getElementById(`round-panel-${idx}`),
  };
  const buttons = {
    edit:   document.getElementById(`edit-toggle-${idx}`),
    inst:   document.getElementById(`inst-toggle-${idx}`),
    stu:    document.getElementById(`stu-toggle-${idx}`),
    rounds: document.getElementById(`round-toggle-${idx}`),
  };
  const target = panels[mode];
  if (!target) return;

  // 이미 열려있으면 닫기
  if (target.style.display !== 'none') {
    target.style.display = 'none';
    buttons[mode]?.classList.remove('active');
    if (mode === 'edit') restoreEditFields(idx);
    return;
  }

  // 다른 패널 닫기
  for (const m of Object.keys(panels)) {
    if (m !== mode && panels[m] && panels[m].style.display !== 'none') {
      panels[m].style.display = 'none';
      buttons[m]?.classList.remove('active');
      if (m === 'edit') restoreEditFields(idx);
    }
  }
  target.style.display = 'block';
  buttons[mode]?.classList.add('active');

  // 행정망 long-polling 환경에서 RTT 비용이 크기 때문에, 한 번 로드한 패널은
  // 토글 재오픈 시 캐시된 DOM을 그대로 보여주고 fetch를 건너뛴다.
  // 추가/수정/삭제·새로고침 버튼은 각자 loadXxx를 직접 호출해 강제 갱신한다.
  if (mode === 'inst') {
    if (!panelInstructors[idx]) await loadInstructors(courseId, idx);
  } else if (mode === 'stu') {
    if (!studentsCache[idx]) await loadStudents(courseId, idx);
  } else if (mode === 'rounds') {
    await loadRounds(courseId, idx);
  } else if (mode === 'edit') {
    document.getElementById(`edit-course-name-${idx}`)?.focus();
  }
}

// ── 과정 인라인 수정 ──────────────────────────────
function restoreEditFields(idx) {
  const c = courseDataCache[idx];
  if (!c) return;
  const nameEl = document.getElementById(`edit-course-name-${idx}`);
  if (nameEl) nameEl.value = c.name || '';
  const setIso = (prefix, iso) => {
    const [y = '', m = '', d = ''] = String(iso || '').split('-');
    const set = (suf, v) => { const el = document.getElementById(`${prefix}-${suf}`); if (el) el.value = v; };
    set('y', y); set('m', m); set('d', d);
  };
  setIso(`edit-course-start-${idx}`, c.startDate);
  setIso(`edit-course-end-${idx}`, c.endDate);
}

export async function saveEditCourse(idx) {
  const c = courseDataCache[idx];
  if (!c) return;
  const nameEl  = document.getElementById(`edit-course-name-${idx}`);
  const name      = nameEl?.value.trim();
  const startDate = readDateFields(`edit-course-start-${idx}`);
  const endDate   = readDateFields(`edit-course-end-${idx}`);

  if (!name) { nameEl?.focus(); return; }
  if (!startDate) {
    alert('교육 시작일을 입력해 주세요. (YYYY-MM-DD)');
    document.getElementById(`edit-course-start-${idx}-y`)?.focus();
    return;
  }
  if (!endDate) {
    alert('교육 종료일을 입력해 주세요. (YYYY-MM-DD)');
    document.getElementById(`edit-course-end-${idx}-y`)?.focus();
    return;
  }
  if (endDate < startDate) {
    alert('종료일이 시작일보다 빠를 수 없습니다.');
    document.getElementById(`edit-course-end-${idx}-y`)?.focus();
    return;
  }

  const saveBtn = document.querySelector(`#edit-panel-${idx} .inst-save-btn`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
  try {
    await updateDoc(doc(db, 'courses', c.id), { name, startDate, endDate });
    lsInvalidate('courses');
    await loadCourseList();
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
  }
}

export function cancelEditCourse(idx) {
  const panel = document.getElementById(`edit-panel-${idx}`);
  if (panel) panel.style.display = 'none';
  document.getElementById(`edit-toggle-${idx}`)?.classList.remove('active');
  restoreEditFields(idx);
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
  const input    = document.getElementById('new-course-input');
  const name      = input.value.trim();
  const startDate = readDateFields('new-course-start');
  const endDate   = readDateFields('new-course-end');
  const typeInput = document.querySelector('input[name="new-course-type"]:checked');
  const type      = typeInput?.value === 'leadership' ? 'leadership' : 'standard';

  if (!name) { input.focus(); return; }
  if (!startDate) {
    alert('교육 시작일을 입력해 주세요. (YYYY-MM-DD)');
    document.getElementById('new-course-start-y')?.focus();
    return;
  }
  if (!endDate) {
    alert('교육 종료일을 입력해 주세요. (YYYY-MM-DD)');
    document.getElementById('new-course-end-y')?.focus();
    return;
  }
  if (endDate < startDate) {
    alert('종료일이 시작일보다 빠를 수 없습니다.');
    document.getElementById('new-course-end-y')?.focus();
    return;
  }

  const btn = document.querySelector('.add-course-row .add-btn');
  btn.disabled = true; btn.textContent = '추가 중...';

  try {
    await addDoc(collection(db, 'courses'), { name, active: true, startDate, endDate, type });
    lsInvalidate('courses');
    input.value = '';
    ['new-course-start-y','new-course-start-m','new-course-start-d',
     'new-course-end-y','new-course-end-m','new-course-end-d']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    // 타입 라디오는 단기과정으로 리셋
    const stdRadio = document.querySelector('input[name="new-course-type"][value="standard"]');
    if (stdRadio) stdRadio.checked = true;
    await loadCourseList();
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); }
  finally { btn.disabled = false; btn.textContent = '+ 추가'; }
}

// 활성 ↔ 종료 토글
export async function toggleCourseActive(courseId, currentActive, btnEl) {
  const newActive = !currentActive;
  // 카드 헤더에서 과정명 추출 (확인 안내문에 표시)
  const item = btnEl.closest('.course-manage-item');
  const nameEl = item?.querySelector('.course-manage-name');
  const courseLabel = nameEl ? (nameEl.textContent.replace('진행중', '').replace('종료', '').replace('중견리더', '').trim()) : '이 과정';
  const msg = newActive
    ? `"${courseLabel}" 과정을 다시 활성 상태로 전환하시겠습니까?\n수강생들이 다시 로그인할 수 있게 됩니다.`
    : `"${courseLabel}" 과정을 종료 처리하시겠습니까?\n\n• 수강생 로그인 차단(이름·교번 중복 충돌 방지)\n• 통계·응답 데이터는 그대로 보관됨\n• 언제든 재활성 가능`;
  if (!confirm(msg)) return;

  btnEl.disabled = true;
  const originalText = btnEl.textContent;
  btnEl.textContent = '처리 중...';
  try {
    await updateDoc(doc(db, 'courses', courseId), { active: newActive });
    lsInvalidate('courses');
    await loadCourseList();
  } catch (e) {
    alert('상태 변경 중 오류가 발생했습니다.');
    btnEl.disabled = false;
    btnEl.textContent = originalText;
  }
}

// ── 과정 삭제 (종료 상태에서만 호출됨) ──────────────────────────────
export async function deleteCourse(courseId, btnEl) {
  const item = btnEl.closest('.course-manage-item');
  const nameEl = item?.querySelector('.course-manage-name');
  const courseLabel = nameEl ? nameEl.textContent.replace('종료', '').replace('중견리더', '').trim() : '이 과정';
  const msg = `"${courseLabel}" 과정을 영구 삭제하시겠습니까?\n\n` +
    `• 수강생·강사·설문 응답 데이터가 모두 삭제됩니다.\n` +
    `• 이 작업은 되돌릴 수 없습니다.`;
  if (!confirm(msg)) return;

  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    // 서브컬렉션 + 회차 cascade 를 동시에 (서로 독립). 행정망에서 직렬 5~6 RTT → 1 RTT.
    await Promise.all([
      deleteSubcollection(courseId, 'instructors'),
      deleteSubcollection(courseId, 'students'),
      deleteSubcollection(courseId, 'responses'),
      deleteSubcollection(courseId, 'attendance'),
      deleteSubcollection(courseId, 'attendanceConfig'),
      deleteRoundsCascade(courseId),  // 중견리더 과정의 회차 + 회차 내부 강사/응답 정리
    ]);
    await deleteDoc(doc(db, 'courses', courseId));
    lsInvalidate('courses');
    lsInvalidate(`instructors:${courseId}`);
    lsInvalidate(`counts:${courseId}`);
    await loadCourseList();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    btnEl.disabled = false; btnEl.textContent = '삭제';
  }
}

async function deleteSubcollection(courseId, subcollectionName) {
  const snap = await getDocs(collection(db, 'courses', courseId, subcollectionName));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// 회차 + 회차 하위 instructors/responses 일괄 삭제 (중견리더 과정 영구삭제용)
async function deleteRoundsCascade(courseId) {
  const roundsSnap = await getDocs(collection(db, 'courses', courseId, 'rounds'));
  for (const rd of roundsSnap.docs) {
    const [instSnap, respSnap] = await Promise.all([
      getDocs(collection(db, 'courses', courseId, 'rounds', rd.id, 'instructors')),
      getDocs(collection(db, 'courses', courseId, 'rounds', rd.id, 'responses')),
    ]);
    await Promise.all([
      ...instSnap.docs.map(d => deleteDoc(d.ref)),
      ...respSnap.docs.map(d => deleteDoc(d.ref)),
    ]);
    await deleteDoc(rd.ref);
  }
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
        html += errors.map(err => `<div class="excel-preview-error">${escapeHtml(err)}</div>`).join('');
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

export async function uploadExcelInstructors(courseId, panelIdx) {
  const data = instExcelData[panelIdx];
  if (!data || data.length === 0) return;

  const btn = document.getElementById(`inst-excel-btn-${panelIdx}`);
  btn.disabled = true;
  const progress = document.getElementById(`inst-excel-progress-${panelIdx}`);
  progress.style.display = 'block';

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

  progress.textContent = `완료: ${success}건 등록${fail > 0 ? `, ${fail}건 실패` : ''}`;
  instExcelData[panelIdx] = [];
  document.getElementById(`inst-excel-input-${panelIdx}`).value = '';
  document.getElementById(`inst-excel-name-${panelIdx}`).textContent = '선택된 파일 없음';
  document.getElementById(`inst-excel-preview-${panelIdx}`).style.display = 'none';

  await loadInstructors(courseId, panelIdx);
}

// ── 강사 관리 ──────────────────────────────

// 패널별 현재 강사 목록 저장 (순서 변경, 수정에 활용)
const panelInstructors = {};

function normalizeInstructorOrder(instructors) {
  instructors.sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    const ta = a.createdAt?.seconds || 0;
    const tb = b.createdAt?.seconds || 0;
    return ta - tb;
  });
  instructors.forEach((inst, i) => {
    if (inst.order === undefined) inst.order = i * 10;
  });
  return instructors;
}

async function loadInstructors(courseId, panelIdx) {
  const panel = document.getElementById(`inst-panel-${panelIdx}`);
  const cacheKey = `instructors:${courseId}`;
  const cached = lsRead(cacheKey);
  const hasCache = Array.isArray(cached);

  if (hasCache) {
    // 캐시 즉시 표시 — 행정망 RTT 비용 없이 첫 화면이 즉시 뜸
    const cachedInsts = normalizeInstructorOrder(cached.map(c => ({ ...c })));
    panelInstructors[panelIdx] = cachedInsts;
    renderInstructorPanel(courseId, panelIdx, cachedInsts);
  } else {
    panel.innerHTML = '<div class="inst-loading">불러오는 중...</div>';
  }

  try {
    const snap = await getDocs(collection(db, 'courses', courseId, 'instructors'));
    const rawDocs = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    const missingOrder = rawDocs.filter(i => i.order === undefined);
    const instructors = normalizeInstructorOrder(rawDocs);

    // fresh 가 비어왔는데 캐시는 있다 — 프록시 변조 가능성. 캐시 유지하고 종료.
    if (instructors.length === 0 && hasCache && cached.length > 0) {
      return;
    }

    // 옛 데이터 호환: order 가 없던 doc 에 정렬 결과를 Firestore 에 백필.
    // (admin 측은 메모리 i*10 부여로 정렬되지만 학생 측 sortInstructors 는 doc 의
    //  order 필드를 보므로, 백필 없으면 admin 정렬 ≠ 학생 화면 정렬 이 발생)
    if (missingOrder.length > 0) {
      const batch = writeBatch(db);
      instructors.forEach(inst => {
        if (missingOrder.some(m => m._id === inst._id)) {
          batch.update(doc(db, 'courses', courseId, 'instructors', inst._id), { order: inst.order });
        }
      });
      batch.commit().catch(() => {}); // 백필은 best-effort, 실패해도 화면 표시는 진행
    }

    panelInstructors[panelIdx] = instructors;
    renderInstructorPanel(courseId, panelIdx, instructors);
    // createdAt 같은 Timestamp 객체는 JSON 직렬화 시 손실 — seconds 만 보존
    lsWrite(cacheKey, instructors.map(i => ({
      _id: i._id, name: i.name, education: i.education, order: i.order,
      createdAt: i.createdAt?.seconds ? { seconds: i.createdAt.seconds } : null,
    })));
  } catch (e) {
    if (!hasCache) {
      panel.innerHTML = '<div class="inst-loading">불러오기 실패</div>';
    }
    // 캐시가 있으면 그대로 두고 침묵
  }
}

function renderInstructorPanel(courseId, panelIdx, instructors) {
  const panel = document.getElementById(`inst-panel-${panelIdx}`);
  const cid = escapeAttr(courseId);
  const total = instructors.length;

  const listHtml = total === 0
    ? '<div class="inst-empty">등록된 강사가 없습니다. 강사를 추가해 주세요.</div>'
    : `<div class="student-bulk-actions">
        <button class="bulk-delete-btn" id="inst-bulk-delete-btn-${panelIdx}" onclick="deleteSelectedInstructors('${cid}', ${panelIdx})" disabled>선택 삭제</button>
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
                  <button class="inst-move-btn" onclick="moveInstructor('${cid}', ${panelIdx}, ${idx}, 'up')" ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
                  <button class="inst-move-btn" onclick="moveInstructor('${cid}', ${panelIdx}, ${idx}, 'down')" ${idx === total - 1 ? 'disabled' : ''} title="아래로">▼</button>
                  <button class="inst-edit-btn" onclick="startEditInstructor('${cid}', ${panelIdx}, ${idx})">수정</button>
                  <button class="delete-btn" onclick="deleteInstructor('${cid}', ${panelIdx}, '${en}', '${ee}', '${eid}', this)">삭제</button>
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
      <button class="add-btn inst-add-btn" onclick="addInstructor('${cid}', ${panelIdx})">+ 추가</button>
    </div>
    <div class="excel-upload-area" style="margin-top:.5rem;">
      <div class="excel-upload-label">엑셀 일괄 등록 <span class="excel-tip">A열: 강의명 / B열: 강사명 / 2행부터 데이터</span></div>
      <div class="excel-upload-row">
        <label class="excel-file-btn" for="inst-excel-input-${panelIdx}">파일 선택</label>
        <input type="file" id="inst-excel-input-${panelIdx}" accept=".xlsx,.xls" style="display:none" onchange="handleInstExcelUpload(${panelIdx}, this)">
        <span id="inst-excel-name-${panelIdx}" class="excel-file-name">선택된 파일 없음</span>
        <button class="add-btn" id="inst-excel-btn-${panelIdx}" onclick="uploadExcelInstructors('${cid}', ${panelIdx})" disabled>일괄 등록</button>
      </div>
      <div id="inst-excel-preview-${panelIdx}" class="excel-preview" style="display:none;"></div>
      <div id="inst-excel-progress-${panelIdx}" class="excel-progress" style="display:none;"></div>
    </div>
    <div class="inst-list" id="inst-list-${panelIdx}">${listHtml}</div>`;
}

export async function addInstructor(courseId, panelIdx) {
  const edu  = document.getElementById(`inst-edu-${panelIdx}`).value.trim();
  const name = document.getElementById(`inst-name-${panelIdx}`).value.trim();
  if (!edu)  { document.getElementById(`inst-edu-${panelIdx}`).focus(); return; }
  if (!name) { document.getElementById(`inst-name-${panelIdx}`).focus(); return; }

  const btn = document.querySelector(`#inst-panel-${panelIdx} .inst-add-btn`);
  btn.disabled = true; btn.textContent = '추가 중...';
  try {
    const currentInsts = panelInstructors[panelIdx] || [];
    const maxOrder = currentInsts.length > 0
      ? Math.max(...currentInsts.map(i => i.order ?? 0))
      : -10;
    await addDoc(collection(db, 'courses', courseId, 'instructors'), {
      name, education: edu, createdAt: serverTimestamp(), order: maxOrder + 10
    });
    lsInvalidate(`instructors:${courseId}`);
    lsInvalidate(`counts:${courseId}`);
    document.getElementById(`inst-edu-${panelIdx}`).value = '';
    document.getElementById(`inst-name-${panelIdx}`).value = '';
    await loadInstructors(courseId, panelIdx);
  } catch (e) { alert('추가 중 오류가 발생했습니다.'); btn.disabled = false; btn.textContent = '+ 추가'; }
}

export async function deleteInstructor(courseId, panelIdx, name, education, instId, btnEl) {
  if (!confirm(`"${name}" 강사를 삭제하시겠습니까?`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    await deleteDoc(doc(db, 'courses', courseId, 'instructors', instId));
    lsInvalidate(`instructors:${courseId}`);
    lsInvalidate(`counts:${courseId}`);
    await loadInstructors(courseId, panelIdx);
  } catch (e) { alert('삭제 중 오류가 발생했습니다.'); btnEl.disabled = false; btnEl.textContent = '삭제'; }
}

// ── 순서 변경 ──────────────────────────────
export async function moveInstructor(courseId, panelIdx, idx, direction) {
  const instructors = panelInstructors[panelIdx];
  if (!instructors) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= instructors.length) return;

  const instA = instructors[idx];
  const instB = instructors[targetIdx];

  // order 값 교환
  const tempOrder = instA.order;
  instA.order = instB.order;
  instB.order = tempOrder;

  try {
    await Promise.all([
      updateDoc(doc(db, 'courses', courseId, 'instructors', instA._id), { order: instA.order }),
      updateDoc(doc(db, 'courses', courseId, 'instructors', instB._id), { order: instB.order }),
    ]);
    lsInvalidate(`instructors:${courseId}`);
    lsInvalidate(`counts:${courseId}`);
    await loadInstructors(courseId, panelIdx);
  } catch (e) {
    alert('순서 변경 중 오류가 발생했습니다.');
    // 롤백
    const t = instA.order; instA.order = instB.order; instB.order = t;
  }
}

// ── 강사 수정 ──────────────────────────────
export function startEditInstructor(courseId, panelIdx, idx) {
  const inst = panelInstructors[panelIdx]?.[idx];
  if (!inst) return;
  const row = document.getElementById(`inst-row-${panelIdx}-${idx}`);
  if (!row) return;
  const cid = escapeAttr(courseId);
  row.innerHTML = `
    <td><input type="checkbox" disabled></td>
    <td><input type="text" id="edit-edu-${panelIdx}-${idx}" value="${escapeAttr(inst.education || '')}" maxlength="50" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td><input type="text" id="edit-name-${panelIdx}-${idx}" value="${escapeAttr(inst.name || '')}" maxlength="20" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td>
      <div class="inst-action-btns">
        <button class="inst-save-btn" onclick="saveEditInstructor('${cid}', ${panelIdx}, ${idx})">저장</button>
        <button class="inst-cancel-btn" onclick="cancelEditInstructor('${cid}', ${panelIdx})">취소</button>
      </div>
    </td>`;
  document.getElementById(`edit-edu-${panelIdx}-${idx}`)?.focus();
}

export async function saveEditInstructor(courseId, panelIdx, idx) {
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
    await updateDoc(doc(db, 'courses', courseId, 'instructors', inst._id), { name, education: edu });
    lsInvalidate(`instructors:${courseId}`);
    lsInvalidate(`counts:${courseId}`);
    await loadInstructors(courseId, panelIdx);
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
  }
}

export async function cancelEditInstructor(courseId, panelIdx) {
  await loadInstructors(courseId, panelIdx);
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

export async function deleteSelectedInstructors(courseId, panelIdx) {
  const checked = document.querySelectorAll(`.inst-checkbox-${panelIdx}:checked`);
  if (!checked.length) return;
  const count = checked.length;
  if (!confirm(`선택한 ${count}명의 강사를 삭제하시겠습니까?`)) return;
  const btn = document.getElementById(`inst-bulk-delete-btn-${panelIdx}`);
  btn.disabled = true; btn.textContent = '삭제 중...';
  try {
    await Promise.all(Array.from(checked).map(cb => deleteDoc(doc(db, 'courses', courseId, 'instructors', cb.dataset.id))));
    lsInvalidate(`instructors:${courseId}`);
    lsInvalidate(`counts:${courseId}`);
    await loadInstructors(courseId, panelIdx);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    btn.disabled = false; btn.textContent = `선택 삭제 (${count}명)`;
  }
}
