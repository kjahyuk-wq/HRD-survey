import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAw1nRzHaV318mm6vhueWt19PAkVHyMkrw",
  authDomain: "hrd-data.firebaseapp.com",
  projectId: "hrd-data",
  storageBucket: "hrd-data.firebasestorage.app",
  messagingSenderId: "233199711039",
  appId: "1:233199711039:web:8f1cb4d26f4ac9306dd98a"
};

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
