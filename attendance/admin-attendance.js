import { db, auth } from './firebase-config.js';
import {
  collection, collectionGroup, query, where, getDocs, getDoc,
  doc, setDoc, addDoc, deleteDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// ── 상태 ──────────────────────────────
let currentCourseId = null;
let currentConfig = null;
let allStudents = [];
let allAttendance = [];
let scheduleDates = [];
let customHolidays = [];
let dailySessions = 1;

// ── 관리자 인증 (로컬 테스트용 간이 인증) ──────────────────────────────
const ADMIN_PW = 'admin';

window.adminLogin = async function() {
  const pw = document.getElementById('admin-pw').value;
  if (pw !== ADMIN_PW) {
    document.getElementById('login-err').textContent = '암호가 올바르지 않습니다.';
    document.getElementById('login-err').style.display = 'block';
    return;
  }
  if (!auth.currentUser) await signInAnonymously(auth);
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadCourses();
};

window.adminLogout = function() {
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('admin-pw').value = '';
};

document.getElementById('admin-pw').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.adminLogin();
});

// ── 탭 전환 ──────────────────────────────
window.switchTab = function(tab) {
  ['config', 'records'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['config','records'][i] === tab);
  });
  if (tab === 'records') loadAttendanceRecords();
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

      selectSessions(dailySessions, true);
      document.getElementById('morning-start').value = cfg.morningStart || '09:00';
      document.getElementById('morning-end').value = cfg.morningEnd || '12:00';
      document.getElementById('afternoon-start').value = cfg.afternoonStart || '13:00';
      document.getElementById('afternoon-end').value = cfg.afternoonEnd || '18:00';
    } else {
      currentConfig = null;
      scheduleDates = [];
      customHolidays = [];
      selectSessions(1, true);
    }
    renderDateTags();
    renderHolidayTags();
  } catch(e) {
    console.error('설정 로드 오류:', e);
  }
}

// ── 학생 목록 로드 ──────────────────────────────
async function loadStudents() {
  if (!currentCourseId) return;
  try {
    const snap = await getDocs(collection(db, 'courses', currentCourseId, 'students'));
    allStudents = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
  } catch(e) {
    console.error('학생 로드 오류:', e);
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
    `<span class="date-tag date-tag-schedule">${formatDate(d)}<button onclick="removeScheduleDate('${d}')">✕</button></span>`
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
    `<span class="date-tag date-tag-holiday">${formatDate(d)}<button onclick="removeHolidayDate('${d}')">✕</button></span>`
  ).join('');
}

function formatDate(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth()+1}/${d.getDate()}`;
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

// ── 설정 저장 ──────────────────────────────
window.saveConfig = async function() {
  if (!currentCourseId) { alert('과정을 먼저 선택해 주세요.'); return; }

  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = '저장 중...';
  const status = document.getElementById('save-status');
  status.style.display = 'none';

  const config = {
    dailySessions,
    morningStart: document.getElementById('morning-start').value || '09:00',
    morningEnd: document.getElementById('morning-end').value || '12:00',
    afternoonStart: document.getElementById('afternoon-start').value || '13:00',
    afternoonEnd: document.getElementById('afternoon-end').value || '18:00',
    scheduleDates: [...scheduleDates].sort(),
    customHolidays: [...customHolidays].sort(),
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
async function loadAttendanceRecords() {
  if (!currentCourseId) return;

  const tbody = document.getElementById('att-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="loading">불러오는 중...</td></tr>';

  try {
    const snap = await getDocs(collection(db, 'courses', currentCourseId, 'attendance'));
    allAttendance = snap.docs.map(d => ({ ...d.data(), _id: d.id }));

    // 날짜 필터 옵션 구성
    const dates = [...new Set(allAttendance.map(a => a.date))].sort();
    const dateFilter = document.getElementById('filter-date');
    dateFilter.innerHTML = '<option value="">날짜 전체</option>' +
      dates.map(d => `<option value="${d}">${formatFullDate(d)}</option>`).join('');

    applyFilter();
    updateSummary();
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#dc2626;">불러오기 실패: ${e.message}</td></tr>`;
  }
}

window.applyFilter = function() {
  const dateVal = document.getElementById('filter-date').value;
  const sessionVal = document.getElementById('filter-session').value;

  let filtered = [...allAttendance];
  if (dateVal) filtered = filtered.filter(a => a.date === dateVal);
  if (sessionVal) filtered = filtered.filter(a => a.session === sessionVal);

  renderTable(filtered, dateVal, sessionVal);
  updateSummary(filtered);
};

function renderTable(records, dateFilter, sessionFilter) {
  const tbody = document.getElementById('att-tbody');

  // 미출석자 계산
  const absentRows = buildAbsentRows(records, dateFilter, sessionFilter);

  // 출석 행 + 미출석 행 합산
  const presentRows = records.map(a => {
    const sessionLabel = { single: '단일', morning: '오전', afternoon: '오후' }[a.session] || a.session;
    const checkedTime = a.checkedAt ? formatTime(a.checkedAt) : '-';
    return `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.empNo)}</td>
        <td>${formatFullDate(a.date)}</td>
        <td><span class="status-chip chip-${a.session === 'morning' ? 'present' : 'present'}">${sessionLabel}</span></td>
        <td>${checkedTime}</td>
        <td><span class="status-chip chip-present">출석</span></td>
      </tr>`;
  });

  const absentHtml = absentRows.map(a => `
    <tr class="absent-row">
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.empNo)}</td>
      <td>${formatFullDate(a.date)}</td>
      <td>${a.sessionLabel}</td>
      <td>-</td>
      <td><span class="status-chip chip-absent">미출석</span></td>
    </tr>`);

  if (!presentRows.length && !absentHtml.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">출석 기록이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = [...presentRows, ...absentHtml].join('');
}

function buildAbsentRows(records, dateFilter, sessionFilter) {
  if (!currentConfig || !allStudents.length) return [];

  // 비교 대상 날짜+세션 목록
  const targetDates = dateFilter ? [dateFilter] : scheduleDates;
  const allHolidays = [
    ...(customHolidays),
    ...getBuiltinHolidays(new Date().getFullYear()),
    ...getBuiltinHolidays(new Date().getFullYear() + 1),
  ];

  const rows = [];
  for (const date of targetDates) {
    if (allHolidays.includes(date)) continue;
    const sessions = dailySessions === 2
      ? (sessionFilter ? [sessionFilter] : ['morning', 'afternoon'])
      : ['single'];

    for (const sess of sessions) {
      if (sessionFilter && sess !== sessionFilter) continue;
      const attended = new Set(records.filter(a => a.date === date && a.session === sess).map(a => a.empNo));
      const sessionLabel = { single: '단일', morning: '오전', afternoon: '오후' }[sess] || sess;

      for (const stu of allStudents) {
        if (!attended.has(stu.empNo)) {
          rows.push({ name: stu.name, empNo: stu.empNo, date, sessionLabel });
        }
      }
    }
  }
  return rows;
}

function updateSummary(records) {
  const summary = document.getElementById('rate-summary');
  summary.style.display = 'flex';

  const dateFilter = document.getElementById('filter-date').value;
  const sessionFilter = document.getElementById('filter-session').value;
  const absentRows = buildAbsentRows(records || allAttendance, dateFilter, sessionFilter);

  const present = (records || allAttendance).length;
  const absent = absentRows.length;
  const total = present + absent;
  const pct = total > 0 ? Math.round((present / total) * 100) : 0;

  document.getElementById('rate-total').textContent = total;
  document.getElementById('rate-present').textContent = present;
  document.getElementById('rate-absent').textContent = absent;
  document.getElementById('rate-pct').textContent = `${pct}%`;
}

// ── 엑셀 다운로드 ──────────────────────────────
window.exportExcel = function() {
  if (!allAttendance.length) { alert('다운로드할 출석 데이터가 없습니다.'); return; }

  const dateFilter = document.getElementById('filter-date').value;
  const sessionFilter = document.getElementById('filter-session').value;

  let records = [...allAttendance];
  if (dateFilter) records = records.filter(a => a.date === dateFilter);
  if (sessionFilter) records = records.filter(a => a.session === sessionFilter);

  const absentRows = buildAbsentRows(records, dateFilter, sessionFilter);

  const wsData = [
    ['이름', '교번', '날짜', '회차', '출석시각', '상태'],
    ...records.map(a => [
      a.name, a.empNo, a.date,
      { single:'단일', morning:'오전', afternoon:'오후' }[a.session] || a.session,
      a.checkedAt instanceof Timestamp ? a.checkedAt.toDate().toLocaleString('ko-KR') : '-',
      '출석'
    ]),
    ...absentRows.map(a => [a.name, a.empNo, a.date, a.sessionLabel, '-', '미출석'])
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '출석현황');

  const courseName = document.getElementById('course-select').options[document.getElementById('course-select').selectedIndex]?.text || 'course';
  XLSX.writeFile(wb, `출석현황_${courseName}_${new Date().toISOString().slice(0,10)}.xlsx`);
};

// ── 테스트 데이터 시드 ──────────────────────────────
window.seedTestData = async function() {
  const status = document.getElementById('seed-status');
  status.textContent = '생성 중...';

  try {
    // 테스트 과정 생성
    const courseRef = await addDoc(collection(db, 'courses'), { name: '[테스트] QR출결 샘플과정' });
    const courseId = courseRef.id;

    // 테스트 학생 5명 생성
    const students = [
      { name: '홍길동', empNo: '1001' },
      { name: '김철수', empNo: '1002' },
      { name: '이영희', empNo: '1003' },
      { name: '박민준', empNo: '1004' },
      { name: '최지수', empNo: '1005' },
    ];
    for (const s of students) {
      await addDoc(collection(db, 'courses', courseId, 'students'), { ...s, completed: false, completedAt: null });
    }

    // 오늘 포함 3일 출석 설정
    const today = new Date();
    const days = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
    }

    await setDoc(doc(db, 'courses', courseId, 'attendanceConfig', 'config'), {
      dailySessions: 2,
      morningStart: '09:00', morningEnd: '12:00',
      afternoonStart: '13:00', afternoonEnd: '18:00',
      scheduleDates: days,
      customHolidays: [],
      updatedAt: serverTimestamp()
    });

    status.textContent = `✅ 완료! (과정ID: ${courseId.slice(0,8)}...) 과정 목록을 새로고침하세요.`;
    await loadCourses();
  } catch(e) {
    status.textContent = '실패: ' + e.message;
  }
};

// ── 유틸 ──────────────────────────────
function formatFullDate(s) {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(ts) {
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  return d.toTimeString().slice(0, 5);
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getBuiltinHolidays(year) {
  const y = String(year);
  const fixed = [
    `${y}-01-01`, `${y}-03-01`, `${y}-05-05`,
    `${y}-06-06`, `${y}-08-15`, `${y}-10-03`,
    `${y}-10-09`, `${y}-12-25`,
  ];
  const lunar = {
    2025: ['2025-01-28','2025-01-29','2025-01-30','2025-05-05','2025-10-05','2025-10-06','2025-10-07'],
    2026: ['2026-02-16','2026-02-17','2026-02-18','2026-05-24','2026-10-05','2026-10-06','2026-10-07'],
  };
  return [...fixed, ...(lunar[year] || [])];
}

// ── 시작 ──────────────────────────────
// Firebase 익명 인증 (실제 Firebase 접근용)
signInAnonymously(auth).catch(e => console.error('익명 인증 실패:', e));
