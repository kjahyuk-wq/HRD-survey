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
// 행정망 사내 프록시(엣지) 환경에서 /Listen/channel 이 400 Bad Request 로 거절되며
// 빈 결과·장시간 대기가 발생하는 패턴 대응:
//  - experimentalForceLongPolling: streaming 차단 우회 (HTTP long-poll)
//  - useFetchStreams=false: Fetch 스트림만 검사하는 프록시 우회 (XHR 사용)
//  - longPolling timeoutSeconds 25: 프록시가 30초 무응답 연결을 끊기 전에 클라가
//    먼저 재요청해서 stale connection 회피
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  experimentalLongPollingOptions: { timeoutSeconds: 25 },
});
export const auth = getAuth(app);
