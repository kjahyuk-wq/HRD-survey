import { db, auth, functions } from './firebase-config.js';
import {
  collection, getDocs, getDoc,
  doc, setDoc, deleteDoc, serverTimestamp,
  getCountFromServer, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";
import {
  escapeHtml, escapeAttr, formatTime, formatFullDate, formatShortDate, getBuiltinHolidays, toDateStr
} from './utils.js';

// 관리자 세션은 탭이 닫히면 로그아웃되도록 SESSION persistence 사용
setPersistence(auth, browserSessionPersistence).catch(() => {});

// ── 상태 ──────────────────────────────
let currentCourseId = null;
let currentCourseName = '';
let currentConfig = null;
let allStudents = [];
let allAttendance = [];
let scheduleDates = [];
let customHolidays = [];
let excludedHolidays = [];
let dailySessions = 1;
const todayStr = toDateStr(new Date());

// ── 관리자 인증 ──────────────────────────────
const ADMIN_EMAIL = 'kjahyuk@korea.kr';

window.adminLogin = async function() {
  const pwEl = document.getElementById('admin-pw');
  const errEl = document.getElementById('login-err');
  const pw = pwEl.value;
  if (!pw) return;

  const btn = document.querySelector('.login-box .btn-primary');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '확인 중...';
  errEl.style.display = 'none';

  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pw);
  } catch (e) {
    errEl.textContent = '비밀번호가 올바르지 않습니다.';
    errEl.style.display = 'block';
    pwEl.value = '';
    btn.disabled = false;
    btn.textContent = origText;
  }
};

window.adminLogout = async function() {
  await signOut(auth);
};

document.getElementById('admin-pw').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.adminLogin();
});

onAuthStateChanged(auth, user => {
  const isAdmin = !!(user && user.email);
  document.getElementById('login-screen').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('dashboard').style.display = isAdmin ? 'block' : 'none';
  if (isAdmin) {
    loadCourseList();
  } else {
    const pwEl = document.getElementById('admin-pw');
    if (pwEl) pwEl.value = '';
    const btn = document.querySelector('.login-box .btn-primary');
    if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
  }
});

// ── 화면 전환 (카드 리스트 ↔ 출석 현황) ──────────────
window.switchMainTab = function(tab) {
  document.getElementById('main-tab-courses').style.display = tab === 'courses' ? '' : 'none';
  document.getElementById('main-tab-records').style.display = tab === 'records' ? '' : 'none';
  window.scrollTo(0, 0);
};

window.backToCourses = function() {
  switchMainTab('courses');
};

// ── 교육과정 카드 리스트 ──────────────────────────────
let closedCoursesExpanded = false;

window.toggleClosedCourses = function() {
  closedCoursesExpanded = !closedCoursesExpanded;
  const list = document.getElementById('closed-courses-list');
  const arrow = document.getElementById('closed-toggle-arrow');
  const label = document.getElementById('closed-toggle-label');
  if (list) list.style.display = closedCoursesExpanded ? 'block' : 'none';
  if (arrow) arrow.textContent = closedCoursesExpanded ? '▲' : '▼';
  if (label) label.textContent = label.textContent.replace(closedCoursesExpanded ? '보기' : '숨기기', closedCoursesExpanded ? '숨기기' : '보기');
};

window.loadCourseList = async function() {
  const loading = document.getElementById('course-manage-loading');
  const listEl = document.getElementById('course-manage-list');
  const emptyEl = document.getElementById('course-manage-empty');
  const countEl = document.getElementById('course-count');

  loading.style.display = 'block';
  listEl.innerHTML = '';
  emptyEl.style.display = 'none';

  try {
    const snap = await getDocs(collection(db, 'courses'));
    const courses = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || d.id,
        active: data.active !== false,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
      };
    });

    // 진행중 우선 + 시작일 내림차순
    courses.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const sa = a.startDate || '';
      const sb = b.startDate || '';
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      return sb.localeCompare(sa);
    });

    countEl.textContent = courses.length + '개';
    loading.style.display = 'none';

    if (!courses.length) {
      emptyEl.style.display = 'block';
      return;
    }

    courses.forEach((c, idx) => { c.idx = idx; });

    const activeCourses = courses.filter(c => c.active);
    const closedCourses = courses.filter(c => !c.active);
    let html = activeCourses.map(renderCourseCard).join('');
    if (closedCourses.length > 0) {
      const arrow = closedCoursesExpanded ? '▲' : '▼';
      const label = closedCoursesExpanded ? '숨기기' : '보기';
      html += `
        <div class="closed-courses-toggle" id="closed-courses-toggle" onclick="toggleClosedCourses()">
          <span id="closed-toggle-arrow">${arrow}</span>
          <span id="closed-toggle-label">종료된 과정 ${closedCourses.length}개 ${label}</span>
        </div>
        <div id="closed-courses-list" style="display:${closedCoursesExpanded ? 'block' : 'none'};">
          ${closedCourses.map(renderCourseCard).join('')}
        </div>`;
    }
    listEl.innerHTML = html;

    // 비동기로 메타 정보 채우기 (학생 수)
    courses.forEach(async (c) => {
      try {
        const stuRef = collection(db, 'courses', c.id, 'attendance_students');
        const snap = await getCountFromServer(stuRef);
        const total = snap.data().count;
        const metaEl = document.getElementById(`course-meta-${c.idx}`);
        if (metaEl) {
          metaEl.innerHTML = `출결 학생 <strong>${total}명</strong>`;
        }
      } catch (_) {
        const metaEl = document.getElementById(`course-meta-${c.idx}`);
        if (metaEl) metaEl.textContent = '요약 불러오기 실패';
      }
    });
  } catch (e) {
    loading.textContent = '불러오기 실패: ' + e.message;
  }
};

function renderCourseCard({ id, name, active, idx, startDate, endDate }) {
  const cid = escapeAttr(id);
  const statusBadge = active
    ? `<span class="course-status active">진행중</span>`
    : `<span class="course-status closed">종료</span>`;
  const dateLabel = (startDate && endDate) ? `${formatFullDate(startDate)} ~ ${formatFullDate(endDate)}` : '';
  const dateHtml = dateLabel ? `<span class="course-date-range">${escapeHtml(dateLabel)}</span>` : '';
  const safeName = escapeAttr(name);

  const actionBtns = active
    ? `<button class="panel-toggle-btn edit-toggle" id="config-toggle-${idx}"
         onclick="togglePanel('${cid}', ${idx}, 'config', '${safeName}')">출석 설정</button>
       <button class="panel-toggle-btn stu-toggle" id="students-toggle-${idx}"
         onclick="togglePanel('${cid}', ${idx}, 'students', '${safeName}')">학생 명단</button>
       <button class="panel-toggle-btn" onclick="enterRecords('${cid}', '${safeName}')">출석 현황 →</button>
       <button class="course-close-btn" onclick="toggleCourseActive('${cid}', true, this)">종료</button>`
    : `<button class="panel-toggle-btn" onclick="enterRecords('${cid}', '${safeName}')">출석 현황 →</button>
       <button class="course-reopen-btn" onclick="toggleCourseActive('${cid}', false, this)">재활성</button>
       <button class="delete-btn" onclick="deleteCourseAttendance('${cid}', '${safeName}', this)" title="이 과정의 출결 데이터(학생 명단·출석 기록·설정)를 모두 삭제. 만족도 데이터는 보존.">출결 삭제</button>`;

  const panelsHtml = active
    ? `<div class="att-panel" id="config-panel-${idx}" style="display:none;"></div>
       <div class="att-panel" id="students-panel-${idx}" style="display:none;"></div>`
    : '';

  return `
    <div class="course-manage-item ${active ? '' : 'is-closed'}" id="course-item-${idx}">
      <div class="course-manage-row">
        <div class="course-manage-info">
          <span class="course-manage-name">${escapeHtml(name)} ${statusBadge}</span>
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

// ── 과정 종료/재활성 ──────────────────────────────
window.toggleCourseActive = async function(courseId, isCurrentlyActive, btnEl) {
  const newActive = !isCurrentlyActive;
  const actionLabel = newActive ? '재활성' : '종료';
  const desc = newActive
    ? '학생 메일 로그인이 다시 가능해집니다.'
    : '이 과정의 학생들은 더 이상 메일로 로그인할 수 없습니다.';
  if (!confirm(`이 과정을 ${actionLabel} 처리할까요?\n${desc}`)) return;

  btnEl.disabled = true;
  const origText = btnEl.textContent;
  btnEl.textContent = '처리 중...';
  try {
    await setDoc(doc(db, 'courses', courseId), { active: newActive }, { merge: true });
    await loadCourseList();
  } catch(e) {
    alert(`${actionLabel} 실패: ${e.message}`);
    btnEl.disabled = false;
    btnEl.textContent = origText;
  }
};

// ── 과정 출결 데이터 삭제 (만족도 데이터는 보존) ─────────
window.deleteCourseAttendance = async function(courseId, courseName, btnEl) {
  const msg = `[${courseName}]\n\n이 과정의 출결 데이터를 모두 삭제할까요?\n\n· 출결 학생 명단 (attendance_students)\n· 출석 기록 (attendance)\n· 출석 설정 (attendanceConfig)\n\n만족도 조사 데이터와 과정 자체는 보존됩니다.\n복구할 수 없습니다.`;
  if (!confirm(msg)) return;

  btnEl.disabled = true;
  const orig = btnEl.textContent;
  btnEl.textContent = '삭제 중...';
  try {
    const subs = ['attendance_students', 'attendance', 'attendanceConfig'];
    for (const sub of subs) {
      const snap = await getDocs(collection(db, 'courses', courseId, sub));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }
    await loadCourseList();
  } catch(e) {
    alert(`삭제 실패: ${e.message}`);
    btnEl.disabled = false;
    btnEl.textContent = orig;
  }
};

// ── 패널 토글 ──────────────────────────────
window.togglePanel = async function(courseId, idx, mode, courseName) {
  const targetPanel = document.getElementById(`${mode}-panel-${idx}`);
  const targetBtn = document.getElementById(`${mode}-toggle-${idx}`);

  // 같은 패널 두 번 클릭 = 닫기
  if (targetPanel.style.display !== 'none' && targetPanel.innerHTML) {
    targetPanel.style.display = 'none';
    targetPanel.innerHTML = '';
    targetBtn?.classList.remove('active');
    return;
  }

  // 다른 모든 패널 닫기 (한 번에 하나만 열림)
  document.querySelectorAll('.att-panel').forEach(p => {
    p.style.display = 'none';
    p.innerHTML = '';
  });
  document.querySelectorAll('.panel-toggle-btn.active').forEach(b => b.classList.remove('active'));

  // 컨텍스트 설정
  currentCourseId = courseId;
  currentCourseName = courseName;
  // 잔재 초기화
  allAttendance = [];
  attendanceIndex = new Map();
  currentDateTab = null;

  if (mode === 'config') {
    targetPanel.innerHTML = renderConfigPanelHtml();
    targetPanel.style.display = 'block';
    targetBtn?.classList.add('active');
    await loadConfig();
  } else if (mode === 'students') {
    targetPanel.innerHTML = renderStudentsPanelHtml();
    targetPanel.style.display = 'block';
    targetBtn?.classList.add('active');
    initDropzone();
    await loadAttendanceStudents();
  }
};

// ── 출석 설정 패널 HTML ──────────────────────────────
function renderConfigPanelHtml() {
  return `
    <div class="att-panel-section">
      <h4>하루 출석 횟수</h4>
      <div class="sessions-toggle">
        <div class="session-opt selected" id="opt-1" onclick="selectSessions(1)">1회 출석</div>
        <div class="session-opt" id="opt-2" onclick="selectSessions(2)">2회 출석 (오전/오후)</div>
      </div>
    </div>

    <div class="att-panel-section" id="time-config" style="display:none;">
      <h4>출석 시간 설정</h4>
      <div class="two-col">
        <div class="time-group"><label>오전 출석 시작</label><input type="time" id="morning-start" value="09:00"></div>
        <div class="time-group"><label>오전 출석 종료</label><input type="time" id="morning-end" value="12:00"></div>
        <div class="time-group"><label>오후 출석 시작</label><input type="time" id="afternoon-start" value="13:00"></div>
        <div class="time-group"><label>오후 출석 종료</label><input type="time" id="afternoon-end" value="18:00"></div>
      </div>
    </div>

    <div class="att-panel-section">
      <h4>교육 일정 (수업일)</h4>
      <div id="schedule-dates" class="date-tags"></div>
      <div class="date-input-row">
        <input type="date" id="add-schedule-date">
        <button class="btn btn-secondary btn-sm" onclick="addScheduleDate()">+ 날짜 추가</button>
      </div>
      <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <input type="date" id="range-start" style="padding:0.45rem 0.6rem;border:1.5px solid #cbd5e1;border-radius:8px;font-size:0.82rem;">
        <span style="font-size:0.82rem;color:#94a3b8;">~</span>
        <input type="date" id="range-end" style="padding:0.45rem 0.6rem;border:1.5px solid #cbd5e1;border-radius:8px;font-size:0.82rem;">
        <button class="btn btn-secondary btn-sm" onclick="applyDateRange()">범위 적용 (주말 자동 제외)</button>
      </div>
    </div>

    <div class="att-panel-section">
      <h4>휴강일 설정</h4>
      <div class="holiday-info">
        법정 공휴일(신정·삼일절·어린이날·현충일·광복절·개천절·한글날·성탄절)은 자동 반영됩니다.
        설날·추석·부처님오신날 등 음력 공휴일은 아래에 수동으로 추가해 주세요.
      </div>
      <div id="holiday-dates" class="date-tags" style="margin-top:0.7rem;"></div>
      <div class="date-input-row">
        <input type="date" id="add-holiday-date">
        <button class="btn btn-danger btn-sm" onclick="addHolidayDate()">+ 휴강일 추가</button>
      </div>

      <div style="margin-top:1rem;border-top:1px dashed #e2e8f0;padding-top:0.9rem;">
        <div style="font-size:0.88rem;font-weight:600;color:#334155;margin-bottom:0.35rem;">공휴일 예외 (해당 날짜는 수업 진행)</div>
        <div class="holiday-info" style="background:#f0fdf4;color:#166534;">
          법정 공휴일이지만 수업을 진행해야 하는 날짜를 추가하세요. 추가된 날짜는 휴강일에서 제외됩니다.
        </div>
        <div id="excluded-holiday-dates" class="date-tags" style="margin-top:0.7rem;"></div>
        <div class="date-input-row">
          <input type="date" id="add-excluded-holiday-date">
          <button class="btn btn-secondary btn-sm" onclick="addExcludedHolidayDate()">+ 예외 추가</button>
        </div>
      </div>
    </div>

    <div class="att-panel-section">
      <h4>결재 정보</h4>
      <div style="margin-bottom:0.9rem;">
        <label style="display:block;font-size:0.8rem;font-weight:600;color:#64748b;margin-bottom:0.5rem;">소속팀</label>
        <div style="display:flex;gap:1.2rem;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.88rem;cursor:pointer;">
            <input type="radio" name="team-select" id="team-ops" value="교육운영팀"> 교육운영과 교육운영팀
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.88rem;cursor:pointer;">
            <input type="radio" name="team-select" id="team-dev" value="역량교육팀"> 교육운영과 역량교육팀
          </label>
        </div>
      </div>
      <div class="two-col">
        <div class="time-group"><label>담당자 이름 (작성자)</label><input type="text" id="handler-name" placeholder="이름 입력"></div>
        <div class="time-group"><label>과정장 이름 (결재자)</label><input type="text" id="manager-name" placeholder="이름 입력"></div>
      </div>
    </div>

    <div class="save-row">
      <button class="btn btn-primary" onclick="saveConfig()" id="save-btn">설정 저장</button>
    </div>
    <div id="save-status" style="text-align:right;font-size:0.85rem;margin-top:0.4rem;display:none;"></div>

    <div class="att-panel-section" style="border:1.5px dashed #cbd5e1;background:#fff;padding:1rem;border-radius:10px;margin-top:1rem;">
      <h4 style="color:#64748b;border:none;">🔓 기기 잠금 초기화</h4>
      <p style="font-size:0.8rem;color:#94a3b8;margin-bottom:0.7rem;">교육생이 잘못 입력하여 기기가 잠긴 경우, 해당 교육생의 교번을 입력하고 초기화하세요.</p>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <input type="text" id="reset-empno" placeholder="교번 입력" inputmode="numeric"
          style="flex:1;padding:0.55rem 0.8rem;border:1.5px solid #cbd5e1;border-radius:8px;font-size:0.88rem;">
        <button class="btn btn-secondary btn-sm" id="reset-lock-btn" onclick="resetDeviceLock()">초기화</button>
      </div>
      <div id="reset-status" style="font-size:0.8rem;margin-top:0.45rem;min-height:1.2em;"></div>
    </div>
  `;
}

// ── 학생 명단 패널 HTML ──────────────────────────────
function renderStudentsPanelHtml() {
  return `
    <div class="att-panel-section" style="background:#fffbeb;border:1.5px solid #fde68a;padding:0.8rem 1rem;border-radius:10px;">
      <h4 style="color:#92400e;border:none;">📧 등록한 메일 주소는 다시 볼 수 없어요</h4>
      <p style="font-size:0.82rem;color:#78350f;line-height:1.6;">
        교육생이 입력한 메일 주소는 <strong>본인 확인용</strong>으로만 쓰이고, 등록되는 순간 서버에서 안전한 형태로 바뀌어 저장됩니다.<br>
        등록 후에는 <strong>관리자도 메일 주소를 다시 확인할 수 없어요</strong>. 출결과 무관한 다른 용도로도 사용되지 않습니다.<br>
        잘못 입력하셨다면 학생을 <strong>삭제한 뒤 새로 등록</strong>해 주세요.
      </p>
    </div>

    <div class="att-panel-section">
      <h4>학생 단건 등록</h4>
      <div class="two-col">
        <div class="time-group"><label>이름</label><input type="text" id="att-stu-name" placeholder="홍길동" maxlength="20" autocomplete="off"></div>
        <div class="time-group"><label>교번</label><input type="text" id="att-stu-empno" placeholder="교번" inputmode="numeric" autocomplete="off"></div>
      </div>
      <div class="time-group" style="margin-top:0.7rem;">
        <label>공직자 통합메일 <span style="color:#94a3b8;font-weight:400;">(공무직 등 메일 없으면 비워두기)</span></label>
        <input type="email" id="att-stu-email" placeholder="example@korea.kr (선택)" autocomplete="off">
      </div>
      <div class="save-row">
        <button class="btn btn-primary" id="att-stu-add-btn" onclick="addAttendanceStudent()">+ 추가</button>
      </div>
      <div id="att-stu-add-status" style="font-size:0.85rem;text-align:right;display:none;"></div>
    </div>

    <div class="att-panel-section">
      <h4>엑셀 일괄 등록</h4>
      <p style="font-size:0.82rem;color:#64748b;line-height:1.6;margin-bottom:0.7rem;">
        엑셀 첫 행에 <strong>이름 / 교번 / 메일</strong> 헤더를 포함하여 작성해 주세요. (열 순서 자유)
      </p>
      <input type="file" id="att-stu-xlsx" accept=".xlsx,.xls" hidden>
      <div id="att-stu-dropzone" class="dropzone">
        <div class="dz-icon">📁</div>
        <div class="dz-main">엑셀 파일을 끌어다 놓거나 클릭하여 선택</div>
        <div class="dz-sub">.xlsx / .xls 형식</div>
        <div class="dz-filename" id="att-stu-dz-filename"></div>
      </div>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.7rem;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="downloadStudentTemplate()">📥 템플릿 다운로드</button>
        <button class="btn btn-primary btn-sm" id="att-stu-bulk-btn" onclick="bulkUploadAttendanceStudents()">업로드</button>
      </div>
      <div id="att-stu-bulk-status" style="font-size:0.85rem;margin-top:0.6rem;display:none;"></div>
    </div>

    <div class="att-panel-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">
        <h4 style="margin:0;border:none;">등록된 학생 (<span id="att-stu-count">0</span>명)</h4>
        <button class="btn btn-secondary btn-sm" onclick="loadAttendanceStudents()">새로고침</button>
      </div>
      <div class="att-table-wrap">
        <table class="att-table">
          <thead>
            <tr>
              <th style="width:72px;">교번</th>
              <th>이름</th>
              <th style="width:80px;">상태</th>
              <th style="width:90px;">메일</th>
              <th style="width:160px;">관리</th>
            </tr>
          </thead>
          <tbody id="att-stu-tbody">
            <tr><td colspan="5" class="loading">불러오는 중...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── 출석 현황 탭 진입 ──────────────────────────────
window.enterRecords = async function(courseId, courseName) {
  currentCourseId = courseId;
  currentCourseName = courseName;
  document.getElementById('records-course-name').textContent = courseName;
  document.getElementById('records-placeholder').style.display = 'none';
  document.getElementById('records-area').style.display = 'block';

  switchMainTab('records');

  // 출석 설정 + 학생 + 출석 현황 모두 로드
  allAttendance = [];
  attendanceIndex = new Map();
  currentDateTab = null;
  await loadConfig();
  await loadStudents();
  await loadAttendanceRecords();
};

// ── 출석 설정 로드 ──────────────────────────────
async function loadConfig() {
  if (!currentCourseId) return;
  try {
    const configSnap = await getDoc(doc(db, 'courses', currentCourseId, 'attendanceConfig', 'config'));
    if (configSnap.exists()) {
      const cfg = configSnap.data();
      currentConfig = cfg;
      dailySessions = cfg.dailySessions || 1;
      scheduleDates = [...(cfg.scheduleDates || [])];
      customHolidays = [...(cfg.customHolidays || [])];
      excludedHolidays = [...(cfg.excludedHolidays || [])];

      // DOM 존재 시에만 UI 반영 (출석 설정 패널 열린 경우)
      if (document.getElementById('opt-1')) {
        selectSessions(dailySessions, true);
        document.getElementById('morning-start').value = cfg.morningStart || '09:00';
        document.getElementById('morning-end').value = cfg.morningEnd || '12:00';
        document.getElementById('afternoon-start').value = cfg.afternoonStart || '13:00';
        document.getElementById('afternoon-end').value = cfg.afternoonEnd || '18:00';

        const teamVal = cfg.team || '교육운영팀';
        const teamEl = document.querySelector(`input[name="team-select"][value="${teamVal}"]`);
        if (teamEl) teamEl.checked = true;
        else document.getElementById('team-ops').checked = true;
        document.getElementById('handler-name').value = cfg.handlerName || '';
        document.getElementById('manager-name').value = cfg.managerName || '';

        renderDateTags();
        renderHolidayTags();
        renderExcludedHolidayTags();
      }
    } else {
      currentConfig = null;
      scheduleDates = [];
      customHolidays = [];
      excludedHolidays = [];
      if (document.getElementById('opt-1')) {
        selectSessions(1, true);
        document.getElementById('team-ops').checked = true;
        document.getElementById('handler-name').value = '';
        document.getElementById('manager-name').value = '';
        renderDateTags();
        renderHolidayTags();
        renderExcludedHolidayTags();
      }
    }
  } catch(e) {
    console.error('설정 로드 오류:', e);
  }
}

// ── 학생 목록 로드 (출석 현황용 데이터) ──────────────
async function loadStudents() {
  if (!currentCourseId) return;
  try {
    const snap = await getDocs(collection(db, 'courses', currentCourseId, 'attendance_students'));
    allStudents = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
  } catch(e) {
    console.error('출결 학생 로드 오류:', e);
  }
}

// ── 세션 선택 ──────────────────────────────
window.selectSessions = function(n) {
  dailySessions = n;
  const opt1 = document.getElementById('opt-1');
  const opt2 = document.getElementById('opt-2');
  const tc = document.getElementById('time-config');
  if (opt1) opt1.classList.toggle('selected', n === 1);
  if (opt2) opt2.classList.toggle('selected', n === 2);
  if (tc) tc.style.display = n === 2 ? 'block' : 'none';
};

// ── 날짜 태그 렌더 ──────────────────────────────
function renderDateTags() {
  const wrap = document.getElementById('schedule-dates');
  if (!wrap) return;
  if (!scheduleDates.length) {
    wrap.innerHTML = '<span style="font-size:0.82rem;color:#94a3b8;">등록된 수업일이 없습니다.</span>';
    return;
  }
  const sorted = [...scheduleDates].sort();
  wrap.innerHTML = sorted.map(d =>
    `<span class="date-tag date-tag-schedule">${formatShortDate(d)}<button onclick="removeScheduleDate('${d}')">✕</button></span>`
  ).join('');
}

function renderHolidayTags() {
  const wrap = document.getElementById('holiday-dates');
  if (!wrap) return;
  if (!customHolidays.length) {
    wrap.innerHTML = '<span style="font-size:0.82rem;color:#94a3b8;">등록된 휴강일이 없습니다. 법정 공휴일은 자동 반영됩니다.</span>';
    return;
  }
  const sorted = [...customHolidays].sort();
  wrap.innerHTML = sorted.map(d =>
    `<span class="date-tag date-tag-holiday">${formatShortDate(d)}<button onclick="removeHolidayDate('${d}')">✕</button></span>`
  ).join('');
}

function renderExcludedHolidayTags() {
  const wrap = document.getElementById('excluded-holiday-dates');
  if (!wrap) return;
  if (!excludedHolidays.length) {
    wrap.innerHTML = '<span style="font-size:0.82rem;color:#94a3b8;">등록된 예외 없음</span>';
    return;
  }
  const sorted = [...excludedHolidays].sort();
  wrap.innerHTML = sorted.map(d =>
    `<span class="date-tag date-tag-schedule">${formatShortDate(d)}<button onclick="removeExcludedHolidayDate('${d}')">✕</button></span>`
  ).join('');
}

window.addScheduleDate = function() {
  const val = document.getElementById('add-schedule-date').value;
  if (!val) return;
  if (!scheduleDates.includes(val)) {
    scheduleDates.push(val);
    renderDateTags();
  }
  document.getElementById('add-schedule-date').value = '';
};

window.removeScheduleDate = function(d) {
  scheduleDates = scheduleDates.filter(x => x !== d);
  renderDateTags();
};

window.applyDateRange = function() {
  const startVal = document.getElementById('range-start').value;
  const endVal = document.getElementById('range-end').value;
  if (!startVal || !endVal) { alert('시작일과 종료일을 모두 입력해 주세요.'); return; }

  const start = new Date(startVal + 'T00:00:00');
  const end = new Date(endVal + 'T00:00:00');
  if (start > end) { alert('시작일이 종료일보다 늦습니다.'); return; }

  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const str = toDateStr(cur);
      if (!scheduleDates.includes(str)) scheduleDates.push(str);
    }
    cur.setDate(cur.getDate() + 1);
  }
  renderDateTags();
  document.getElementById('range-start').value = '';
  document.getElementById('range-end').value = '';
};

window.addHolidayDate = function() {
  const val = document.getElementById('add-holiday-date').value;
  if (!val) return;
  if (!customHolidays.includes(val)) {
    customHolidays.push(val);
    renderHolidayTags();
  }
  document.getElementById('add-holiday-date').value = '';
};

window.removeHolidayDate = function(d) {
  customHolidays = customHolidays.filter(x => x !== d);
  renderHolidayTags();
};

window.addExcludedHolidayDate = function() {
  const val = document.getElementById('add-excluded-holiday-date').value;
  if (!val) return;
  if (!excludedHolidays.includes(val)) {
    excludedHolidays.push(val);
    renderExcludedHolidayTags();
  }
  document.getElementById('add-excluded-holiday-date').value = '';
};

window.removeExcludedHolidayDate = function(d) {
  excludedHolidays = excludedHolidays.filter(x => x !== d);
  renderExcludedHolidayTags();
};

// ── 설정 저장 ──────────────────────────────
window.saveConfig = async function() {
  if (!currentCourseId) { alert('과정을 먼저 선택해 주세요.'); return; }

  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = '저장 중...';
  const status = document.getElementById('save-status');
  status.style.display = 'none';

  const selectedTeam = document.querySelector('input[name="team-select"]:checked');
  const config = {
    dailySessions,
    morningStart: document.getElementById('morning-start').value || '09:00',
    morningEnd: document.getElementById('morning-end').value || '12:00',
    afternoonStart: document.getElementById('afternoon-start').value || '13:00',
    afternoonEnd: document.getElementById('afternoon-end').value || '18:00',
    scheduleDates: [...scheduleDates].sort(),
    customHolidays: [...customHolidays].sort(),
    excludedHolidays: [...excludedHolidays].sort(),
    team: selectedTeam?.value || '교육운영팀',
    handlerName: document.getElementById('handler-name').value.trim(),
    managerName: document.getElementById('manager-name').value.trim(),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, 'courses', currentCourseId, 'attendanceConfig', 'config'), config);
    currentConfig = config;
    status.style.display = 'block';
    status.style.color = '#16a34a';
    status.textContent = '✅ 설정이 저장되었습니다.';
    setTimeout(() => { status.style.display = 'none'; }, 3000);
  } catch(e) {
    status.style.display = 'block';
    status.style.color = '#dc2626';
    status.textContent = '저장 실패: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '설정 저장';
  }
};

// ── 출석 현황 로드 ──────────────────────────────
let currentDateTab = null;
let attendanceIndex = new Map();

function rebuildAttendanceIndex() {
  attendanceIndex = new Map();
  for (const a of allAttendance) {
    const key = `${a.empNo}_${a.date}_${a.session}`;
    const existing = attendanceIndex.get(key);
    if (!existing || a.manual) attendanceIndex.set(key, a);
  }
}

function setAttendanceIndexEntry(rec) {
  attendanceIndex.set(`${rec.empNo}_${rec.date}_${rec.session}`, rec);
}

window.loadAttendanceRecords = async function() {
  if (!currentCourseId) return;

  const bar = document.getElementById('date-tab-bar');
  bar.innerHTML = '<span style="font-size:0.85rem;color:#94a3b8;">불러오는 중...</span>';

  try {
    const snap = await getDocs(collection(db, 'courses', currentCourseId, 'attendance'));
    allAttendance = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    rebuildAttendanceIndex();
    renderDateTabBar();
    updateSummary();
  } catch(e) {
    bar.innerHTML = `<span style="color:#dc2626;">불러오기 실패: ${e.message}</span>`;
  }
};

function getAllHolidays() {
  const yr = new Date().getFullYear();
  const all = [
    ...customHolidays,
    ...getBuiltinHolidays(yr),
    ...getBuiltinHolidays(yr + 1),
  ];
  const excluded = new Set(excludedHolidays);
  return all.filter(d => !excluded.has(d));
}

function renderDateTabBar() {
  const bar = document.getElementById('date-tab-bar');
  const holidays = getAllHolidays();
  const dates = [...scheduleDates].filter(d => !holidays.includes(d)).sort();

  if (!dates.length) {
    bar.innerHTML = '<span style="font-size:0.85rem;color:#94a3b8;">수업일이 없습니다. 출석 설정에서 수업일을 추가해 주세요.</span>';
    document.getElementById('records-card').style.display = 'none';
    return;
  }

  bar.innerHTML = dates.map(d =>
    `<button class="date-tab-btn${d === currentDateTab ? ' active' : ''}" data-date="${d}" onclick="switchDateTab('${d}')">${formatShortDate(d)}</button>`
  ).join('');

  if (!currentDateTab || !dates.includes(currentDateTab)) {
    switchDateTab(dates[0]);
  } else {
    renderAttendanceTable(currentDateTab);
  }
}

window.switchDateTab = function(date) {
  currentDateTab = date;
  document.querySelectorAll('.date-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.date === date);
  });
  renderAttendanceTable(date);
  updateSummary();
};

function renderAttendanceTable(date) {
  const thead = document.getElementById('att-thead');
  const tbody = document.getElementById('att-tbody');
  document.getElementById('records-card').style.display = 'block';

  const students = [...allStudents].sort((a, b) =>
    String(a.empNo).localeCompare(String(b.empNo), undefined, { numeric: true })
  );

  if (!students.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="5" class="loading">등록된 교육생이 없습니다.</td></tr>';
    document.getElementById('records-title').textContent = `${formatFullDate(date)} 출석 현황`;
    return;
  }

  const sessions = dailySessions === 2 ? ['morning', 'afternoon'] : ['single'];

  if (dailySessions === 2) {
    thead.innerHTML = `<tr>
      <th style="width:72px">교번</th><th>이름</th>
      <th>오전 시각</th><th>오전 상태</th>
      <th>오후 시각</th><th>오후 상태</th>
      <th style="width:56px">저장</th>
    </tr>`;
  } else {
    thead.innerHTML = `<tr>
      <th style="width:72px">교번</th><th>이름</th>
      <th>출석 시각</th><th>상태</th>
      <th style="width:56px">저장</th>
    </tr>`;
  }

  const statusOpts = [
    ['present', '출석'], ['late', '지각'], ['leave', '조퇴'], ['absent', '미출석']
  ];

  tbody.innerHTML = students.map(stu => {
    const cells = sessions.map(sess => {
      const rec = attendanceIndex.get(`${stu.empNo}_${date}_${sess}`);
      let timeVal = '', statusVal = 'absent';
      if (rec) {
        if (rec.manual) {
          timeVal = rec.manualTime || '';
          statusVal = rec.status || 'absent';
        } else {
          timeVal = rec.checkedAt ? formatTime(rec.checkedAt) : '';
          statusVal = rec.status || 'present';
        }
      }
      const key = `${stu.empNo}_${date}_${sess}`;
      const opts = statusOpts.map(([v, l]) =>
        `<option value="${v}"${statusVal === v ? ' selected' : ''}>${l}</option>`
      ).join('');
      return `
        <td><input type="time" id="time_${key}" value="${timeVal}" class="edit-time" onchange="markRowChanged('${stu.empNo}')"></td>
        <td><select id="status_${key}" class="edit-status" onchange="markRowChanged('${stu.empNo}')">${opts}</select></td>`;
    }).join('');

    return `<tr id="row_${stu.empNo}" data-empno="${escapeHtml(String(stu.empNo))}" data-name="${escapeHtml(stu.name)}" data-date="${date}">
      <td>${escapeHtml(String(stu.empNo))}</td>
      <td>${escapeHtml(stu.name)}</td>
      ${cells}
      <td><button class="btn btn-secondary btn-sm" id="savebtn_${stu.empNo}" onclick="saveStudentManual(this)" style="padding:0.25rem 0.6rem;font-size:0.78rem;">저장</button></td>
    </tr>`;
  }).join('');

  document.getElementById('records-title').textContent = `${formatFullDate(date)} 출석 현황 (${students.length}명)`;
}

window.markRowChanged = function(empNo) {
  document.getElementById(`row_${empNo}`)?.classList.add('row-changed');
  const btn = document.getElementById(`savebtn_${empNo}`);
  if (btn) {
    btn.textContent = '저장*';
    Object.assign(btn.style, { background: '#f59e0b', color: '#fff', borderColor: '#f59e0b' });
  }
};

window.saveStudentManual = async function(btnEl) {
  const row = btnEl.closest('tr');
  const empNo = row.dataset.empno;
  const name = row.dataset.name;
  const date = row.dataset.date;
  const btn = document.getElementById(`savebtn_${empNo}`);

  btn.disabled = true; btn.textContent = '저장중...';

  const sessions = dailySessions === 2 ? ['morning', 'afternoon'] : ['single'];

  try {
    for (const sess of sessions) {
      const key = `${empNo}_${date}_${sess}`;
      const manualTime = document.getElementById(`time_${key}`)?.value || '';
      const status = document.getElementById(`status_${key}`)?.value || 'absent';
      const docId = `manual_${empNo}_${date}_${sess}`;

      await setDoc(doc(db, 'courses', currentCourseId, 'attendance', docId), {
        empNo, name, date, session: sess, status, manualTime,
        manual: true, courseId: currentCourseId, updatedAt: serverTimestamp()
      });

      const newRec = { empNo, name, date, session: sess, status, manualTime, manual: true, courseId: currentCourseId, _id: docId };
      const idx = allAttendance.findIndex(a => a._id === docId);
      if (idx >= 0) allAttendance[idx] = newRec;
      else allAttendance.push(newRec);
      setAttendanceIndexEntry(newRec);
    }

    row.classList.remove('row-changed');
    btn.textContent = '저장됨';
    Object.assign(btn.style, { background: '#16a34a', color: '#fff', borderColor: '#16a34a' });
    setTimeout(() => {
      btn.disabled = false; btn.textContent = '저장';
      Object.assign(btn.style, { background: '', color: '', borderColor: '' });
    }, 2000);
    updateSummary();
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '오류';
    Object.assign(btn.style, { background: '#dc2626', color: '#fff', borderColor: '#dc2626' });
    alert('저장 실패: ' + e.message);
    setTimeout(() => {
      btn.textContent = '저장*';
      Object.assign(btn.style, { background: '#f59e0b', color: '#fff', borderColor: '#f59e0b' });
    }, 2000);
  }
};

function updateSummary() {
  const summary = document.getElementById('rate-summary');
  if (!currentConfig || !allStudents.length) { summary.style.display = 'none'; return; }
  summary.style.display = 'flex';

  const holidays = getAllHolidays();
  const dates = currentDateTab
    ? [currentDateTab]
    : scheduleDates.filter(d => !holidays.includes(d));
  const sessions = dailySessions === 2 ? ['morning', 'afternoon'] : ['single'];

  let totalSlots = 0, presentCount = 0;
  for (const d of dates) {
    for (const sess of sessions) {
      for (const stu of allStudents) {
        totalSlots++;
        const rec = attendanceIndex.get(`${stu.empNo}_${d}_${sess}`);
        if (rec) {
          const st = rec.status || (rec.manual ? 'absent' : 'present');
          if (st !== 'absent') presentCount++;
        }
      }
    }
  }

  const absentCount = totalSlots - presentCount;
  const pct = totalSlots > 0 ? Math.round((presentCount / totalSlots) * 100) : 0;

  document.getElementById('rate-total').textContent = allStudents.length;
  document.getElementById('rate-present').textContent = presentCount;
  document.getElementById('rate-absent').textContent = absentCount;
  document.getElementById('rate-pct').textContent = `${pct}%`;
}

// ── 엑셀 다운로드 ──────────────────────────────
window.exportExcel = function() {
  const holidays = getAllHolidays();
  const dates = scheduleDates.filter(d => !holidays.includes(d)).sort();
  const sessions = dailySessions === 2 ? ['morning', 'afternoon'] : ['single'];

  const students = [...allStudents].sort((a, b) =>
    String(a.empNo).localeCompare(String(b.empNo), undefined, { numeric: true })
  );

  if (!students.length) { alert('등록된 교육생이 없습니다.'); return; }
  if (!dates.length) { alert('수업일이 등록되어 있지 않습니다.'); return; }

  const courseName = currentCourseName || '과정명';
  const team = currentConfig?.team || '';
  const handler = currentConfig?.handlerName || '';
  const manager = currentConfig?.managerName || '';

  const STATUS_KO = { present: '출석', late: '지각', leave: '조퇴', absent: '미출석' };
  const SESS_HDR = dailySessions === 2
    ? { morning: ['오전 상태', '오전 시각'], afternoon: ['오후 상태', '오후 시각'] }
    : { single: ['출석 상태', '출석 시각'] };

  const slotsPerDate = sessions.length * 2;
  const totalCols = 2 + dates.length * slotsPerDate;

  let totalPresent = 0, totalAbsent = 0;
  const studentRows = students.map(stu => {
    const row = [String(stu.empNo), stu.name];
    for (const d of dates) {
      for (const sess of sessions) {
        const rec = attendanceIndex.get(`${stu.empNo}_${d}_${sess}`);
        let statusKo = '미출석', timeStr = '';
        if (rec) {
          const st = rec.status || (rec.manual ? 'absent' : 'present');
          statusKo = STATUS_KO[st] || '미출석';
          if (st !== 'absent') {
            timeStr = rec.manual ? (rec.manualTime || '') : (rec.checkedAt ? formatTime(rec.checkedAt) : '');
            totalPresent++;
          } else {
            totalAbsent++;
          }
        } else {
          totalAbsent++;
        }
        row.push(statusKo, timeStr);
      }
    }
    return row;
  });

  const totalSlots = students.length * dates.length * sessions.length;
  const pct = totalSlots > 0 ? Math.round((totalPresent / totalSlots) * 100) : 0;
  const periodStr = dates.length ? `${formatFullDate(dates[0])} ~ ${formatFullDate(dates[dates.length - 1])}` : '-';

  const wsData = [];
  const merges = [];
  const rowHeights = [];
  let r = 0;

  const push = (data, h) => {
    const row = [...data];
    while (row.length < totalCols) row.push('');
    wsData.push(row);
    rowHeights.push(h || 18);
    return r++;
  };

  const R_TITLE    = push([courseName], 46);
  merges.push({ s: { r: R_TITLE, c: 0 }, e: { r: R_TITLE, c: totalCols - 1 } });
  const R_SUBTITLE = push(['출  석  부'], 28);
  merges.push({ s: { r: R_SUBTITLE, c: 0 }, e: { r: R_SUBTITLE, c: totalCols - 1 } });
  push([], 8);
  const R_SUMMARY  = push([
    '전체 교육생', `${students.length}명`,
    '출석', `${totalPresent}건`,
    '미출석', `${totalAbsent}건`,
    '출석률', `${pct}%`
  ], 22);
  const R_PERIOD   = push(['교육기간', periodStr], 20);
  merges.push({ s: { r: R_PERIOD, c: 1 }, e: { r: R_PERIOD, c: totalCols - 1 } });
  push([], 10);

  const R_HDR1 = push(['교번', '이름'], 22);
  merges.push({ s: { r: R_HDR1, c: 0 }, e: { r: R_HDR1 + 1, c: 0 } });
  merges.push({ s: { r: R_HDR1, c: 1 }, e: { r: R_HDR1 + 1, c: 1 } });
  {
    let c = 2;
    for (const d of dates) {
      wsData[R_HDR1][c] = formatFullDate(d);
      merges.push({ s: { r: R_HDR1, c }, e: { r: R_HDR1, c: c + slotsPerDate - 1 } });
      c += slotsPerDate;
    }
  }
  const R_HDR2 = push(['', ''], 20);
  {
    let c = 2;
    for (const d of dates) {
      for (const sess of sessions) {
        const [lbl1, lbl2] = SESS_HDR[sess];
        wsData[R_HDR2][c] = lbl1;
        wsData[R_HDR2][c + 1] = lbl2;
        c += 2;
      }
    }
  }

  const R_DATA_START = r;
  for (const row of studentRows) push(row, 18);
  const R_DATA_END = r - 1;

  push([], 14);
  const R_WRITER = push(['작 성 자', handler ? `${handler}  (인)` : ''], 28);
  const R_APPROVER = push(['결 재 자', manager ? `${manager}  (인)` : ''], 28);
  if (totalCols > 2) {
    merges.push({ s: { r: R_WRITER,   c: 1 }, e: { r: R_WRITER,   c: totalCols - 1 } });
    merges.push({ s: { r: R_APPROVER, c: 1 }, e: { r: R_APPROVER, c: totalCols - 1 } });
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!merges'] = merges;
  const colWidths = [{ wch: 10 }, { wch: 14 }];
  for (let i = 0; i < dates.length * sessions.length; i++) colWidths.push({ wch: 9 }, { wch: 9 });
  ws['!cols'] = colWidths;
  ws['!rows'] = rowHeights.map(h => ({ hpt: h }));
  ws['!pageSetup'] = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws['!margins']   = { left: 0.4, right: 0.4, top: 0.7, bottom: 0.7, header: 0.2, footer: 0.2 };

  const bdr = (rgb = 'C8D4E0', style = 'thin') => {
    const b = { style, color: { rgb } };
    return { top: b, bottom: b, left: b, right: b };
  };
  const S = {
    title:       { font: { bold: true, sz: 20, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('0F2040', 'medium') },
    subtitle:    { font: { bold: true, sz: 13, color: { rgb: '1F3864' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'DDEEFF' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('A0C0D8') },
    summLabel:   { font: { bold: true, sz: 9, color: { rgb: '374151' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'E0ECFF' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('A0B8CC') },
    summValue:   { font: { bold: true, sz: 12, color: { rgb: '1F3864' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'F4F8FF' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('A0B8CC') },
    summEmpty:   { fill: { patternType: 'solid', fgColor: { rgb: 'FAFCFF' } }, border: bdr('D8E4F0') },
    periodLabel: { font: { bold: true, sz: 9, color: { rgb: '374151' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'F0F4FA' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('B8C8D8') },
    periodValue: { font: { sz: 9, color: { rgb: '374151' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'FAFCFF' } }, alignment: { horizontal: 'left', vertical: 'center' }, border: bdr('B8C8D8') },
    hdrFixed:    { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('1A4F8A') },
    hdrDate:     { font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: '2E75B6' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('1A4F8A') },
    hdrSub:      { font: { bold: true, sz: 8, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: '4472C4' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('1A4F8A') },
    dataEven:    { font: { sz: 10, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('D0D8E4') },
    dataOdd:     { font: { sz: 10, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'EEF4FF' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('D0D8E4') },
    absent:      { font: { sz: 10, color: { rgb: 'CC0000' }, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF0F0' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('E0B0B0') },
    apprLabel:   { font: { bold: true, sz: 10, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'EEF2F8' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('888888', 'medium') },
    apprValue:   { font: { sz: 10, name: '맑은 고딕' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bdr('888888', 'medium') },
    blank:       {}
  };

  for (let rowR = 0; rowR < wsData.length; rowR++) {
    for (let colC = 0; colC < totalCols; colC++) {
      const addr = XLSX.utils.encode_cell({ r: rowR, c: colC });
      if (!ws[addr]) ws[addr] = { v: '', t: 's' };
      let s = S.blank;
      if (rowR === R_TITLE) s = S.title;
      else if (rowR === R_SUBTITLE) s = S.subtitle;
      else if (rowR === R_SUMMARY) s = colC < 8 ? (colC % 2 === 0 ? S.summLabel : S.summValue) : S.summEmpty;
      else if (rowR === R_PERIOD) s = colC === 0 ? S.periodLabel : S.periodValue;
      else if (rowR === R_HDR1) s = colC <= 1 ? S.hdrFixed : S.hdrDate;
      else if (rowR === R_HDR2) s = colC <= 1 ? S.hdrFixed : S.hdrSub;
      else if (rowR >= R_DATA_START && rowR <= R_DATA_END) {
        const cellVal = wsData[rowR][colC];
        const isEven = (rowR - R_DATA_START) % 2 === 0;
        s = cellVal === '미출석' ? S.absent : (isEven ? S.dataEven : S.dataOdd);
      } else if (rowR === R_WRITER || rowR === R_APPROVER) s = colC === 0 ? S.apprLabel : S.apprValue;
      ws[addr].s = s;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '출석부');
  XLSX.writeFile(wb, `출석부_${courseName}_${toDateStr(new Date())}.xlsx`);
};

// ── 기기 잠금 초기화 ──────────────────────────────
window.resetDeviceLock = async function() {
  const empNo = document.getElementById('reset-empno').value.trim();
  const statusEl = document.getElementById('reset-status');
  if (!empNo) { statusEl.textContent = '교번을 입력해 주세요.'; statusEl.style.color = '#dc2626'; return; }
  if (!currentCourseId) { statusEl.textContent = '과정을 먼저 선택해 주세요.'; statusEl.style.color = '#dc2626'; return; }

  const btn = document.getElementById('reset-lock-btn');
  btn.disabled = true; btn.textContent = '처리 중...';
  statusEl.textContent = '';

  try {
    await setDoc(doc(db, 'courses', currentCourseId, 'attendanceConfig', `reset_${empNo}_${todayStr}`), {
      empNo, courseId: currentCourseId, date: todayStr, resetAt: serverTimestamp()
    });
    statusEl.style.color = '#16a34a';
    statusEl.textContent = `✅ 교번 ${empNo} 기기 잠금 초기화 완료. 교육생이 다시 로그인하면 해제됩니다.`;
    document.getElementById('reset-empno').value = '';
    setTimeout(() => { statusEl.textContent = ''; }, 6000);
  } catch(e) {
    statusEl.style.color = '#dc2626';
    statusEl.textContent = '초기화 실패: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '초기화';
  }
};

// ── 출결 학생 명단 (attendance_students) ──────────────
const registerOne = httpsCallable(functions, 'registerAttendanceStudent');
const registerMany = httpsCallable(functions, 'registerAttendanceStudents');

window.loadAttendanceStudents = async function() {
  const tbody = document.getElementById('att-stu-tbody');
  const cnt = document.getElementById('att-stu-count');
  if (!tbody) return;
  if (!currentCourseId) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading">과정을 선택하세요.</td></tr>';
    if (cnt) cnt.textContent = '0';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="4" class="loading">불러오는 중...</td></tr>';

  try {
    const snap = await getDocs(collection(db, 'courses', currentCourseId, 'attendance_students'));
    const list = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => String(a.empNo).localeCompare(String(b.empNo), undefined, { numeric: true }));

    if (cnt) cnt.textContent = list.length;
    allStudents = list;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">등록된 학생이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(s => {
      const isActive = s.active !== false;
      const statusBadge = isActive
        ? '<span style="display:inline-block;padding:1px 7px;border-radius:8px;background:#dcfce7;color:#15803d;font-size:0.75rem;font-weight:600;">활성</span>'
        : '<span style="display:inline-block;padding:1px 7px;border-radius:8px;background:#f3f4f6;color:#6b7280;font-size:0.75rem;font-weight:600;">비활성</span>';
      const mailBadge = s.email_hmac
        ? '<span style="color:#16a34a;font-size:0.78rem;" title="메일로 로그인">✓ 등록됨</span>'
        : '<span style="color:#6b7280;font-size:0.78rem;" title="이름+교번으로 로그인 (공무직 등)">교번 로그인</span>';
      const toggleBtn = isActive
        ? `<button class="btn btn-secondary btn-sm" onclick="toggleStudentActive('${escapeAttr(s._id)}', true)" style="padding:0.25rem 0.5rem;font-size:0.75rem;background:#fff7ed;color:#c2410c;border-color:#fdba74;" title="이 학생의 메일 로그인을 차단">비활성화</button>`
        : `<button class="btn btn-secondary btn-sm" onclick="toggleStudentActive('${escapeAttr(s._id)}', false)" style="padding:0.25rem 0.5rem;font-size:0.75rem;background:#ecfdf5;color:#047857;border-color:#6ee7b7;" title="이 학생의 메일 로그인을 다시 허용">활성화</button>`;
      const trClass = isActive ? '' : 'class="is-inactive" style="opacity:0.6;"';
      return `
        <tr data-id="${escapeAttr(s._id)}" ${trClass}>
          <td>${escapeHtml(String(s.empNo || ''))}</td>
          <td>${escapeHtml(s.name || '')}</td>
          <td>${statusBadge}</td>
          <td>${mailBadge}</td>
          <td style="display:flex;gap:0.3rem;flex-wrap:wrap;">
            ${toggleBtn}
            <button class="btn btn-secondary btn-sm" onclick="deleteAttendanceStudent('${escapeAttr(s._id)}', '${escapeAttr(s.name || '')}')" style="padding:0.25rem 0.5rem;font-size:0.75rem;background:#fee2e2;color:#991b1b;border-color:#fecaca;">삭제</button>
          </td>
        </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#dc2626;">불러오기 실패: ${escapeHtml(e.message)}</td></tr>`;
  }
};

window.addAttendanceStudent = async function() {
  const status = document.getElementById('att-stu-add-status');
  const btn = document.getElementById('att-stu-add-btn');
  if (!currentCourseId) { alert('과정을 먼저 선택해 주세요.'); return; }

  const name = document.getElementById('att-stu-name').value.trim();
  const empNo = document.getElementById('att-stu-empno').value.trim();
  const email = document.getElementById('att-stu-email').value.trim();

  if (!name || !empNo) {
    showAddStatus('이름과 교번을 입력해 주세요.', '#dc2626');
    return;
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showAddStatus('메일 형식이 올바르지 않습니다.', '#dc2626');
    return;
  }

  btn.disabled = true; btn.textContent = '등록 중...';
  status.style.display = 'none';

  try {
    await registerOne({ courseId: currentCourseId, name, empNo, email });
    document.getElementById('att-stu-name').value = '';
    document.getElementById('att-stu-empno').value = '';
    document.getElementById('att-stu-email').value = '';
    showAddStatus(`✅ ${name} 님 등록 완료`, '#16a34a');
    await loadAttendanceStudents();
  } catch(e) {
    showAddStatus(`등록 실패: ${e.message || e}`, '#dc2626');
  } finally {
    btn.disabled = false; btn.textContent = '+ 추가';
  }

  function showAddStatus(msg, color) {
    status.style.display = 'block';
    status.style.color = color;
    status.textContent = msg;
  }
};

// Cloud Function 의 uid 발급 로직과 동일하게 학생 doc 정보 → uid 계산.
//   - email_hmac 있으면 → stu_{email_hmac[0:28]}
//   - 없으면         → stu_{sha256('empno|<empNo>|<name>')[0:28]}
// 학생 doc 삭제 시 이 uid 로 박힌 attendance 기록을 함께 삭제하여 잔재 0.
async function computeStudentUid(stu) {
  if (stu.email_hmac) return `stu_${String(stu.email_hmac).substring(0, 28)}`;
  const buf = new TextEncoder().encode(`empno|${stu.empNo}|${stu.name}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `stu_${hex.substring(0, 28)}`;
}

window.deleteAttendanceStudent = async function(docId, name) {
  if (!currentCourseId) return;
  if (!confirm(`${name} 학생을 출결 명단에서 삭제할까요?\n이 학생의 출결 기록(attendance)도 함께 삭제됩니다.\n복구할 수 없습니다.`)) return;

  try {
    // 학생 doc 읽어 uid 계산 (메일 다른 학생의 출결까지 잘못 지우는 일 방지)
    const stuRef = doc(db, 'courses', currentCourseId, 'attendance_students', docId);
    const stuSnap = await getDoc(stuRef);
    if (!stuSnap.exists()) {
      alert('이미 삭제된 학생입니다.');
      await loadAttendanceStudents();
      return;
    }
    const stu = stuSnap.data();
    const uid = await computeStudentUid(stu);

    // 같은 과정의 attendance 에서 studentId 매칭 doc 일괄 삭제 (writeBatch 450 op/배치)
    const attSnap = await getDocs(query(
      collection(db, 'courses', currentCourseId, 'attendance'),
      where('studentId', '==', uid)
    ));
    for (let i = 0; i < attSnap.docs.length; i += 450) {
      const batch = writeBatch(db);
      attSnap.docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    await deleteDoc(stuRef);
    await loadAttendanceStudents();
  } catch(e) {
    alert('삭제 실패: ' + e.message);
  }
};

window.toggleStudentActive = async function(docId, isCurrentlyActive) {
  if (!currentCourseId) return;
  const newActive = !isCurrentlyActive;
  try {
    await setDoc(
      doc(db, 'courses', currentCourseId, 'attendance_students', docId),
      { active: newActive },
      { merge: true }
    );
    await loadAttendanceStudents();
  } catch(e) {
    alert('상태 변경 실패: ' + e.message);
  }
};

window.downloadStudentTemplate = function() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['이름', '교번', '메일'],
    ['홍길동', '12345', 'hong@korea.kr'],
    ['김영희', '12346', 'kim@korea.kr'],
  ]);
  ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '학생명단');
  XLSX.writeFile(wb, '출결_학생등록_템플릿.xlsx');
};

window.bulkUploadAttendanceStudents = async function() {
  const status = document.getElementById('att-stu-bulk-status');
  const btn = document.getElementById('att-stu-bulk-btn');
  const fileEl = document.getElementById('att-stu-xlsx');

  if (!currentCourseId) { alert('과정을 먼저 선택해 주세요.'); return; }
  if (!fileEl.files?.length) {
    showBulkStatus('엑셀 파일을 선택해 주세요.', '#dc2626');
    return;
  }

  btn.disabled = true; btn.textContent = '읽는 중...';
  status.style.display = 'none';

  try {
    const file = fileEl.files[0];
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const students = rows.map(row => {
      const get = keys => {
        for (const k of Object.keys(row)) {
          const norm = String(k).trim();
          if (keys.some(t => norm === t || norm.includes(t))) return String(row[k] || '').trim();
        }
        return '';
      };
      return {
        name: get(['이름', '성명', 'name']),
        empNo: get(['교번', '직원번호', 'empNo']),
        email: get(['메일', '이메일', 'email']),
      };
    }).filter(s => s.name || s.empNo || s.email);

    if (!students.length) {
      showBulkStatus('엑셀에서 학생 데이터를 찾지 못했습니다. 헤더를 확인해 주세요. (이름/교번/메일)', '#dc2626');
      return;
    }

    btn.textContent = `등록 중... (${students.length}명)`;
    const result = await registerMany({ courseId: currentCourseId, students });
    const data = result.data || {};

    let msg = `✅ ${data.added || 0}명 등록 완료`;
    if (Array.isArray(data.errors) && data.errors.length) {
      msg += ` / ⚠️ ${data.errors.length}건 누락`;
      const sample = data.errors.slice(0, 3).map(e => `· ${e.name || `행 ${e.idx + 1}`}: ${e.reason}`).join('\n');
      msg += `\n${sample}${data.errors.length > 3 ? `\n... 외 ${data.errors.length - 3}건` : ''}`;
    }
    showBulkStatus(msg, data.errors?.length ? '#d97706' : '#16a34a');
    fileEl.value = '';
    fileEl.dispatchEvent(new Event('change'));
    await loadAttendanceStudents();
  } catch(e) {
    showBulkStatus(`업로드 실패: ${e.message || e}`, '#dc2626');
  } finally {
    btn.disabled = false; btn.textContent = '업로드';
  }

  function showBulkStatus(msg, color) {
    status.style.display = 'block';
    status.style.color = color;
    status.style.whiteSpace = 'pre-line';
    status.textContent = msg;
  }
};

// ── 엑셀 드롭존 (패널 열릴 때마다 다시 부착) ───────
function initDropzone() {
  const dz = document.getElementById('att-stu-dropzone');
  const fileInput = document.getElementById('att-stu-xlsx');
  const filenameEl = document.getElementById('att-stu-dz-filename');
  if (!dz || !fileInput) return;

  const isExcel = (name) => /\.(xlsx|xls)$/i.test(name);

  const refreshUI = () => {
    const file = fileInput.files?.[0];
    if (file) {
      dz.classList.add('has-file');
      filenameEl.innerHTML = `✓ ${escapeHtml(file.name)} <button type="button" class="dz-clear" onclick="clearAttStudentFile(event)">✕</button>`;
    } else {
      dz.classList.remove('has-file');
      filenameEl.textContent = '';
    }
  };

  dz.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', refreshUI);

  ['dragenter', 'dragover'].forEach(evt =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('dragover');
    })
  );
  ['dragleave', 'dragend', 'drop'].forEach(evt =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('dragover');
    })
  );

  dz.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    const file = files[0];
    if (!isExcel(file.name)) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    refreshUI();
  });
}

window.clearAttStudentFile = function(ev) {
  ev?.stopPropagation();
  const fileInput = document.getElementById('att-stu-xlsx');
  if (fileInput) fileInput.value = '';
  document.getElementById('att-stu-dropzone')?.classList.remove('has-file');
  const f = document.getElementById('att-stu-dz-filename');
  if (f) f.textContent = '';
};
