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
// 사무실 윈도우 엣지 등 WebSocket 차단/프록시 환경에서 빈 결과·장시간 대기가 발생해
// long-polling 을 강제. auto-detect 는 첫 쿼리에서 5~10초 probe 지연을 일으키고,
// 일부 사내망에서는 그마저 실패해서 결과가 비는 경우가 있어 강제 모드가 안정적.
export const db = initializeFirestore(app, { experimentalForceLongPolling: true });
export const auth = getAuth(app);
