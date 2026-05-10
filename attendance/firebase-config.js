import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyAw1nRzHaV318mm6vhueWt19PAkVHyMkrw",
  authDomain: "hrd-data.firebaseapp.com",
  projectId: "hrd-data",
  storageBucket: "hrd-data.firebasestorage.app",
  messagingSenderId: "233199711039",
  appId: "1:233199711039:web:8f1cb4d26f4ac9306dd98a"
};

// 🔑 reCAPTCHA Enterprise 사이트 키 — Firebase 콘솔 > App Check 에서 발급 후 입력
//    (활성화 전엔 빈 문자열로 둠 → 운영에서도 App Check 초기화 스킵)
const RECAPTCHA_SITE_KEY = '';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
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
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    console.info('[firebase] App Check 활성화');
  } catch (e) {
    console.warn('[firebase] App Check 초기화 실패', e);
  }
}
