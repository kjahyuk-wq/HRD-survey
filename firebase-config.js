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
// 사무실 윈도우 엣지 등 사내 프록시가 Firestore streaming 응답을 변조하는 환경 대응:
//  - experimentalForceLongPolling: WebSocket/streaming 차단 우회 (HTTP long-poll 사용)
//  - useFetchStreams=false: Fetch API 대신 XHR 사용 (fetch stream 만 차단하는 프록시 우회)
//  - longPolling timeoutSeconds 25: 기본 30초이지만, 일부 프록시가 30초 무응답 연결을
//    끊기 전에 클라가 먼저 재요청하도록 약간 짧게.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  experimentalLongPollingOptions: { timeoutSeconds: 25 },
});
export const auth = getAuth(app);
