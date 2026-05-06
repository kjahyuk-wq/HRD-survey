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
    errEl.style.display = 'block';
    document.getElementById('pw-input').value = '';
    btn.disabled = false;
    btn.textContent = '로그인';
  }
}

export async function logout() {
  await signOut(auth);
}
