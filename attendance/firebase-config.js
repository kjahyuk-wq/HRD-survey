import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { initializeFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyAw1nRzHaV318mm6vhueWt19PAkVHyMkrw",
  authDomain: "hrd-data.firebaseapp.com",
  projectId: "hrd-data",
  storageBucket: "hrd-data.firebasestorage.app",
  messagingSenderId: "233199711039",
  appId: "1:233199711039:web:8f1cb4d26f4ac9306dd98a"
};

// 🔑 reCAPTCHA v3 사이트 키 (App Check 용)
//    비밀 키는 Firebase 콘솔의 App Check 페이지에 별도 등록되어 있음
const RECAPTCHA_SITE_KEY = '6LfLR-IsAAAAAKpDG_I_gohdgxWDb3265RmblLb3';

const app = initializeApp(firebaseConfig);

// 사내 행정망/키오스크 등 WebChannel 스트림이 차단되는 환경에서만 long-polling 강제.
// 일반망(외부 인터넷)은 SDK 자동 감지가 더 빠름.
// 사용법: 해당 PC 에서 한 번 ?proxy=1 로 열어두면 localStorage 에 박혀 이후에도 유지.
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

const host = location.hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');

if (isLocal) {
  // 로컬 에뮬레이터 모드
  try {
    connectFirestoreEmulator(db, host, 8080);
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFunctionsEmulator(functions, host, 5001);
    console.info('[firebase] 에뮬레이터 모드');
  } catch (e) {
    console.warn('[firebase] 에뮬레이터 연결 실패 — 운영 인스턴스 사용', e);
  }
} else if (RECAPTCHA_SITE_KEY) {
  // 운영: App Check 활성화 (Cloud Function 호출의 어뷰징 방어)
  try {
    // 행정망 모드(?proxy=1)에서는 www.google.com/recaptcha 가 차단되어 reCAPTCHA 토큰을
    // 영영 못 받고, Auth 요청이 30초 대기 후 auth/network-request-failed 로 실패한다.
    // → 디버그 토큰 방식으로 전환. 콘솔에 찍히는 토큰을 Firebase 콘솔 > App Check >
    //   앱 > "디버그 토큰 관리" 에 한 번 등록하면 그 PC/브라우저에서 계속 유효.
    //   (루트 만족도 사이트와 같은 웹 앱·같은 origin 이라 토큰 등록은 한 번이면 됨)
    if (FORCE_LONG_POLL) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      console.info('[firebase] App Check 디버그 토큰 모드 (행정망). 아래 "App Check debug token" 을 Firebase 콘솔에 등록하세요.');
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    console.info('[firebase] App Check 활성화' + (FORCE_LONG_POLL ? ' (디버그 토큰)' : ''));
  } catch (e) {
    console.warn('[firebase] App Check 초기화 실패', e);
  }
}
