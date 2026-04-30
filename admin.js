import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

import { checkLogin, logout } from './admin-auth.js';
import { loadCourseList, addCourse, deleteCourse, toggleInstructors, addInstructor, deleteInstructor, handleInstExcelUpload, uploadExcelInstructors, toggleInstSelectAll, updateInstBulkDeleteBtn, deleteSelectedInstructors, moveInstructor, startEditInstructor, saveEditInstructor, cancelEditInstructor } from './admin-courses.js';
import { loadStudents, addStudent, deleteStudent, toggleSelectAll, updateBulkDeleteBtn, deleteSelectedStudents, handleExcelUpload, uploadExcelStudents, startEditStudent, saveEditStudent, cancelEditStudent } from './admin-students.js';
import { populateStatsSelect, loadStats } from './admin-stats.js';
import { exportStatsExcel, exportResultsExcel } from './admin-excel.js';
import { populatePreviewSelect, loadPreviewInstructors } from './admin-preview.js';

// ── 탭 전환 ──────────────────────────────
function switchTab(tab) {
  ['courses', 'stats', 'preview'].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  const tabNames = ['courses', 'preview', 'stats'];
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', tabNames[i] === tab);
  });
  if (tab === 'stats') populateStatsSelect();
  if (tab === 'preview') populatePreviewSelect();
}

// ── Firebase Auth 상태 감지 ──────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadCourseList();
  } else {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    const pwInput = document.getElementById('pw-input');
    if (pwInput) pwInput.value = '';
    const loginBtn = document.querySelector('.login-box button');
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = '로그인'; }
  }
});

// ── window 전역 노출 (HTML onclick 핸들러용) ──────────────────────────────
window.checkLogin = checkLogin;
window.logout = logout;
window.switchTab = switchTab;
window.addCourse = addCourse;
window.deleteCourse = deleteCourse;
window.loadCourseList = loadCourseList;
window.toggleInstructors = toggleInstructors;
window.addInstructor = addInstructor;
window.deleteInstructor = deleteInstructor;
window.loadStudents = loadStudents;
window.addStudent = addStudent;
window.deleteStudent = deleteStudent;
window.toggleSelectAll = toggleSelectAll;
window.updateBulkDeleteBtn = updateBulkDeleteBtn;
window.deleteSelectedStudents = deleteSelectedStudents;
window.handleExcelUpload = handleExcelUpload;
window.uploadExcelStudents = uploadExcelStudents;
window.startEditStudent = startEditStudent;
window.saveEditStudent = saveEditStudent;
window.cancelEditStudent = cancelEditStudent;
window.handleInstExcelUpload = handleInstExcelUpload;
window.uploadExcelInstructors = uploadExcelInstructors;
window.toggleInstSelectAll = toggleInstSelectAll;
window.updateInstBulkDeleteBtn = updateInstBulkDeleteBtn;
window.deleteSelectedInstructors = deleteSelectedInstructors;
window.moveInstructor = moveInstructor;
window.startEditInstructor = startEditInstructor;
window.saveEditInstructor = saveEditInstructor;
window.cancelEditInstructor = cancelEditInstructor;
window.loadStats = loadStats;
window.exportStatsExcel = exportStatsExcel;
window.exportResultsExcel = exportResultsExcel;
window.loadPreviewInstructors = loadPreviewInstructors;
