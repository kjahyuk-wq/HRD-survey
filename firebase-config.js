import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyAw1nRzHaV318mm6vhueWt19PAkVHyMkrw",
  authDomain: "hrd-data.firebaseapp.com",
  projectId: "hrd-data",
  storageBucket: "hrd-data.firebasestorage.app",
  messagingSenderId: "233199711039",
  appId: "1:233199711039:web:8f1cb4d26f4ac9306dd98a"
};

// 🔑 reCAPTCHA v3 사이트 키 (App Check 용) — attendance 와 동일 키 (같은 Firebase 프로젝트)
//    비밀 키는 Firebase 콘솔의 App Check 페이지에 별도 등록되어 있음
const RECAPTCHA_SITE_KEY = '6LfLR-IsAAAAAKpDG_I_gohdgxWDb3265RmblLb3';

const app = initializeApp(firebaseConfig);

// 사내 행정망 등 WebChannel 스트림이 차단되는 환경에서만 long-polling 강제.
// 일반 인터넷 사용자는 SDK 의 자동 감지가 더 빠르므로 기본은 autoDetect.
// 사용법: 사내 PC 에서 한 번 ?proxy=1 로 열어두면 localStorage 에 박혀 이후에도 유지.
//        해제는 ?proxy=0.
try {
  const qp = new URLSearchParams(location.search);
  if (qp.get('proxy') === '1') localStorage.setItem('proxyMode', '1');
  else if (qp.get('proxy') === '0') localStorage.removeItem('proxyMode');
} catch (_) {}
const FORCE_LONG_POLL = (() => {
  try { return localStorage.getItem('proxyMode') === '1'; } catch (_) { return false; }
})();

export const db = initializeFirestore(
  app,
  FORCE_LONG_POLL
    ? {
        experimentalForceLongPolling: true,
        useFetchStreams: false,
        experimentalLongPollingOptions: { timeoutSeconds: 25 },
      }
    : { experimentalAutoDetectLongPolling: true }
);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'asia-northeast3');

// App Check — 운영에서만 활성화 (localhost / 사내 IP 는 제외)
const host = location.hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
if (!isLocal && RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    console.info('[firebase] App Check 활성화');
  } catch (e) {
    console.warn('[firebase] App Check 초기화 실패', e);
  }
}
