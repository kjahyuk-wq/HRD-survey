import { db, auth, functions } from './firebase-config.js';
import {
  collection, query, where, getDocs,
  doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import {
  signInWithCustomToken, signOut, setPersistence, browserLocalPersistence, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";
import { escapeHtml, toDateStr, formatDisplayDate, formatTime, getBuiltinHolidays } from './utils.js';

// 72시간 세션 유지 (단기과정 3일치). LOCAL 영속 + 자체 만료 체크.
setPersistence(auth, browserLocalPersistence).catch(() => {});
const SESSION_MAX_AGE_MS = 72 * 60 * 60 * 1000;

const loginByEmail = httpsCallable(functions, 'loginByEmail');
const loginByEmpNo = httpsCallable(functions, 'loginByEmpNo');

// 두 로그인 화면 토글
window.showEmailLogin = function() {
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-error-empno').style.display = 'none';
  showScreen('screen-login');
};
window.showEmpNoLogin = function() {
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-error-empno').style.display = 'none';
  showScreen('screen-login-empno');
};

// ── 상태 ──────────────────────────────
let currentUser = null;   // { name, empNo, courseId, courseName, config }
let countdownTimer = null;
const QR_TTL_SEC = 300;   // 5분

// ── 초기화 ──────────────────────────────
const today = toDateStr(new Date());
document.getElementById('today-date').textContent = formatDisplayDate(today);

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

function showEmpNoError(msg) {
  const el = document.getElementById('login-error-empno');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── 세션 캐시 키 ──
const SESSION_NAME_KEY = 'att_login_name';
const SESSION_CANDS_KEY = 'att_login_candidates';
const SESSION_TS_KEY = 'att_login_ts';

function clearSessionCache() {
  localStorage.removeItem(SESSION_NAME_KEY);
  localStorage.removeItem(SESSION_CANDS_KEY);
  localStorage.removeItem(SESSION_TS_KEY);
}

// onAuthStateChanged ↔ doLogin 동시 진행 방지 플래그
let autoResumed = false;

// ── 로그인 ──────────────────────────────
window.doLogin = async function() {
  const name = document.getElementById('input-name').value.trim();
  const email = document.getElementById('input-email').value.trim().toLowerCase();

  if (!name) { document.getElementById('input-name').focus(); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showLoginError('메일 주소를 올바르게 입력해 주세요.');
    return;
  }

  document.getElementById('login-error').style.display = 'none';
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = '확인 중...';

  try {
    const result = await loginByEmail({ name, email });
    const { customToken, candidates: rawCandidates } = result.data || {};

    if (!customToken) {
      showLoginError('서버 응답이 올바르지 않습니다. 담당자에게 문의해 주세요.');
      return;
    }

    // 인증 변경 후 onAuthStateChanged 가 동시에 자동 진행하지 않도록 미리 잠금
    autoResumed = true;
    await signInWithCustomToken(auth, customToken);

    // 메일은 절대 캐싱하지 않음. 이름/후보/타임스탬프만 저장 (72시간 자동 진행용)
    localStorage.setItem(SESSION_NAME_KEY, name);
    localStorage.setItem(SESSION_CANDS_KEY, JSON.stringify(rawCandidates || []));
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()));

    await proceedWithCandidates(name, rawCandidates || []);
  } catch (e) {
    console.error(e);
    const code = e?.code || '';
    if (code === 'functions/not-found') {
      showLoginError('등록된 수강생 정보를 찾을 수 없습니다.\n이름과 메일을 확인하거나 담당자에게 문의해 주세요.');
    } else if (code === 'functions/resource-exhausted') {
      showLoginError('잠시 후 다시 시도해 주세요. (요청 한도 초과)');
    } else if (code === 'functions/invalid-argument') {
      showLoginError(e.message || '입력값이 올바르지 않습니다.');
    } else {
      showLoginError('서버 연결에 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  } finally {
    btn.disabled = false; btn.textContent = '확인하기';
  }
};

// ── 이름+교번 로그인 (공무직 등 메일 없는 학생) ─────
window.doLoginEmpNo = async function() {
  const name = document.getElementById('input-name-empno').value.trim();
  const empNo = document.getElementById('input-empno').value.trim();

  if (!name) { document.getElementById('input-name-empno').focus(); return; }
  if (!empNo) {
    showEmpNoError('교번을 입력해 주세요.');
    return;
  }

  document.getElementById('login-error-empno').style.display = 'none';
  const btn = document.getElementById('login-btn-empno');
  btn.disabled = true; btn.textContent = '확인 중...';

  try {
    const result = await loginByEmpNo({ name, empNo });
    const { customToken, candidates: rawCandidates } = result.data || {};

    if (!customToken) {
      showEmpNoError('서버 응답이 올바르지 않습니다. 담당자에게 문의해 주세요.');
      return;
    }

    autoResumed = true;
    await signInWithCustomToken(auth, customToken);

    localStorage.setItem(SESSION_NAME_KEY, name);
    localStorage.setItem(SESSION_CANDS_KEY, JSON.stringify(rawCandidates || []));
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()));

    await proceedWithCandidates(name, rawCandidates || []);
  } catch (e) {
    console.error(e);
    const code = e?.code || '';
    if (code === 'functions/not-found') {
      showEmpNoError('등록된 수강생 정보를 찾을 수 없습니다.\n이름과 교번을 확인하거나 담당자에게 문의해 주세요.');
    } else if (code === 'functions/failed-precondition') {
      showEmpNoError(e.message || '로그인할 수 있는 과정이 없습니다.');
    } else if (code === 'functions/resource-exhausted') {
      showEmpNoError('잠시 후 다시 시도해 주세요. (요청 한도 초과)');
    } else if (code === 'functions/invalid-argument') {
      showEmpNoError(e.message || '입력값이 올바르지 않습니다.');
    } else {
      showEmpNoError('서버 연결에 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  } finally {
    btn.disabled = false; btn.textContent = '확인하기';
  }
};

// 후보 → 오늘 수업일 필터 → 단일/다수 화면 분기
async function proceedWithCandidates(name, rawCandidates) {
  const candidates = [];
  for (const c of rawCandidates) {
    const configRef = doc(db, 'courses', c.courseId, 'attendanceConfig', 'config');
    const configSnap = await getDoc(configRef);
    if (!configSnap.exists()) continue;

    const config = configSnap.data();
    if (!(config.scheduleDates || []).includes(today)) continue;

    const courseDocSnap = await getDoc(doc(db, 'courses', c.courseId));
    candidates.push({
      courseId: c.courseId,
      courseName: courseDocSnap.data()?.name || c.courseId,
      config,
      studentDocId: c.studentDocId,
      empNo: c.empNo,
    });
  }

  if (!candidates.length) {
    showScreen('screen-no-class');
    document.getElementById('no-class-title').textContent = '오늘은 수업 일정이 없습니다';
    document.getElementById('no-class-desc').textContent = '오늘은 등록된 교육 일정이 아닙니다.';
    return;
  }

  if (candidates.length === 1) {
    await proceedWithCourse(name, candidates[0]);
  } else {
    showCoursePicker(name, candidates);
  }
}

// ── 과정 선택 ──────────────────────────────
function showCoursePicker(name, candidates) {
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
}

window.pickCourse = async function(idx) {
  await proceedWithCourse(window._pendingName, window._candidates[idx]);
};

function getDailySessionLabel(config) {
  if (config.dailySessions === 2) {
    return `하루 2회 출석 (오전 ${config.morningStart}~${config.morningEnd} / 오후 ${config.afternoonStart}~${config.afternoonEnd})`;
  }
  return '하루 1회 출석';
}

// ── 과정 결정 후 처리 ──────────────────────────────
async function proceedWithCourse(name, candidate) {
  const { courseId, courseName, config, empNo } = candidate;

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

  // 휴강일 체크 (excludedHolidays에 등록된 날짜는 휴강에서 제외 — 수업 진행)
  const excluded = new Set(config.excludedHolidays || []);
  const allHolidays = [
    ...(config.customHolidays || []),
    ...getBuiltinHolidays(new Date().getFullYear())
  ].filter(d => !excluded.has(d));
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
    studentId: auth.currentUser?.uid || null,  // 식별 인증 uid (firestore.rules 검증용)
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

// 엔터키 지원
document.getElementById('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('input-email').focus(); });
document.getElementById('input-email').addEventListener('keydown', e => { if (e.key === 'Enter') window.doLogin(); });
document.getElementById('input-name-empno').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('input-empno').focus(); });
document.getElementById('input-empno').addEventListener('keydown', e => { if (e.key === 'Enter') window.doLoginEmpNo(); });

// 72시간 세션이 살아 있으면 메일/교번 재입력 없이 자동 진행
onAuthStateChanged(auth, async (user) => {
  if (!user || user.isAnonymous || autoResumed) return;
  try {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.claims?.role !== 'student') return;

    const cachedName = localStorage.getItem(SESSION_NAME_KEY);
    const cachedCandsRaw = localStorage.getItem(SESSION_CANDS_KEY);
    const cachedTs = parseInt(localStorage.getItem(SESSION_TS_KEY) || '0', 10);
    if (!cachedName || !cachedCandsRaw) return;

    // 72시간 만료 체크
    if (!cachedTs || Date.now() - cachedTs > SESSION_MAX_AGE_MS) {
      clearSessionCache();
      try { await signOut(auth); } catch(_) {}
      return;
    }

    const cachedCands = JSON.parse(cachedCandsRaw);
    if (!Array.isArray(cachedCands) || !cachedCands.length) return;

    autoResumed = true;
    document.getElementById('input-name').value = cachedName;
    await proceedWithCandidates(cachedName, cachedCands);
  } catch (e) {
    console.warn('자동 진행 실패', e);
  }
});
