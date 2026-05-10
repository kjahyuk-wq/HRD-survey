import { db, auth, functions } from './firebase-config.js';
import {
  collection, getDocs, getDoc,
  doc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";

// 관리자 세션은 탭이 닫히면 로그아웃되도록 SESSION persistence 사용
// (기본 LOCAL은 LocalStorage 영속이라 공용 PC에서 자동 로그인 위험)
setPersistence(auth, browserSessionPersistence).catch(() => {});
import {
  escapeHtml, formatTime, formatFullDate, formatShortDate, getBuiltinHolidays
} from './utils.js';

// ── 상태 ──────────────────────────────
let currentCourseId = null;
let currentConfig = null;
let allStudents = [];
let allAttendance = [];
let scheduleDates = [];
let customHolidays = [];
let excludedHolidays = [];
let dailySessions = 1;
const todayStr = new Date().toISOString().slice(0, 10);

// ── 관리자 인증 ──────────────────────────────
// 메인 admin과 동일 계정. Firebase Console > Authentication > Users 에 등록.
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
    // onAuthStateChanged가 UI 전환을 처리함
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
    loadCourses();
  } else {
    const pwEl = document.getElementById('admin-pw');
    if (pwEl) pwEl.value = '';
    const btn = document.querySelector('.login-box .btn-primary');
    if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
  }
});

// ── 탭 전환 ──────────────────────────────
const TAB_NAMES = ['config', 'students', 'records'];
window.switchTab = function(tab) {
  TAB_NAMES.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', TAB_NAMES[i] === tab);
  });
  if (tab === 'records') loadAttendanceRecords();
  if (tab === 'students') loadAttendanceStudents();
};

// ── 과정 목록 로드 ──────────────────────────────
window.loadCourses = async function() {
  const sel = document.getElementById('course-select');
  const loading = document.getElementById('course-loading');
  loading.style.display = 'block';
  try {
    const snap = await getDocs(collection(db, 'courses'));
    sel.innerHTML = '<option value="">-- 과정을 선택하세요 --</option>';
    snap.docs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.data().name || d.id;
      sel.appendChild(opt);
    });
  } catch(e) {
    alert('과정 목록을 불러오는데 실패했습니다: ' + e.message);
  } finally {
    loading.style.display = 'none';
  }
};

// ── 과정 변경 ──────────────────────────────
window.onCourseChange = async function() {
  currentCourseId = document.getElementById('course-select').value;
  if (!currentCourseId) {
    document.getElementById('main-tabs').style.display = 'none';
    return;
  }
  document.getElementById('main-tabs').style.display = 'flex';
  await loadConfig();
  await loadStudents();
};

// ── 설정 로드 ──────────────────────────────
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

      selectSessions(dailySessions, true);
      document.getElementById('morning-start').value = cfg.morningStart || '09:00';
      document.getElementById('morning-end').value = cfg.morningEnd || '12:00';
      document.getElementById('afternoon-start').value = cfg.afternoonStart || '13:00';
      document.getElementById('afternoon-end').value = cfg.afternoonEnd || '18:00';

      // 결재 정보
      const teamVal = cfg.team || '교육운영팀';
      const teamEl = document.querySelector(`input[name="team-select"][value="${teamVal}"]`);
      if (teamEl) teamEl.checked = true;
      else document.getElementById('team-ops').checked = true;
      document.getElementById('handler-name').value = cfg.handlerName || '';
      document.getElementById('manager-name').value = cfg.managerName || '';
    } else {
      currentConfig = null;
      scheduleDates = [];
      customHolidays = [];
      excludedHolidays = [];
      selectSessions(1, true);
      document.getElementById('team-ops').checked = true;
      document.getElementById('handler-name').value = '';
      document.getElementById('manager-name').value = '';
    }
    renderDateTags();
    renderHolidayTags();
    renderExcludedHolidayTags();
  } catch(e) {
    console.error('설정 로드 오류:', e);
  }
}

// ── 출결용 학생 목록 로드 (만족도 조사 students와 분리) ──
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
window.selectSessions = function(n, silent = false) {
  dailySessions = n;
  document.getElementById('opt-1').classList.toggle('selected', n === 1);
  document.getElementById('opt-2').classList.toggle('selected', n === 2);
  document.getElementById('time-config').style.display = n === 2 ? 'block' : 'none';
};

// ── 수업일 태그 ──────────────────────────────
function renderDateTags() {
  const wrap = document.getElementById('schedule-dates');
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
  if (!customHolidays.length) {
    wrap.innerHTML = '<span style="font-size:0.82rem;color:#94a3b8;">등록된 휴강일이 없습니다. 법정 공휴일은 자동 반영됩니다.</span>';
    return;
  }
  const sorted = [...customHolidays].sort();
  wrap.innerHTML = sorted.map(d =>
    `<span class="date-tag date-tag-holiday">${formatShortDate(d)}<button onclick="removeHolidayDate('${d}')">✕</button></span>`
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

// 날짜 범위 추가 (주말 제외)
window.addDateRange = function() {
  const s = document.getElementById('range-start');
  const e = document.getElementById('range-end');
  // 입력창 표시 토글
  const row = s.closest('div');
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
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
    if (dow !== 0 && dow !== 6) { // 주말 제외
      const str = cur.toISOString().slice(0, 10);
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
// key = `${empNo}_${date}_${session}` → rec (manual 우선).
// renderAttendanceTable / updateSummary / exportExcel 가 공유.
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
  // manual 레코드는 항상 우선이므로 단순 set.
  attendanceIndex.set(`${rec.empNo}_${rec.date}_${rec.session}`, rec);
}

async function loadAttendanceRecords() {
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
}

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

  // 교번순 정렬
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

  // 헤더
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
        <td><input type="time" id="time_${key}" value="${timeVal}" class="edit-time"
          onchange="markRowChanged('${stu.empNo}')"></td>
        <td><select id="status_${key}" class="edit-status"
          onchange="markRowChanged('${stu.empNo}')">${opts}</select></td>`;
    }).join('');

    return `<tr id="row_${stu.empNo}" data-empno="${escapeHtml(String(stu.empNo))}" data-name="${escapeHtml(stu.name)}" data-date="${date}">
      <td>${escapeHtml(String(stu.empNo))}</td>
      <td>${escapeHtml(stu.name)}</td>
      ${cells}
      <td><button class="btn btn-secondary btn-sm" id="savebtn_${stu.empNo}"
        onclick="saveStudentManual(this)"
        style="padding:0.25rem 0.6rem;font-size:0.78rem;">저장</button></td>
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

      // 로컬 상태 동기화
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
  // ── 데이터 준비 ─────────────────────────────
  const holidays = getAllHolidays();
  const dates = scheduleDates.filter(d => !holidays.includes(d)).sort();
  const sessions = dailySessions === 2 ? ['morning', 'afternoon'] : ['single'];

  const students = [...allStudents].sort((a, b) =>
    String(a.empNo).localeCompare(String(b.empNo), undefined, { numeric: true })
  );

  if (!students.length) { alert('등록된 교육생이 없습니다.'); return; }
  if (!dates.length) { alert('수업일이 등록되어 있지 않습니다.'); return; }

  const courseSelect = document.getElementById('course-select');
  const courseName = courseSelect.options[courseSelect.selectedIndex]?.text || '과정명';
  const team = currentConfig?.team || '';
  const handler = currentConfig?.handlerName || '';
  const manager = currentConfig?.managerName || '';

  const STATUS_KO = { present: '출석', late: '지각', leave: '조퇴', absent: '미출석' };
  const SESS_HDR = dailySessions === 2
    ? { morning: ['오전 상태', '오전 시각'], afternoon: ['오후 상태', '오후 시각'] }
    : { single: ['출석 상태', '출석 시각'] };

  // 총 컬럼: 교번(1) + 이름(1) + 날짜 × 세션 × 2(상태+시각)
  const slotsPerDate = sessions.length * 2;
  const totalCols = 2 + dates.length * slotsPerDate;

  // ── 1차 루프: 학생 데이터 행 생성 + 통계 집계 ────────────────
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
            timeStr = rec.manual
              ? (rec.manualTime || '')
              : (rec.checkedAt ? formatTime(rec.checkedAt) : '');
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
  const periodStr = dates.length
    ? `${formatFullDate(dates[0])} ~ ${formatFullDate(dates[dates.length - 1])}`
    : '-';

  // ── 워크시트 데이터(AOA) 및 병합/높이 구성 ──────────────────
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

  // R0: 과정명 (대제목)
  const R_TITLE    = push([courseName], 46);
  merges.push({ s: { r: R_TITLE, c: 0 }, e: { r: R_TITLE, c: totalCols - 1 } });

  // R1: 출석부 (소제목)
  const R_SUBTITLE = push(['출  석  부'], 28);
  merges.push({ s: { r: R_SUBTITLE, c: 0 }, e: { r: R_SUBTITLE, c: totalCols - 1 } });

  // R2: 빈 줄 (구분)
  push([], 8);

  // R3: 출석 현황 요약 (과정명 바로 아래)
  const R_SUMMARY  = push([
    '전체 교육생', `${students.length}명`,
    '출석', `${totalPresent}건`,
    '미출석', `${totalAbsent}건`,
    '출석률', `${pct}%`
  ], 22);

  // R4: 교육기간
  const R_PERIOD   = push(['교육기간', periodStr], 20);
  merges.push({ s: { r: R_PERIOD, c: 1 }, e: { r: R_PERIOD, c: totalCols - 1 } });

  // R5: 빈 줄
  push([], 10);

  // R6: 헤더 1행 — 교번(2행 병합), 이름(2행 병합), 날짜(slotsPerDate 열 병합)
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

  // R7: 헤더 2행 — 세션별 상태/시각
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

  // R8~: 학생 데이터
  const R_DATA_START = r;
  for (const row of studentRows) push(row, 18);
  const R_DATA_END = r - 1;

  // 빈 줄
  push([], 14);

  // 결재란: 작성자 / 결재자 두 줄
  const R_WRITER = push(['작 성 자', handler ? `${handler}  (인)` : ''], 28);
  const R_APPROVER = push(['결 재 자', manager ? `${manager}  (인)` : ''], 28);

  // 결재란 값 셀을 나머지 전체 열에 병합
  if (totalCols > 2) {
    merges.push({ s: { r: R_WRITER,   c: 1 }, e: { r: R_WRITER,   c: totalCols - 1 } });
    merges.push({ s: { r: R_APPROVER, c: 1 }, e: { r: R_APPROVER, c: totalCols - 1 } });
  }

  // ── 워크시트 생성 ─────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!merges'] = merges;

  // 열 너비 설정
  const colWidths = [{ wch: 10 }, { wch: 14 }];
  for (let i = 0; i < dates.length * sessions.length; i++) {
    colWidths.push({ wch: 9 }, { wch: 9 }); // 상태, 시각
  }
  ws['!cols'] = colWidths;

  // 행 높이 설정
  ws['!rows'] = rowHeights.map(h => ({ hpt: h }));

  // 인쇄 설정 (가로 방향, 1페이지 너비 맞춤)
  ws['!pageSetup'] = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws['!margins']   = { left: 0.4, right: 0.4, top: 0.7, bottom: 0.7, header: 0.2, footer: 0.2 };

  // ── 셀 스타일 정의 ────────────────────────────
  const bdr = (rgb = 'C8D4E0', style = 'thin') => {
    const b = { style, color: { rgb } };
    return { top: b, bottom: b, left: b, right: b };
  };

  const S = {
    title: {
      font: { bold: true, sz: 20, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('0F2040', 'medium')
    },
    subtitle: {
      font: { bold: true, sz: 13, color: { rgb: '1F3864' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'DDEEFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('A0C0D8')
    },
    summLabel: {
      font: { bold: true, sz: 9, color: { rgb: '374151' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'E0ECFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('A0B8CC')
    },
    summValue: {
      font: { bold: true, sz: 12, color: { rgb: '1F3864' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'F4F8FF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('A0B8CC')
    },
    summEmpty: {
      fill: { patternType: 'solid', fgColor: { rgb: 'FAFCFF' } },
      border: bdr('D8E4F0')
    },
    periodLabel: {
      font: { bold: true, sz: 9, color: { rgb: '374151' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'F0F4FA' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('B8C8D8')
    },
    periodValue: {
      font: { sz: 9, color: { rgb: '374151' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FAFCFF' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: bdr('B8C8D8')
    },
    hdrFixed: {
      font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('1A4F8A')
    },
    hdrDate: {
      font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: '2E75B6' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('1A4F8A')
    },
    hdrSub: {
      font: { bold: true, sz: 8, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: '4472C4' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('1A4F8A')
    },
    dataEven: {
      font: { sz: 10, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('D0D8E4')
    },
    dataOdd: {
      font: { sz: 10, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'EEF4FF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('D0D8E4')
    },
    absent: {
      font: { sz: 10, color: { rgb: 'CC0000' }, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFF0F0' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('E0B0B0')
    },
    apprLabel: {
      font: { bold: true, sz: 10, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'EEF2F8' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('888888', 'medium')
    },
    apprValue: {
      font: { sz: 10, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: bdr('888888', 'medium')
    },
    apprSign: {
      font: { sz: 10, name: '맑은 고딕' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FAFCFF' } },
      alignment: { horizontal: 'center', vertical: 'bottom' },
      border: bdr('888888', 'medium')
    },
    blank: {}
  };

  // ── 각 셀에 스타일 적용 ───────────────────────
  for (let rowR = 0; rowR < wsData.length; rowR++) {
    for (let colC = 0; colC < totalCols; colC++) {
      const addr = XLSX.utils.encode_cell({ r: rowR, c: colC });
      if (!ws[addr]) ws[addr] = { v: '', t: 's' };

      let s = S.blank;

      if (rowR === R_TITLE) {
        s = S.title;
      } else if (rowR === R_SUBTITLE) {
        s = S.subtitle;
      } else if (rowR === R_SUMMARY) {
        if (colC < 8) s = colC % 2 === 0 ? S.summLabel : S.summValue;
        else s = S.summEmpty;
      } else if (rowR === R_PERIOD) {
        s = colC === 0 ? S.periodLabel : S.periodValue;
      } else if (rowR === R_HDR1) {
        s = colC <= 1 ? S.hdrFixed : S.hdrDate;
      } else if (rowR === R_HDR2) {
        s = colC <= 1 ? S.hdrFixed : S.hdrSub;
      } else if (rowR >= R_DATA_START && rowR <= R_DATA_END) {
        const cellVal = wsData[rowR][colC];
        const isEven = (rowR - R_DATA_START) % 2 === 0;
        s = cellVal === '미출석' ? S.absent : (isEven ? S.dataEven : S.dataOdd);
      } else if (rowR === R_WRITER || rowR === R_APPROVER) {
        s = colC === 0 ? S.apprLabel : S.apprValue;
      }

      ws[addr].s = s;
    }
  }

  // ── 워크북 저장 ──────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '출석부');
  XLSX.writeFile(wb, `출석부_${courseName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
    // courses/{courseId}/attendanceConfig/reset_{empNo}_{date} — 기존 규칙으로 허용됨
    await setDoc(doc(db, 'courses', currentCourseId, 'attendanceConfig', `reset_${empNo}_${todayStr}`), {
      empNo,
      courseId: currentCourseId,
      date: todayStr,
      resetAt: serverTimestamp()
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
  if (!currentCourseId) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading">과정을 선택하세요.</td></tr>';
    cnt.textContent = '0';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="4" class="loading">불러오는 중...</td></tr>';

  try {
    const snap = await getDocs(collection(db, 'courses', currentCourseId, 'attendance_students'));
    const list = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => String(a.empNo).localeCompare(String(b.empNo), undefined, { numeric: true }));

    cnt.textContent = list.length;
    allStudents = list;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="loading">등록된 학생이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(s => `
      <tr data-id="${escapeHtml(s._id)}">
        <td>${escapeHtml(String(s.empNo || ''))}</td>
        <td>${escapeHtml(s.name || '')}</td>
        <td>${s.email_hmac ? '<span style="color:#16a34a;font-size:0.8rem;">✓ 등록됨</span>' : '<span style="color:#dc2626;font-size:0.8rem;">없음</span>'}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="deleteAttendanceStudent('${escapeHtml(s._id)}', '${escapeHtml(s.name || '')}')" style="padding:0.25rem 0.6rem;font-size:0.78rem;background:#fee2e2;color:#991b1b;border-color:#fecaca;">삭제</button></td>
      </tr>
    `).join('');
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

  if (!name || !empNo || !email) {
    showAddStatus('이름/교번/메일을 모두 입력해 주세요.', '#dc2626');
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showAddStatus('메일 형식이 올바르지 않습니다.', '#dc2626');
    return;
  }

  btn.disabled = true; btn.textContent = '등록 중...';
  status.style.display = 'none';

  try {
    await registerOne({ courseId: currentCourseId, name, empNo, email });
    // 평문 메일은 즉시 입력창에서 제거
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

window.deleteAttendanceStudent = async function(docId, name) {
  if (!currentCourseId) return;
  if (!confirm(`${name} 학생을 출결 명단에서 삭제할까요?\n출결 기록은 그대로 보존됩니다.`)) return;

  try {
    await deleteDoc(doc(db, 'courses', currentCourseId, 'attendance_students', docId));
    await loadAttendanceStudents();
  } catch(e) {
    alert('삭제 실패: ' + e.message);
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

// ── 시작 ──────────────────────────────
// 인증/UI 전환은 onAuthStateChanged 가 처리함
