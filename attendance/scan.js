import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, updateDoc, addDoc,
  collection, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { toDateStr, formatDisplayDate } from './utils.js';

// ── 키오스크 전용 Firebase app (main app 의 admin 인증과 격리) ─────
const firebaseConfig = {
  apiKey: "AIzaSyAw1nRzHaV318mm6vhueWt19PAkVHyMkrw",
  authDomain: "hrd-data.firebaseapp.com",
  projectId: "hrd-data",
  storageBucket: "hrd-data.firebasestorage.app",
  messagingSenderId: "233199711039",
  appId: "1:233199711039:web:8f1cb4d26f4ac9306dd98a"
};
const scanApp = initializeApp(firebaseConfig, 'scan-kiosk');
const db = getFirestore(scanApp);
const auth = getAuth(scanApp);

// 관리자 페이지 — 탭/브라우저 닫히면 자동 로그아웃 (공용 디바이스 보안)
setPersistence(auth, browserSessionPersistence).catch(() => {});

// ── 관리자 인증 게이트 ──────────────────────────────
const ADMIN_EMAIL = 'kjahyuk@korea.kr';
let scanInitialized = false;

window.scanLogin = async function() {
  const pwEl = document.getElementById('scan-admin-pw');
  const errEl = document.getElementById('scan-login-err');
  const btn = document.getElementById('scan-login-btn');
  const pw = pwEl.value;
  if (!pw) return;
  btn.disabled = true; btn.textContent = '확인 중...';
  errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pw);
  } catch(e) {
    errEl.textContent = '비밀번호가 올바르지 않습니다.';
    pwEl.value = '';
    btn.disabled = false; btn.textContent = '로그인';
  }
};

document.getElementById('scan-admin-pw')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') window.scanLogin();
});

onAuthStateChanged(auth, (user) => {
  const isAdmin = !!(user && user.email);
  document.getElementById('scan-auth-screen').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('scan-main').style.display = isAdmin ? '' : 'none';
  if (isAdmin && !scanInitialized) {
    scanInitialized = true;
    initScanner();
  }
});

function initScanner() {
  initCameraSwitch();
  startScanner(getSavedFacing());
  requestWakeLock();
}

// ── 상태 ──────────────────────────────
const LATE_GRACE_MIN = 15;   // 세션 시작 + 15분까지는 정상 출석, 초과 시 지각
const PROCESS_LOCK_MS = 1500; // 결과 표시 후 다음 스캔 허용까지 (success/warning 공통)
const PROCESS_WATCHDOG_MS = 10000; // Firestore hang 등 비정상 상황 안전 해제
let isProcessing = false;
let processWatchdog = null;
let wakeLock = null;

// isProcessing 해제 헬퍼 — setTimeout 누락/hang 대비 워치독 동시 관리
function lockProcessing() {
  isProcessing = true;
  clearTimeout(processWatchdog);
  processWatchdog = setTimeout(() => { isProcessing = false; }, PROCESS_WATCHDOG_MS);
}
function unlockProcessing(delayMs = 0) {
  clearTimeout(processWatchdog);
  if (delayMs > 0) {
    setTimeout(() => { isProcessing = false; }, delayMs);
  } else {
    isProcessing = false;
  }
}

const today = toDateStr(new Date());
document.getElementById('scan-date-label').textContent = formatDisplayDate(today);

// ── 현재 시각 표시 ──────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('scan-time-label').textContent = now.toTimeString().slice(0, 8);
}
updateClock();
setInterval(updateClock, 1000);

// ── 사운드 (스캔 결과 비프음) ──────────────────────────────
let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}
// iOS는 사용자 제스처가 있어야 오디오 잠금 해제됨 — 첫 탭에서 unlock
document.addEventListener('touchstart', unlockAudio, { passive: true });
document.addEventListener('click', unlockAudio);
function unlockAudio() {
  const ctx = ensureAudio();
  if (ctx?.state === 'suspended') ctx.resume();
}

function playTone(freq, duration = 0.18, type = 'sine', gainPeak = 0.25) {
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(gainPeak, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.02);
}
function playSuccess() {
  // 상승하는 두 음 — 짧고 명확하게
  playTone(880, 0.12);
  setTimeout(() => playTone(1320, 0.18), 90);
}
function playError() {
  playTone(220, 0.35, 'square', 0.18);
}

// ── Wake Lock ──────────────────────────────
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
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
      {
        fps: 15,  // 10 → 15: 같은 시간에 더 많은 프레임을 디코드 시도 (인식률 향상)
        qrbox: (vw, vh) => {
          const m = Math.floor(Math.min(vw, vh) * 0.85);
          return { width: m, height: m };
        },
        aspectRatio: 1.0,
        // 지원 브라우저(Chrome/Edge 등)에서 네이티브 BarcodeDetector 사용 — ZXing JS 보다
        // 훨씬 빠르고 인식률 높음. 미지원 브라우저는 자동으로 기본 디코더 폴백.
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      },
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
  lockProcessing();

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    showResult('error', '❌', '잘못된 QR 코드입니다', '인식할 수 없는 형식입니다.');
    unlockProcessing(PROCESS_LOCK_MS);
    return;
  }

  const { t: tokenId, e: empNo, s: session, d: date } = payload;

  if (!tokenId || !empNo || !session || !date) {
    showResult('error', '❌', '등록되지 않은 QR입니다', '필수 정보가 누락된 QR 코드입니다.');
    unlockProcessing(PROCESS_LOCK_MS);
    return;
  }

  // 날짜 확인
  if (date !== today) {
    showResult('error', '❌', '날짜가 맞지 않는 QR입니다', `이 QR은 ${date}용입니다.`);
    unlockProcessing(PROCESS_LOCK_MS);
    return;
  }

  try {
    const tokenRef = doc(db, 'qr_tokens', tokenId);
    const tokenSnap = await getDoc(tokenRef);

    if (!tokenSnap.exists()) {
      showResult('error', '❌', '등록되지 않은 QR입니다', 'Firestore에서 토큰을 찾을 수 없습니다.');
      unlockProcessing(PROCESS_LOCK_MS);
      return;
    }

    const token = tokenSnap.data();

    // 만료 확인
    const expiresAt = token.expiresAt instanceof Timestamp
      ? token.expiresAt.toMillis()
      : new Date(token.expiresAt).getTime();

    if (Date.now() > expiresAt) {
      showResult('warning', '⏱', '유효시간이 초과된 QR입니다', '교육생에게 QR을 다시 발급받도록 안내해 주세요.');
      unlockProcessing(PROCESS_LOCK_MS);
      return;
    }

    // 이미 처리됨 확인
    if (token.used) {
      showResult('warning', '⚠️', '이미 출석 처리된 교육생입니다', `${token.name}님 (교번: ${token.empNo})`);
      unlockProcessing(PROCESS_LOCK_MS);
      return;
    }

    // 세션 불일치 (정보성 경고만 - 엄격하게 차단하려면 아래 return 활성화)
    const currentSession = getCurrentSessionKey();
    if (session !== 'single' && currentSession !== session) {
      const sessionLabel = session === 'morning' ? '오전' : '오후';
      showResult('warning', '⚠️', `${sessionLabel} 출석 시간이 아닙니다`, `이 QR은 ${sessionLabel} 출석용입니다.`);
      unlockProcessing(PROCESS_LOCK_MS);
      return;
    }

    // 출석 처리
    const { name, courseId, courseName, studentId } = token;

    // 지각 판정 (세션 시작 + 15분 초과 시 'late')
    const sessionStart = token.sessionStart || (session === 'afternoon' ? '13:00' : '09:00');
    const [ssH, ssM] = sessionStart.split(':').map(Number);
    const cutoffMin = ssH * 60 + ssM + LATE_GRACE_MIN;
    const nowDate = new Date();
    const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
    const status = nowMin > cutoffMin ? 'late' : 'present';

    // 토큰 사용 처리
    await updateDoc(tokenRef, { used: true, usedAt: serverTimestamp() });

    // 출석 기록 저장 (studentId = 학생 식별 인증 uid, 감사용)
    await addDoc(collection(db, 'courses', courseId, 'attendance'), {
      studentId: studentId || null,
      empNo, name, date: today, session, status,
      checkedAt: serverTimestamp(),
      tokenId
    });

    const sessionLabel = { single: '', morning: ' (오전)', afternoon: ' (오후)' }[session] || '';
    const statusBadge = status === 'late' ? ' · 지각' : '';
    showResult('success', '✅', `${name}님 출석 완료${sessionLabel}${statusBadge}`, `교번: ${empNo} | ${courseName}`);

    unlockProcessing(PROCESS_LOCK_MS);

  } catch (e) {
    console.error('처리 오류:', e);
    showResult('error', '❌', '처리 중 오류가 발생했습니다', String(e?.message || e));
    unlockProcessing(PROCESS_LOCK_MS);
  }
}

function getCurrentSessionKey() {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur < 13 * 60 ? 'morning' : 'afternoon';
}

// ── 결과 표시 ──────────────────────────────
let resultHideTimer = null;
function showResult(type, icon, text, sub) {
  const el = document.getElementById('scan-result');
  el.className = `scan-result show ${type}`;
  document.getElementById('result-icon').textContent = icon;
  document.getElementById('result-text').textContent = text;
  document.getElementById('result-sub').textContent = sub;

  clearTimeout(resultHideTimer);
  const hideMs = type === 'success' ? 3000 : 4000;
  if (type === 'success') playSuccess(); else playError();
  resultHideTimer = setTimeout(() => {
    el.classList.remove('show');
  }, hideMs);
}

// 스캐너 초기화는 onAuthStateChanged 콜백에서 실행됨 (인증 통과 후)
