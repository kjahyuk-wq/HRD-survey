import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, addDoc,
  collection, query, where, getDocs,
  collectionGroup, serverTimestamp, Timestamp, onSnapshot, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// ── 상태 ──────────────────────────────
let isProcessing = false;
let wakeLock = null;
let todayAttendance = []; // 오늘 출석 목록 (실시간)

const today = toDateStr(new Date());
document.getElementById('scan-date-label').textContent = formatDisplayDate(today);

// ── 시간 유틸 ──────────────────────────────
function toDateStr(d) { return d.toISOString().slice(0, 10); }
function formatDisplayDate(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
}
function formatTime(ts) {
  const d = ts instanceof Timestamp ? ts.toDate() : (ts?.toDate ? ts.toDate() : new Date(ts));
  return d.toTimeString().slice(0, 5);
}

// ── 현재 시각 표시 ──────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('scan-time-label').textContent = now.toTimeString().slice(0, 8);
}
updateClock();
setInterval(updateClock, 1000);

// ── 현재 세션 표시 (정보성) ──────────────────────────────
function updateSessionDisplay() {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  let label;
  if (cur < 13 * 60) {
    label = '오전 세션';
  } else {
    label = '오후 세션';
  }
  document.getElementById('current-session-display').textContent = label;
}
updateSessionDisplay();
setInterval(updateSessionDisplay, 60000);

// ── Wake Lock ──────────────────────────────
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    const el = document.getElementById('wake-status');
    el.textContent = '화면 켜짐 유지 중';
    el.classList.add('active');
    wakeLock.addEventListener('release', () => {
      el.textContent = '화면 켜짐 유지 해제됨';
      el.classList.remove('active');
    });
  } catch (e) {
    console.warn('WakeLock 사용 불가:', e.message);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

// ── QR 스캐너 초기화 ──────────────────────────────
let html5Qr = null;
const CAMERA_PREF_KEY = 'attendance:cameraFacing';

function getSavedFacing() {
  const v = localStorage.getItem(CAMERA_PREF_KEY);
  return v === 'environment' ? 'environment' : 'user';
}

async function startScanner(facingMode) {
  if (!html5Qr) html5Qr = new Html5Qrcode('qr-reader');
  try {
    if (html5Qr.isScanning) await html5Qr.stop();
  } catch (_) {}
  try {
    await html5Qr.start(
      { facingMode },
      { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 },
      onScanSuccess,
      () => {} // 에러 무시 (스캔 시도 중 계속 발생)
    );
    localStorage.setItem(CAMERA_PREF_KEY, facingMode);
    updateCameraSwitchUI(facingMode);
  } catch (err) {
    console.error('카메라 시작 오류:', err);
    showResult('error', '❌', '카메라를 시작할 수 없습니다', '권한이나 카메라 사용 가능 여부를 확인해 주세요.');
  }
}

function updateCameraSwitchUI(facingMode) {
  document.querySelectorAll('.camera-switch button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.facing === facingMode);
  });
}

function initCameraSwitch() {
  document.querySelectorAll('.camera-switch button').forEach(btn => {
    btn.addEventListener('click', () => {
      const facing = btn.dataset.facing;
      if (facing === getSavedFacing() && html5Qr?.isScanning) return;
      startScanner(facing);
    });
  });
}

// ── QR 스캔 성공 처리 ──────────────────────────────
async function onScanSuccess(rawText) {
  if (isProcessing) return;
  isProcessing = true;

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    showResult('error', '❌', '잘못된 QR 코드입니다', '인식할 수 없는 형식입니다.');
    setTimeout(() => { isProcessing = false; }, 2000);
    return;
  }

  const { t: tokenId, e: empNo, s: session, d: date } = payload;

  if (!tokenId || !empNo || !session || !date) {
    showResult('error', '❌', '등록되지 않은 QR입니다', '필수 정보가 누락된 QR 코드입니다.');
    setTimeout(() => { isProcessing = false; }, 2000);
    return;
  }

  // 날짜 확인
  if (date !== today) {
    showResult('error', '❌', '날짜가 맞지 않는 QR입니다', `이 QR은 ${date}용입니다.`);
    setTimeout(() => { isProcessing = false; }, 3000);
    return;
  }

  try {
    const tokenRef = doc(db, 'qr_tokens', tokenId);
    const tokenSnap = await getDoc(tokenRef);

    if (!tokenSnap.exists()) {
      showResult('error', '❌', '등록되지 않은 QR입니다', 'Firestore에서 토큰을 찾을 수 없습니다.');
      setTimeout(() => { isProcessing = false; }, 3000);
      return;
    }

    const token = tokenSnap.data();

    // 만료 확인
    const expiresAt = token.expiresAt instanceof Timestamp
      ? token.expiresAt.toMillis()
      : new Date(token.expiresAt).getTime();

    if (Date.now() > expiresAt) {
      showResult('warning', '⏱', '유효시간이 초과된 QR입니다', '교육생에게 QR을 다시 발급받도록 안내해 주세요.');
      setTimeout(() => { isProcessing = false; }, 3000);
      return;
    }

    // 이미 처리됨 확인
    if (token.used) {
      showResult('warning', '⚠️', '이미 출석 처리된 교육생입니다', `${token.name}님 (교번: ${token.empNo})`);
      setTimeout(() => { isProcessing = false; }, 3000);
      return;
    }

    // 세션 불일치 (정보성 경고만 - 엄격하게 차단하려면 아래 return 활성화)
    const currentSession = getCurrentSessionKey();
    if (session !== 'single' && currentSession !== session) {
      const sessionLabel = session === 'morning' ? '오전' : '오후';
      showResult('warning', '⚠️', `${sessionLabel} 출석 시간이 아닙니다`, `이 QR은 ${sessionLabel} 출석용입니다.`);
      setTimeout(() => { isProcessing = false; }, 3000);
      return;
    }

    // 출석 처리
    const { name, courseId, courseName } = token;

    // 토큰 사용 처리
    await updateDoc(tokenRef, { used: true, usedAt: serverTimestamp() });

    // 출석 기록 저장
    await addDoc(collection(db, 'courses', courseId, 'attendance'), {
      empNo, name, date: today, session,
      checkedAt: serverTimestamp(),
      tokenId
    });

    const sessionLabel = { single: '', morning: ' (오전)', afternoon: ' (오후)' }[session] || '';
    showResult('success', '✅', `${name}님 출석 완료${sessionLabel}`, `교번: ${empNo} | ${courseName}`);

    setTimeout(() => { isProcessing = false; }, 3000);

  } catch (e) {
    console.error('처리 오류:', e);
    showResult('error', '❌', '처리 중 오류가 발생했습니다', String(e?.message || e));
    setTimeout(() => { isProcessing = false; }, 3000);
  }
}

function getCurrentSessionKey() {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur < 13 * 60 ? 'morning' : 'afternoon';
}

// ── 결과 표시 ──────────────────────────────
function showResult(type, icon, text, sub) {
  const el = document.getElementById('scan-result');
  el.className = `scan-result ${type}`;
  document.getElementById('result-icon').textContent = icon;
  document.getElementById('result-text').textContent = text;
  document.getElementById('result-sub').textContent = sub;
  el.style.display = 'block';

  // 성공 시 3초 후 자동 숨김
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  } else {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

// ── 오늘 출석자 실시간 감시 ──────────────────────────────
function subscribeToTodayAttendance() {
  // collectionGroup으로 모든 과정의 오늘 출석 기록 구독
  const q = query(
    collectionGroup(db, 'attendance'),
    where('date', '==', today)
  );

  onSnapshot(q, snap => {
    todayAttendance = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    todayAttendance.sort((a, b) => {
      const ta = a.checkedAt instanceof Timestamp ? a.checkedAt.toMillis() : 0;
      const tb = b.checkedAt instanceof Timestamp ? b.checkedAt.toMillis() : 0;
      return tb - ta; // 최신순
    });
    renderAttList();
    updateCounts();
  }, err => {
    console.warn('출석 목록 구독 오류:', err);
  });
}

function renderAttList() {
  const wrap = document.getElementById('att-list-wrap');
  document.getElementById('att-list-count').textContent = `${todayAttendance.length}명`;

  if (!todayAttendance.length) {
    wrap.innerHTML = '<div class="loading">아직 출석자가 없습니다.</div>';
    return;
  }

  wrap.innerHTML = todayAttendance.slice(0, 50).map(a => {
    const sessionBadge = {
      single: '<span class="att-badge" style="background:#dbeafe;color:#1d4ed8;">출석</span>',
      morning: '<span class="att-badge" style="background:#fef3c7;color:#92400e;">오전</span>',
      afternoon: '<span class="att-badge" style="background:#ede9fe;color:#6d28d9;">오후</span>',
    }[a.session] || '';
    const time = a.checkedAt ? formatTime(a.checkedAt) : '-';
    return `
      <div class="att-list-item">
        <div>
          <span style="font-weight:600;">${escapeHtml(a.name)}</span>
          <span class="att-empno"> · ${escapeHtml(a.empNo)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.4rem;">
          ${sessionBadge}
          <span class="att-time">${time}</span>
        </div>
      </div>`;
  }).join('');
}

function updateCounts() {
  const total = todayAttendance.length;
  const morning = todayAttendance.filter(a => a.session === 'morning').length;
  const afternoon = todayAttendance.filter(a => a.session === 'afternoon').length;
  document.getElementById('count-total').textContent = total;
  document.getElementById('count-morning').textContent = morning;
  document.getElementById('count-afternoon').textContent = afternoon;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── 시작 ──────────────────────────────
signInAnonymously(auth).then(() => {
  requestWakeLock();
  initCameraSwitch();
  startScanner(getSavedFacing());
  subscribeToTodayAttendance();
}).catch(e => {
  console.error('익명 로그인 실패:', e);
});
