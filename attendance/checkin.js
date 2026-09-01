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

// 최대 2주 세션 유지. 그 안에 관리자가 과정 비활성하면 다음 자동 진행 시 서버에서 차단.
setPersistence(auth, browserLocalPersistence).catch(() => {});
const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const loginByEmpNo = httpsCallable(functions, 'loginByEmpNo');

// ── 상태 ──────────────────────────────
let currentUser = null;   // { name, empNo, courseId, courseName, config }
let countdownTimer = null;
const QR_TTL_SEC = 600;   // 10분

// ── 초기화 ──────────────────────────────
const today = toDateStr(new Date());
document.getElementById('today-date').textContent = formatDisplayDate(today);

// ── 화면 전환 ──────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // 옵티미스틱 인라인 렌더에서 띄운 카운트다운/상태 정리 (있다면 인계)
  if (window.__optTimer) { clearInterval(window.__optTimer); window.__optTimer = null; }
  window.__optimisticState = null;
  // 로그인 화면 외에선 로그아웃 버튼 표시
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.style.display = id === 'screen-login-empno' ? 'none' : 'inline-block';
  }
}

// ── 로그아웃 ──────────────────────────────
window.doLogout = async function() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  clearSessionCache();
  clearSnapshot();
  try { await signOut(auth); } catch(_) {}
  ['input-name-empno', 'input-empno'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  autoResumed = false;
  currentUser = null;
  showScreen('screen-login-empno');
};

function showEmpNoError(msg) {
  const el = document.getElementById('login-error-empno');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── 세션 캐시 키 ──
const SESSION_NAME_KEY = 'att_login_name';
const SESSION_CANDS_KEY = 'att_login_candidates';
const SESSION_TS_KEY = 'att_login_ts';

// ── 옵티미스틱 즉시 렌더용 스냅샷 ──
// checkin.html 의 인라인 스크립트가 이 키를 읽어 첫 페인트에 QR/이미출석 화면을 그린다.
// 이 모듈은 화면 전환마다 최신 상태를 여기에 기록한다.
const SNAPSHOT_KEY = 'att_last_state_v1';

function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== 1) return null;
    return s;
  } catch (_) { return null; }
}

function writeSnapshot(patch) {
  try {
    const base = readSnapshot() || {};
    const next = Object.assign({}, base, patch, { v: 1 });
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
  } catch (_) {}
}

function clearSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch (_) {}
}

// 인라인 스크립트가 필요로 하는 최소 필드만 (스냅샷 크기 / 민감정보 최소화)
function pickConfigForSnapshot(config) {
  if (!config) return null;
  return {
    dailySessions: config.dailySessions,
    morningStart: config.morningStart,
    morningEnd: config.morningEnd,
    afternoonStart: config.afternoonStart,
    afternoonEnd: config.afternoonEnd,
  };
}

function clearSessionCache() {
  localStorage.removeItem(SESSION_NAME_KEY);
  localStorage.removeItem(SESSION_CANDS_KEY);
  localStorage.removeItem(SESSION_TS_KEY);
}

// onAuthStateChanged ↔ doLogin 동시 진행 방지 플래그
let autoResumed = false;

// ── 이름+교번 로그인 (유일한 로그인 수단) ─────
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
  const btnLabel = document.getElementById('login-btn-label');
  btn.disabled = true; btnLabel.textContent = '확인 중...';

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
    btn.disabled = false; btnLabel.textContent = '확인하기';
  }
};

// 후보 → 오늘 수업일 필터 → 단일/다수 화면 분기
async function proceedWithCandidates(name, rawCandidates) {
  // 후보별로 attendanceConfig + course 문서를 병렬 조회.
  // 모바일 환경에서 round-trip 누적이 자동 로그인 체감 지연의 주범이라
  // 후보 수와 무관하게 한 번의 latency 안에 끝나도록 묶는다.
  const settled = await Promise.all(rawCandidates.map(async (c) => {
    const [configSnap, courseSnap] = await Promise.all([
      getDoc(doc(db, 'courses', c.courseId, 'attendanceConfig', 'config')),
      getDoc(doc(db, 'courses', c.courseId)),
    ]);
    if (!configSnap.exists()) return null;
    const config = configSnap.data();
    if (!(config.scheduleDates || []).includes(today)) return null;
    return {
      courseId: c.courseId,
      courseName: courseSnap.data()?.name || c.courseId,
      config,
      studentDocId: c.studentDocId,
      empNo: c.empNo,
    };
  }));
  const candidates = settled.filter(Boolean);

  if (!candidates.length) {
    showScreen('screen-no-class');
    document.getElementById('no-class-title').textContent = `${name}님, 오늘은 수업 일정이 없습니다`;
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
      <div class="c-name"><svg class="icn" style="color:var(--dj-blue);"><use href="#i-course"/></svg> ${escapeHtml(c.courseName)}</div>
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
          showScreen('screen-login-empno');
          showEmpNoError(`이 기기는 오늘 이미 ${locked.name} 님의 출석에 사용되었습니다.\n본인 기기를 사용하거나 담당자에게 문의해 주세요.`);
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
    document.getElementById('no-class-title').textContent = `${name}님, 오늘은 휴강일입니다`;
    document.getElementById('no-class-desc').textContent = '법정 공휴일 또는 관리자 지정 휴강일입니다.';
    return;
  }

  currentUser = { name, empNo, courseId, courseName, config };

  // 현재 회차 결정
  const session = getCurrentSession(config);
  if (!session) {
    showScreen('screen-no-session');
    document.querySelector('#screen-no-session .status-title').textContent = `${name}님, 현재 출석 시간이 아닙니다`;
    document.getElementById('no-session-desc').textContent =
      config.dailySessions === 2
        ? `오전 출석: ${config.morningStart} ~ ${config.morningEnd}\n오후 출석: ${config.afternoonStart} ~ ${config.afternoonEnd}`
        : '출석 가능 시간을 담당자에게 문의해 주세요.';
    return;
  }

  // 이미 출석 처리됐는지 확인 — studentId(uid) 기반.
  // (empNo 기반이면 같은 empNo 로 메일만 다른 다른 학생을 같은 출석으로 인식하는 버그 + 학생 삭제 후
  //  재등록 시 stale attendance 기록이 따라오는 문제가 있었음. uid 는 학생 정체성 단위.)
  const myUid = auth.currentUser?.uid;
  let attSnap;
  if (myUid) {
    attSnap = await getDocs(query(
      collection(db, 'courses', courseId, 'attendance'),
      where('studentId', '==', myUid),
      where('date', '==', today),
      where('session', '==', session)
    ));
  } else {
    // 인증 안 된 비정상 흐름 fallback (정상 흐름에선 발생 안 함)
    attSnap = await getDocs(query(
      collection(db, 'courses', courseId, 'attendance'),
      where('empNo', '==', empNo),
      where('date', '==', today),
      where('session', '==', session)
    ));
  }

  if (!attSnap.empty) {
    showScreen('screen-already');
    const rec = attSnap.docs[0].data();
    const sessionLabel = sessionName(session);
    const checkedTime = rec.checkedAt ? formatTime(rec.checkedAt) : '';
    document.querySelector('#screen-already .status-title').textContent = `${name}님, 이미 출석 처리되었습니다`;
    document.getElementById('already-desc').textContent =
      `${sessionLabel} 출석이 이미 처리되었습니다.${checkedTime ? ` (${checkedTime})` : ''}`;

    // 다음 진입 시 옵티미스틱 첫 페인트에 '이미 출석' 화면을 바로 그리기 위한 스냅샷
    const checkedAtMs = rec.checkedAt?.toMillis ? rec.checkedAt.toMillis() : Date.now();
    writeSnapshot({
      name, empNo, courseId, courseName, date: today,
      config: pickConfigForSnapshot(config),
      lastAttended: { session, checkedAtMs },
    });
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
        // 옵티미스틱 즉시 렌더용 스냅샷 갱신 (다음 진입 시 첫 페인트에 같은 QR)
        writeSnapshot({
          name, empNo, courseId, courseName, date: today,
          config: pickConfigForSnapshot(config),
          lastQr: { session, tokenId: cachedTokenId, expiresAtMs: expiresAt },
        });
        return;
      }
    }
    localStorage.removeItem(cacheKey);
  }

  // 새 QR 토큰 발급
  await issueNewQr(name, empNo, courseId, courseName, session, cacheKey, config);
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
async function issueNewQr(name, empNo, courseId, courseName, session, cacheKey, config) {
  const tokenId = generateUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QR_TTL_SEC * 1000);

  const sessionStart = session === 'afternoon'
    ? (config?.afternoonStart || '13:00')
    : (config?.morningStart || '09:00');

  const tokenData = {
    studentId: auth.currentUser?.uid || null,  // 식별 인증 uid (firestore.rules 검증용)
    empNo, name, courseId, courseName,
    date: today, session,
    sessionStart,  // 지각 판정용 (스캔 시각이 sessionStart + 15분 초과 시 'late')
    issuedAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(expiresAt),
    used: false
  };

  await setDoc(doc(db, 'qr_tokens', tokenId), tokenData);
  localStorage.setItem(cacheKey, tokenId);

  // 기기 잠금 저장 (과정+날짜 기준, 다른 교육생 로그인 방지)
  localStorage.setItem(`device_locked_${courseId}_${today}`, JSON.stringify({ empNo, name }));

  // 옵티미스틱 즉시 렌더용 스냅샷 — 다음 진입 시 첫 페인트에 이 QR 이 바로 그려진다
  writeSnapshot({
    name, empNo, courseId, courseName, date: today,
    config: pickConfigForSnapshot(config),
    lastQr: { session, tokenId, expiresAtMs: expiresAt.getTime() },
  });

  showQrScreen(name, empNo, session, tokenId, expiresAt.getTime());
}

window.reissueQr = async function() {
  // 옵티미스틱 QR 이 10분 만료 후 백그라운드 검증이 끝나기 전에 버튼이 눌리는 드문 케이스를 위한 fallback.
  // 정상 흐름에서는 proceedWithCourse 가 이미 currentUser 를 채운 상태.
  let cu = currentUser;
  if (!cu) {
    const snap = readSnapshot();
    if (snap?.name && snap.empNo && snap.courseId && snap.config) {
      cu = {
        name: snap.name, empNo: snap.empNo,
        courseId: snap.courseId, courseName: snap.courseName,
        config: snap.config,
      };
    }
  }
  if (!cu) return;
  const { name, empNo, courseId, courseName, config } = cu;
  const session = getCurrentSession(config);
  const cacheKey = `qr_token_${empNo}_${today}_${session}`;
  localStorage.removeItem(cacheKey);
  clearTimer();
  await issueNewQr(name, empNo, courseId, courseName, session, cacheKey, config);
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
document.getElementById('input-name-empno').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('input-empno').focus(); });
document.getElementById('input-empno').addEventListener('keydown', e => { if (e.key === 'Enter') window.doLoginEmpNo(); });

// 옵티미스틱 스피너(자동 로그인 중) 상태에서 자동 진행이 불가능한 것으로
// 판명되면 로그인 폼으로 폴백 — 무한 스피너 방지
function fallbackFromResuming() {
  const r = document.getElementById('screen-resuming');
  if (r && r.classList.contains('active')) showScreen('screen-login-empno');
}

// 세션이 살아 있으면 교번 재입력 없이 자동 진행
onAuthStateChanged(auth, async (user) => {
  if (autoResumed) return;
  if (!user || user.isAnonymous) { fallbackFromResuming(); return; }
  try {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.claims?.role !== 'student') { fallbackFromResuming(); return; }

    const cachedName = localStorage.getItem(SESSION_NAME_KEY);
    const cachedCandsRaw = localStorage.getItem(SESSION_CANDS_KEY);
    const cachedTs = parseInt(localStorage.getItem(SESSION_TS_KEY) || '0', 10);
    if (!cachedName || !cachedCandsRaw) { fallbackFromResuming(); return; }

    // 세션 만료 체크
    if (!cachedTs || Date.now() - cachedTs > SESSION_MAX_AGE_MS) {
      clearSessionCache();
      try { await signOut(auth); } catch(_) {}
      fallbackFromResuming();
      return;
    }

    const cachedCands = JSON.parse(cachedCandsRaw);
    if (!Array.isArray(cachedCands) || !cachedCands.length) { fallbackFromResuming(); return; }

    // 로그인 폼이 이미 보이고 사용자가 입력을 시작했다면 화면을 뺏지 않는다
    // (자동 진행이 타이핑 중간에 화면을 전환해 버리는 문제 방지)
    const loginScreen = document.getElementById('screen-login-empno');
    const nameEl = document.getElementById('input-name-empno');
    const empEl = document.getElementById('input-empno');
    if (loginScreen.classList.contains('active') &&
        ((nameEl && nameEl.value.trim()) || (empEl && empEl.value.trim()))) {
      return;
    }

    autoResumed = true;
    if (nameEl) nameEl.value = cachedName;
    await proceedWithCandidates(cachedName, cachedCands);
  } catch (e) {
    console.warn('자동 진행 실패', e);
    fallbackFromResuming();
  }
});
