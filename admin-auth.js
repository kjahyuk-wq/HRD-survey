import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// Firebase Console > Authentication > Users 에 이 이메일로 계정을 생성하세요
const ADMIN_EMAIL = 'kjahyuk@korea.kr';

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
