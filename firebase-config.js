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
// 사내 프록시가 Firestore streaming을 끊는 환경(행정망 등)에서만 long-polling으로 폴백.
// 일반 망에서는 기본 streaming을 그대로 써서 빠른 응답을 유지한다.
//  - experimentalAutoDetectLongPolling: SDK가 환경을 보고 필요할 때만 long-poll로 전환
//  - longPolling timeoutSeconds 25: 일부 프록시가 30초 무응답 연결을 끊기 전에
//    클라가 먼저 재요청하도록 약간 짧게.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  experimentalLongPollingOptions: { timeoutSeconds: 25 },
});
export const auth = getAuth(app);
