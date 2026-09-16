import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword, signOut,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// Firebase Console > Authentication > Users 에 이 이메일로 계정을 생성하세요
const ADMIN_EMAIL = 'kjahyuk@korea.kr';

// 관리자 세션은 탭이 닫히면 로그아웃되도록 SESSION persistence 사용
// (기본 LOCAL은 LocalStorage 영속이라 공용 PC에서 자동 로그인 위험)
// 호출 시 현재 세션도 sessionStorage로 복사됨 → 적용 후 탭 닫으면 즉시 효과
setPersistence(auth, browserSessionPersistence).catch(() => {});

export async function checkLogin() {
  const pw = document.getElementById('pw-input').value;
  if (!pw) return;

  const btn = document.querySelector('.login-box button');
  const errEl = document.getElementById('pw-error');
  btn.disabled = true;
  btn.textContent = '확인 중...';
  errEl.style.display = 'none';

  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pw);
    // onAuthStateChanged가 UI 전환을 처리함
  } catch (e) {
    // 행정망 등에서 네트워크/App Check 실패가 "비밀번호 오류"로 보이지 않도록 원인별 안내
    console.error('[admin-auth] 로그인 실패:', e && e.code, e && e.message);
    errEl.textContent = loginErrorMessage(e);
    errEl.style.display = 'block';
    document.getElementById('pw-input').value = '';
    btn.disabled = false;
    btn.textContent = '로그인';
  }
}

function loginErrorMessage(e) {
  const code = (e && e.code) || '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return '비밀번호가 올바르지 않습니다.';
    case 'auth/too-many-requests':
      return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
    case 'auth/network-request-failed':
      return '인증 서버에 연결할 수 없습니다. 행정망 등 네트워크 차단 여부를 확인하세요. (' + code + ')';
    case 'auth/firebase-app-check-token-is-invalid':
    case 'auth/missing-app-check-token':
      return '보안 검증(App Check)에 실패했습니다. 이 PC에서 reCAPTCHA 접근이 차단됐을 수 있습니다. (' + code + ')';
    case 'auth/user-disabled':
      return '비활성화된 관리자 계정입니다.';
    default:
      return '로그인에 실패했습니다. (' + (code || (e && e.message) || '알 수 없는 오류') + ')';
  }
}

export async function logout() {
  await signOut(auth);
}
