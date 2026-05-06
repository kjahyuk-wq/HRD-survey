import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

import { checkLogin, logout } from './admin-auth.js';
import { loadCourseList, addCourse, deleteCourse, toggleCourseActive, togglePanel, toggleClosedCourses, addInstructor, deleteInstructor, handleInstExcelUpload, uploadExcelInstructors, toggleInstSelectAll, updateInstBulkDeleteBtn, deleteSelectedInstructors, moveInstructor, startEditInstructor, saveEditInstructor, cancelEditInstructor } from './admin-courses.js';
import { loadStudents, addStudent, deleteStudent, toggleSelectAll, updateBulkDeleteBtn, deleteSelectedStudents, handleExcelUpload, uploadExcelStudents, startEditStudent, saveEditStudent, cancelEditStudent } from './admin-students.js';
import { populateStatsSelect, loadStats } from './admin-stats.js';
import { exportStatsExcel, exportResultsExcel } from './admin-excel.js';
import { populatePreviewSelect, loadPreviewInstructors } from './admin-preview.js';

// ── 탭 전환 ──────────────────────────────
function setActiveTab(tab) {
  ['courses', 'stats', 'preview'].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  // 탭 진입 시 페이지 상단으로
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// 과정 카드의 [미리보기]/[통계] 바로가기 — 탭 전환 + 과정 자동 선택 + 데이터 로드
// + history.pushState로 브라우저 뒤로가기에서 교육과정 목록으로 복귀 가능
async function goToCourseTab(tab, courseName) {
  setActiveTab(tab);
  history.pushState({ tab, course: courseName }, '', `#${tab}`);
  if (tab === 'stats') {
    await populateStatsSelect();
    const sel = document.getElementById('stats-course-select');
    if (sel) sel.value = courseName;
    await loadStats();
  } else if (tab === 'preview') {
    await populatePreviewSelect();
    const sel = document.getElementById('preview-course-select');
    if (sel) sel.value = courseName;
    await loadPreviewInstructors();
  }
}

// 브라우저 뒤로/앞으로 가기로 탭 복원
window.addEventListener('popstate', async (e) => {
  const s = e.state || { tab: 'courses' };
  setActiveTab(s.tab);
  if (s.tab === 'stats' && s.course) {
    await populateStatsSelect();
    const sel = document.getElementById('stats-course-select');
    if (sel) sel.value = s.course;
    await loadStats();
  } else if (s.tab === 'preview' && s.course) {
    await populatePreviewSelect();
    const sel = document.getElementById('preview-course-select');
    if (sel) sel.value = s.course;
    await loadPreviewInstructors();
  }
});

// 페이지 첫 로드 시 baseline state 등록 (이후 뒤로가기로 여기에 복귀)
if (!history.state) {
  history.replaceState({ tab: 'courses' }, '', location.pathname);
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
window.goToCourseTab = goToCourseTab;
window.addCourse = addCourse;
window.deleteCourse = deleteCourse;
window.toggleCourseActive = toggleCourseActive;
window.loadCourseList = loadCourseList;
window.togglePanel = togglePanel;
window.toggleClosedCourses = toggleClosedCourses;
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
