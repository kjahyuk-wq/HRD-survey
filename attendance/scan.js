import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, addDoc,
  collection, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// ── 상태 ──────────────────────────────
let isProcessing = false;
let wakeLock = null;

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
let cameraList = [];
let isStarting = false;
const CAMERA_PREF_KEY = 'attendance:cameraFacing';

function getSavedFacing() {
  const v = localStorage.getItem(CAMERA_PREF_KEY);
  return v === 'environment' ? 'environment' : 'user';
}

function pickCameraId(facing) {
  if (!cameraList.length) return null;
  const wantBack = facing === 'environment';
  const labelMatch = cameraList.find(c => {
    const l = (c.label || '').toLowerCase();
    return wantBack
      ? /back|rear|environment|후면|뒷/.test(l)
      : /front|user|face|전면|앞/.test(l);
  });
  if (labelMatch) return labelMatch.id;
  // 라벨로 못 찾으면: 후면=마지막, 전면=첫 번째 (대부분 기기 관례)
  return wantBack ? cameraList[cameraList.length - 1].id : cameraList[0].id;
}

async function startScanner(facing) {
  if (isStarting) return;
  isStarting = true;
  try {
    if (!html5Qr) html5Qr = new Html5Qrcode('qr-reader');
    try { if (html5Qr.isScanning) await html5Qr.stop(); } catch (_) {}

    if (!cameraList.length) {
      try { cameraList = await Html5Qrcode.getCameras(); } catch (_) {}
    }

    const cameraId = pickCameraId(facing);
    const source = cameraId ? cameraId : { facingMode: facing };

    await html5Qr.start(
      source,
      { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 },
      onScanSuccess,
      () => {}
    );
    localStorage.setItem(CAMERA_PREF_KEY, facing);
    updateCameraSwitchUI(facing);
  } catch (err) {
    console.error('카메라 시작 오류:', err);
    showResult('error', '❌', '카메라를 시작할 수 없습니다', String(err?.message || err));
  } finally {
    isStarting = false;
  }
}

function updateCameraSwitchUI(facing) {
  document.querySelectorAll('.camera-switch button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.facing === facing);
  });
}

function initCameraSwitch() {
  document.querySelectorAll('.camera-switch button').forEach(btn => {
    btn.addEventListener('click', () => startScanner(btn.dataset.facing));
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

// ── 시작 ──────────────────────────────
// 카메라 전환 핸들러는 인증과 무관하게 즉시 부착
initCameraSwitch();
startScanner(getSavedFacing());
requestWakeLock();

signInAnonymously(auth).catch(e => {
  console.error('익명 로그인 실패:', e);
});
