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
// 사무실/키오스크 등 사내 프록시 환경 대응 (HRD-survey 본체와 동일 정책).
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  experimentalLongPollingOptions: { timeoutSeconds: 25 },
});
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
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    console.info('[firebase] App Check 활성화');
  } catch (e) {
    console.warn('[firebase] App Check 초기화 실패', e);
  }
}
