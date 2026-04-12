import { db, auth } from './firebase-config.js';
import {
  collectionGroup, collection, query, where, getDocs,
  doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// ── 상태 ──────────────────────────────
let currentUser = null;   // { name, empNo, courseId, courseName, config }
let countdownTimer = null;
const QR_TTL_SEC = 300;   // 5분

// ── 초기화 ──────────────────────────────
const today = toDateStr(new Date());
document.getElementById('today-date').textContent = formatDisplayDate(today);


function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}
function formatDisplayDate(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
}
function formatTime(ts) {
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  return d.toTimeString().slice(0, 5);
}

// ── 화면 전환 ──────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── 로그인 ──────────────────────────────
window.doLogin = async function() {
  const name = document.getElementById('input-name').value.trim();
  const empNo = document.getElementById('input-empno').value.trim();

  if (!name) { document.getElementById('input-name').focus(); return; }
  if (!/^\d+$/.test(empNo) || parseInt(empNo) < 1) {
    showLoginError('교번을 올바르게 입력해 주세요. (1 이상의 숫자)');
    return;
  }

  document.getElementById('login-error').style.display = 'none';
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = '확인 중...';

  try {
    if (!auth.currentUser) await signInAnonymously(auth);

    // 모든 과정에서 해당 교번+이름 학생 검색
    const q = query(collectionGroup(db, 'students'), where('empNo', '==', empNo));
    const snap = await getDocs(q);
    const matches = snap.docs.filter(d => d.data().name === name);

    if (!matches.length) {
      showLoginError('등록된 수강생 정보를 찾을 수 없습니다.\n이름과 교번을 확인하거나 담당자에게 문의해 주세요.');
      return;
    }

    // 각 과정의 attendanceConfig 가져오기
    const candidates = [];
    for (const docSnap of matches) {
      const courseId = docSnap.ref.parent.parent.id;
      const configRef = doc(db, 'courses', courseId, 'attendanceConfig', 'config');
      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) continue;

      const config = configSnap.data();
      const schedDates = config.scheduleDates || [];
      // 오늘이 교육 일정에 포함된 과정만
      if (schedDates.includes(today)) {
        const courseDocSnap = await getDoc(docSnap.ref.parent.parent);
        candidates.push({
          courseId,
          courseName: courseDocSnap.data()?.name || courseId,
          config,
          studentDocId: docSnap.id
        });
      }
    }

    // 일정에 포함된 과정이 없으면 → 비수업일
    if (!candidates.length) {
      // 설정 자체가 없는 경우도 포함
      showScreen('screen-no-class');
      document.getElementById('no-class-title').textContent = '오늘은 수업 일정이 없습니다';
      document.getElementById('no-class-desc').textContent = '오늘은 등록된 교육 일정이 아닙니다.';
      return;
    }

    if (candidates.length === 1) {
      await proceedWithCourse(name, empNo, candidates[0]);
    } else {
      // 여러 과정 선택 화면
      showCoursePicker(name, empNo, candidates);
    }

  } catch (e) {
    console.error(e);
    showLoginError('서버 연결에 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    btn.disabled = false; btn.textContent = '확인하기';
  }
};

// ── 과정 선택 ──────────────────────────────
function showCoursePicker(name, empNo, candidates) {
  showScreen('screen-course-pick');
  const list = document.getElementById('course-picker-list');
  list.innerHTML = candidates.map((c, i) => `
    <div class="course-item" onclick="pickCourse(${i})">
      <div class="c-name">📚 ${escapeHtml(c.courseName)}</div>
      <div class="c-dates">${getDailySessionLabel(c.config)}</div>
    </div>
  `).join('');
  window._candidates = candidates;
  window._pendingName = name;
  window._pendingEmpNo = empNo;
}

window.pickCourse = async function(idx) {
  await proceedWithCourse(window._pendingName, window._pendingEmpNo, window._candidates[idx]);
};

function getDailySessionLabel(config) {
  if (config.dailySessions === 2) {
    return `하루 2회 출석 (오전 ${config.morningStart}~${config.morningEnd} / 오후 ${config.afternoonStart}~${config.afternoonEnd})`;
  }
  return '하루 1회 출석';
}

// ── 과정 결정 후 처리 ──────────────────────────────
async function proceedWithCourse(name, empNo, candidate) {
  const { courseId, courseName, config } = candidate;

  // ── 기기 잠금 확인 (과정별) ──────────────────────────────
  const deviceLockKey = `device_locked_${courseId}_${today}`;
  const existingLock = localStorage.getItem(deviceLockKey);
  if (existingLock) {
    try {
      const locked = JSON.parse(existingLock);
      if (locked.empNo !== empNo) {
        // 관리자 초기화 여부 확인 (courses/{courseId}/attendanceConfig/reset_{empNo}_{today})
        const resetRef = doc(db, 'courses', courseId, 'attendanceConfig', `reset_${empNo}_${today}`);
        const resetSnap = await getDoc(resetRef);
        if (resetSnap.exists()) {
          localStorage.removeItem(deviceLockKey);
          await deleteDoc(resetRef);
          // 초기화됨 → 계속 진행
        } else {
          showScreen('screen-login');
          showLoginError(`이 기기는 오늘 이미 ${locked.name} 님의 출석에 사용되었습니다.\n본인 기기를 사용하거나 담당자에게 문의해 주세요.`);
          return;
        }
      }
    } catch(e) {
      localStorage.removeItem(deviceLockKey);
    }
  }

  // 휴강일 체크
  const allHolidays = [
    ...(config.customHolidays || []),
    ...getBuiltinHolidays(new Date().getFullYear())
  ];
  if (allHolidays.includes(today)) {
    showScreen('screen-no-class');
    document.getElementById('no-class-title').textContent = '오늘은 휴강일입니다';
    document.getElementById('no-class-desc').textContent = '법정 공휴일 또는 관리자 지정 휴강일입니다.';
    return;
  }

  currentUser = { name, empNo, courseId, courseName, config };

  // 현재 회차 결정
  const session = getCurrentSession(config);
  if (!session) {
    showScreen('screen-no-session');
    document.getElementById('no-session-desc').textContent =
      config.dailySessions === 2
        ? `오전 출석: ${config.morningStart} ~ ${config.morningEnd}\n오후 출석: ${config.afternoonStart} ~ ${config.afternoonEnd}`
        : '출석 가능 시간을 담당자에게 문의해 주세요.';
    return;
  }

  // 이미 출석 처리됐는지 확인
  const attSnap = await getDocs(query(
    collection(db, 'courses', courseId, 'attendance'),
    where('empNo', '==', empNo),
    where('date', '==', today),
    where('session', '==', session)
  ));

  if (!attSnap.empty) {
    showScreen('screen-already');
    const rec = attSnap.docs[0].data();
    const sessionLabel = sessionName(session);
    const checkedTime = rec.checkedAt ? formatTime(rec.checkedAt) : '';
    document.getElementById('already-desc').textContent =
      `${sessionLabel} 출석이 이미 처리되었습니다.${checkedTime ? ` (${checkedTime})` : ''}`;
    return;
  }

  // 기존 유효 QR 토큰 확인 (localStorage)
  const cacheKey = `qr_token_${empNo}_${today}_${session}`;
  const cachedTokenId = localStorage.getItem(cacheKey);

  if (cachedTokenId) {
    const tokenSnap = await getDoc(doc(db, 'qr_tokens', cachedTokenId));
    if (tokenSnap.exists()) {
      const token = tokenSnap.data();
      const now = Date.now();
      const expiresAt = token.expiresAt instanceof Timestamp
        ? token.expiresAt.toMillis()
        : new Date(token.expiresAt).getTime();
      if (!token.used && expiresAt > now) {
        // 기존 QR 재표시
        showQrScreen(name, empNo, session, cachedTokenId, expiresAt);
        return;
      }
    }
    localStorage.removeItem(cacheKey);
  }

  // 새 QR 토큰 발급
  await issueNewQr(name, empNo, courseId, courseName, session, cacheKey);
}

// ── 세션 판단 ──────────────────────────────
function getCurrentSession(config) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();

  if (config.dailySessions === 1) return 'single';

  const [afH, afM] = (config.afternoonStart || '13:00').split(':').map(Number);
  const afternoonMin = afH * 60 + afM;
  return cur < afternoonMin ? 'morning' : 'afternoon';
}

function sessionName(session) {
  return { single: '출석', morning: '오전 출석', afternoon: '오후 출석' }[session] || '출석';
}

// ── UUID 생성 (HTTP 환경 호환) ──────────────────────────────
function generateUUID() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  arr[6] = (arr[6] & 0x0f) | 0x40;
  arr[8] = (arr[8] & 0x3f) | 0x80;
  return [...arr].map((b, i) =>
    ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0')
  ).join('');
}

// ── QR 발급 ──────────────────────────────
async function issueNewQr(name, empNo, courseId, courseName, session, cacheKey) {
  const tokenId = generateUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QR_TTL_SEC * 1000);

  const tokenData = {
    empNo, name, courseId, courseName,
    date: today, session,
    issuedAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(expiresAt),
    used: false
  };

  await setDoc(doc(db, 'qr_tokens', tokenId), tokenData);
  localStorage.setItem(cacheKey, tokenId);

  // 기기 잠금 저장 (과정+날짜 기준, 다른 교육생 로그인 방지)
  localStorage.setItem(`device_locked_${courseId}_${today}`, JSON.stringify({ empNo, name }));

  showQrScreen(name, empNo, session, tokenId, expiresAt.getTime());
}

window.reissueQr = async function() {
  if (!currentUser) return;
  const { name, empNo, courseId, courseName, config } = currentUser;
  const session = getCurrentSession(config);
  const cacheKey = `qr_token_${empNo}_${today}_${session}`;
  localStorage.removeItem(cacheKey);
  clearTimer();
  await issueNewQr(name, empNo, courseId, courseName, session, cacheKey);
};

// ── QR 화면 표시 ──────────────────────────────
function showQrScreen(name, empNo, session, tokenId, expiresAtMs) {
  showScreen('screen-qr');

  // QR 내용
  const qrPayload = JSON.stringify({ t: tokenId, e: empNo, s: session, d: today });

  // QR 생성 (qrious)
  new QRious({
    element: document.getElementById('qr-canvas'),
    value: qrPayload,
    size: 280,
    foreground: '#0a0a0a',
    background: '#ffffff',
    level: 'M'
  });

  document.getElementById('expired-overlay').style.display = 'none';

  // 이름 + 세션 배지
  document.getElementById('qr-student-name').textContent = `${name} 님`;
  const badge = document.getElementById('qr-session-badge');
  const badgeInfo = {
    single: ['단일 출석', 'badge-single'],
    morning: ['오전 출석', 'badge-morning'],
    afternoon: ['오후 출석', 'badge-afternoon']
  }[session] || ['출석', 'badge-single'];
  badge.textContent = badgeInfo[0];
  badge.className = `qr-session-badge ${badgeInfo[1]}`;

  // 카운트다운
  clearTimer();
  const cdEl = document.getElementById('countdown');
  function tick() {
    const left = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
    const m = Math.floor(left / 60);
    const s = left % 60;
    cdEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    cdEl.classList.toggle('urgent', left <= 60);

    if (left <= 0) {
      clearTimer();
      document.getElementById('expired-overlay').style.display = 'flex';
    }
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function clearTimer() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

// ── 법정 공휴일 (고정일 기준) ──────────────────────────────
function getBuiltinHolidays(year) {
  const y = String(year);
  const fixed = [
    `${y}-01-01`, // 신정
    `${y}-03-01`, // 삼일절
    `${y}-05-05`, // 어린이날
    `${y}-06-06`, // 현충일
    `${y}-08-15`, // 광복절
    `${y}-10-03`, // 개천절
    `${y}-10-09`, // 한글날
    `${y}-12-25`, // 성탄절
  ];
  // 음력 공휴일: 관리자 직접 customHolidays에 추가 권장
  // 아래는 2025~2026 추정치 (실제 달력으로 확인 필요)
  const lunar = {
    2025: ['2025-01-28','2025-01-29','2025-01-30','2025-05-05','2025-10-05','2025-10-06','2025-10-07'],
    2026: ['2026-02-16','2026-02-17','2026-02-18','2026-05-24','2026-10-05','2026-10-06','2026-10-07'],
  };
  return [...fixed, ...(lunar[year] || [])];
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// 엔터키 지원
document.getElementById('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('input-empno').focus(); });
document.getElementById('input-empno').addEventListener('keydown', e => { if (e.key === 'Enter') window.doLogin(); });
