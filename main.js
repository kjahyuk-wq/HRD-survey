import { db, auth, functions } from './firebase-config.js';
import {
  collectionGroup, collection, doc, query, where, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";

// 강사 카테고리 캐논. 빈 값/'common'/'공통' 은 모두 공통.
const COMMON_CATEGORY = '공통';

// 중견리더 모드는 roundId/roundNumber/roundName 채워지고 instructors는 (공통 + 학생 선택 강사) 로 구성.
// allRoundInstructors 는 선택활동 화면에서 카테고리 그루핑용 원본 보관.
// electives 는 학생이 고른 강사 키 배열 (정규화된 강의명 = inst.education).
let currentUser = {
  name: '', empNo: '', course: '', courseId: '', studentRef: null,
  type: 'standard', instructors: [],
  roundId: '', roundNumber: 0, roundName: '',
  completedRounds: [],
  allRoundInstructors: [],
  electives: null,
  electivesPersisted: false,
};

function getCategory(inst) {
  if (inst && typeof inst.category === 'string') {
    const c = inst.category.trim();
    return c || COMMON_CATEGORY;
  }
  // legacy 호환: groups 비었거나 'common' 단일이면 공통, 그 외 (분반) 도 일단 공통으로 흡수
  return COMMON_CATEGORY;
}

function instructorElectiveKey(inst) {
  // 학생 electives 배열의 키 — 강의명 기준. 강의명이 비면 강사명으로 fallback.
  return (inst.education || inst.name || '').trim();
}

async function doLogin() {
  const name = document.getElementById('input-name').value.trim();
  const empNo = document.getElementById('input-empno').value.trim();

  if (!name) { showLoginError('이름을 입력해 주세요.'); return; }
  if (!/^\d+$/.test(empNo) || parseInt(empNo) < 1) { showLoginError('교번을 올바르게 입력해 주세요. (1 이상의 숫자)'); return; }

  document.getElementById('login-error').style.display = 'none';
  const btn = document.getElementById('login-btn');
  document.getElementById('login-btn-text').textContent = '확인 중...';
  btn.disabled = true;

  try {
    // Firestore 보안 규칙 통과를 위한 익명 로그인 (교육생에게 보이지 않음)
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    // collectionGroup 쿼리로 모든 과정의 수강생을 단일 쿼리로 검색
    const q = query(collectionGroup(db, 'students'), where('empNo', '==', empNo));
    const snap = await getDocs(q);
    const candidates = snap.docs.filter(d => d.data().name === name);

    if (candidates.length === 0) {
      showLoginError('등록된 수강생 정보를 찾을 수 없습니다.\n이름 또는 교번을 확인하거나 담당자에게 문의해 주세요.');
      reset(); return;
    }

    // 활성 과정에 속한 수강생만 통과 — 종료된 과정의 동명이인/동교번 충돌 방지
    const courseDocs = await Promise.all(candidates.map(c => getDoc(c.ref.parent.parent)));
    const activeMatches = candidates
      .map((c, i) => ({ studentDoc: c, courseDoc: courseDocs[i] }))
      .filter(({ courseDoc }) => courseDoc.exists() && courseDoc.data().active !== false);

    if (activeMatches.length === 0) {
      showLoginError('등록된 수강생 정보를 찾을 수 없습니다.\n이름 또는 교번을 확인하거나 담당자에게 문의해 주세요.');
      reset(); return;
    }

    if (activeMatches.length > 1) {
      showLoginError('동일한 정보의 수강생이 여러 활성 과정에 등록되어 있습니다.\n담당자에게 문의해 주세요.');
      reset(); return;
    }

    const found = activeMatches[0].studentDoc;
    const courseDoc = activeMatches[0].courseDoc;

    const studentData = found.data();
    const matchCourseId = found.ref.parent.parent.id;
    const matchCourseData = courseDoc.data();
    const matchCourseName = matchCourseData.name;
    const courseType = matchCourseData.type === 'leadership' ? 'leadership' : 'standard';

    // 단기과정: completed 플래그로 한 번만 차단
    // 중견리더: 회차 선택 화면에서 회차별로 disabled 처리 (모든 회차 완료 시 안내)
    if (courseType === 'standard' && studentData.completed) {
      showLoginError('이미 설문에 참여하셨습니다.\n감사합니다!');
      reset(); return;
    }

    document.getElementById('page-login').style.display = 'none';
    document.getElementById('page-survey').style.display = 'block';

    if (courseType === 'leadership') {
      // electives 존재 여부로 선택활동 화면 노출 결정 (배열 자체가 있으면 이미 한번 골랐다는 뜻)
      const persistedElectives = Array.isArray(studentData.electives) ? studentData.electives.slice() : null;
      currentUser = {
        name, empNo,
        course: matchCourseName,
        courseId: matchCourseId,
        studentRef: found.ref,
        type: 'leadership',
        instructors: [],
        roundId: '', roundNumber: 0, roundName: '',
        completedRounds: Array.isArray(studentData.completedRounds) ? studentData.completedRounds : [],
        allRoundInstructors: [],
        electives: persistedElectives,
        electivesPersisted: persistedElectives !== null,
      };
      await showRoundSelect();
    } else {
      const instrSnap = await getDocs(collection(db, 'courses', matchCourseId, 'instructors'));
      const instructors = instrSnap.docs.map(d => d.data());
      sortInstructors(instructors);
      currentUser = {
        name, empNo,
        course: matchCourseName,
        courseId: matchCourseId,
        studentRef: found.ref,
        type: 'standard',
        instructors,
        roundId: '', roundNumber: 0, roundName: '',
        completedRounds: [],
        allRoundInstructors: [],
        electives: null,
        electivesPersisted: false,
      };
      document.getElementById('confirm-greeting').textContent = `${name}님, 안녕하세요!`;
      document.getElementById('confirm-course-name').textContent = matchCourseName;
      document.getElementById('confirm-round-line').style.display = 'none';
      updateSurveyMeta(instructors.length);
      document.getElementById('screen-confirm').style.display = 'block';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (e) {
    console.error(e);
    showLoginError('서버 연결에 문제가 발생했습니다.\n잠시 후 다시 시도해 주세요.');
    reset();
  }

  function reset() {
    btn.disabled = false;
    document.getElementById('login-btn-text').textContent = '확인하기';
  }
}

// 중견리더 과정: 활성 회차를 fetch해서 회차 선택 카드를 렌더한다.
// 학생의 completedRounds에 포함된 회차는 disabled로 표시 (이미 응답 완료).
async function showRoundSelect() {
  document.getElementById('round-select-greeting').textContent = `${currentUser.name}님, 안녕하세요!`;
  document.getElementById('round-select-course-name').textContent = currentUser.course;
  document.getElementById('round-select-list').innerHTML = '<div class="round-select-loading">회차 목록을 불러오는 중...</div>';
  document.getElementById('round-select-empty').style.display = 'none';
  document.getElementById('screen-round-select').style.display = 'block';

  try {
    const snap = await getDocs(collection(db, 'courses', currentUser.courseId, 'rounds'));
    const rounds = snap.docs
      .map(d => ({ ...d.data(), _id: d.id }))
      .filter(r => r.active !== false);
    rounds.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

    const list = document.getElementById('round-select-list');
    if (rounds.length === 0) {
      list.innerHTML = '';
      document.getElementById('round-select-empty').style.display = 'block';
      return;
    }

    const completed = new Set(currentUser.completedRounds || []);
    const allDone = rounds.every(r => completed.has(r._id));

    list.innerHTML = rounds.map(r => {
      const done = completed.has(r._id);
      const dateLabel = (r.startDate && r.endDate)
        ? `${String(r.startDate).replaceAll('-', '.')} ~ ${String(r.endDate).replaceAll('-', '.')}`
        : '';
      const nameLine = r.name ? `<span class="rs-name">${escapeHtml(r.name)}</span>` : '';
      const dateLine = dateLabel ? `<span class="rs-date">${escapeHtml(dateLabel)}</span>` : '';
      const status = done ? '<span class="rs-done">완료</span>' : '';
      return `
        <button class="round-select-btn ${done ? 'is-done' : ''}" ${done ? 'disabled' : ''}
                onclick="selectRound('${escapeAttr(r._id)}')">
          <span class="rs-num">${r.number}회차</span>
          ${nameLine}
          ${dateLine}
          ${status}
        </button>`;
    }).join('');

    if (allDone) {
      document.getElementById('round-select-empty').textContent = '모든 활성 회차에 응답을 완료하셨습니다. 감사합니다!';
      document.getElementById('round-select-empty').style.display = 'block';
    }
  } catch (e) {
    console.error(e);
    document.getElementById('round-select-list').innerHTML = '<div class="round-select-loading">회차 목록을 불러오지 못했습니다.</div>';
  }
}

// 회차 선택 시: 회차 강사를 fetch + (electives 미저장이면) 선택활동 화면, 아니면 바로 confirm.
async function selectRound(roundId) {
  const list = document.getElementById('round-select-list');
  const buttons = list.querySelectorAll('button');
  buttons.forEach(b => b.disabled = true);

  const reenable = () => buttons.forEach(b => { if (!b.classList.contains('is-done')) b.disabled = false; });

  try {
    // 회차 문서 + 회차 강사 동시 fetch
    const [roundDocSnap, instSnap] = await Promise.all([
      getDoc(doc(db, 'courses', currentUser.courseId, 'rounds', roundId)),
      getDocs(collection(db, 'courses', currentUser.courseId, 'rounds', roundId, 'instructors'))
    ]);
    if (!roundDocSnap.exists()) {
      alert('선택하신 회차를 찾을 수 없습니다. 다시 시도해 주세요.');
      reenable();
      return;
    }
    const roundData = roundDocSnap.data();
    const allInstructors = instSnap.docs.map(d => d.data());
    sortInstructors(allInstructors);

    currentUser.roundId = roundId;
    currentUser.roundNumber = roundData.number;
    currentUser.roundName = roundData.name || '';
    currentUser.allRoundInstructors = allInstructors;

    // 카테고리 추출: 공통 외 카테고리만 모음 (선택활동 화면 노출 여부 판단)
    const electiveCategories = collectElectiveCategories(allInstructors);

    document.getElementById('screen-round-select').style.display = 'none';

    if (electiveCategories.length > 0 && !currentUser.electivesPersisted) {
      // 선택활동 화면으로 진입
      showElectivesScreen(electiveCategories, allInstructors);
    } else {
      // 카테고리 없음 또는 이미 저장된 선택분 사용 → 바로 응답 화면
      enterConfirmWithFilteredInstructors(allInstructors);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error(e);
    alert('회차 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    reenable();
  }
}

// 강사 목록에서 공통 외 카테고리 union (강의 순서 기준으로 처음 등장한 순서 보존)
function collectElectiveCategories(instructors) {
  const seen = new Set();
  const out = [];
  instructors.forEach(inst => {
    const c = getCategory(inst);
    if (c !== COMMON_CATEGORY && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  });
  return out;
}

function showElectivesScreen(categories, instructors) {
  document.getElementById('electives-greeting').textContent = `${currentUser.name}님, 안녕하세요!`;

  // 카테고리별 강사 그루핑 (강사 순서 보존)
  const byCat = {};
  categories.forEach(c => { byCat[c] = []; });
  instructors.forEach(inst => {
    const c = getCategory(inst);
    if (c !== COMMON_CATEGORY && byCat[c]) byCat[c].push(inst);
  });

  const sections = categories.map(c => {
    const items = byCat[c].map((inst, i) => {
      const key = instructorElectiveKey(inst);
      if (!key) return '';
      const label = inst.name
        ? `${escapeHtml(inst.education || '')} · ${escapeHtml(inst.name)}`
        : escapeHtml(inst.education || '');
      const id = `elect-${escapeAttr(c)}-${i}`;
      return `<label class="elect-choice" for="${id}">
        <input type="checkbox" id="${id}" data-key="${escapeAttr(key)}" data-cat="${escapeAttr(c)}">
        <span class="elect-choice-label">${label}</span>
      </label>`;
    }).join('');
    return `<section class="electives-cat">
      <h3 class="electives-cat-title">${escapeHtml(c)}</h3>
      <div class="electives-cat-list">${items}</div>
    </section>`;
  }).join('');

  document.getElementById('electives-sections').innerHTML = sections;
  document.getElementById('electives-error').style.display = 'none';
  document.getElementById('screen-electives').style.display = 'block';
}

function confirmElectives() {
  const checks = document.querySelectorAll('#electives-sections input[type="checkbox"]');
  const selected = Array.from(checks).filter(cb => cb.checked).map(cb => cb.dataset.key);
  // 빈 선택도 허용 — "아무 선택활동 안 들음" 케이스를 인정 (공통 강사만 평가).
  currentUser.electives = selected;

  document.getElementById('screen-electives').style.display = 'none';
  enterConfirmWithFilteredInstructors(currentUser.allRoundInstructors);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// allRoundInstructors 와 currentUser.electives 기반으로 노출할 강사를 결정하고 confirm 화면 진입.
function enterConfirmWithFilteredInstructors(allInstructors) {
  const electiveSet = new Set(Array.isArray(currentUser.electives) ? currentUser.electives : []);
  const instructors = allInstructors.filter(inst => {
    const c = getCategory(inst);
    if (c === COMMON_CATEGORY) return true;
    const key = instructorElectiveKey(inst);
    return key && electiveSet.has(key);
  });
  currentUser.instructors = instructors;

  document.getElementById('confirm-greeting').textContent = `${currentUser.name}님, 안녕하세요!`;
  document.getElementById('confirm-course-name').textContent = currentUser.course;
  const roundLine = document.getElementById('confirm-round-line');
  const baseLabel = currentUser.roundName
    ? `${currentUser.roundNumber}회차 · ${currentUser.roundName}`
    : `${currentUser.roundNumber}회차`;
  roundLine.textContent = baseLabel;
  roundLine.style.display = 'block';
  updateSurveyMeta(instructors.length);
  document.getElementById('screen-confirm').style.display = 'block';
}

function updateSurveyMeta(instructorCount) {
  const totalQ = 19 + instructorCount;
  const mins = Math.max(3, Math.round(totalQ * 0.4));
  document.getElementById('survey-q-count').textContent = `총 ${totalQ}문항`;
  document.getElementById('survey-time').textContent = `약 ${mins}분`;
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function startSurvey() {
  document.getElementById('screen-confirm').style.display = 'none';
  document.getElementById('screen-survey').style.display = 'block';

  const badge = document.getElementById('survey-course-badge');
  badge.textContent = currentUser.course;
  badge.style.display = 'inline-block';

  renderInstructorQuestions(currentUser.instructors);
  updateSurveyMeta(currentUser.instructors.length);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderInstructorQuestions(instructors) {
  const container = document.getElementById('instructor-questions');
  if (!instructors || instructors.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = instructors.map((inst, idx) => {
    const qNum = 17 + idx;
    const inputName = `instructor_${idx}`;
    const instName = typeof inst === 'string' ? inst : inst.name;
    const edu = typeof inst === 'string' ? '' : inst.education;
    const label = edu
      ? `[${escapeHtml(edu)}] ${escapeHtml(instName)} 강사의 강의 만족도는 어떠셨습니까?`
      : `${escapeHtml(instName)} 강사의 강의 만족도는 어떠셨습니까?`;
    return `
      <div class="q-card">
        <div class="q-num">Q${qNum}</div>
        <div class="q-txt">${label}</div>
        <div class="rating-group" data-question="${qNum}">
          ${[1,2,3,4,5].map((v, i) => {
            const labels = ['매우 불만족','불만족','보통','만족','매우 만족'];
            return `<label class="rating-label">
              <input type="radio" name="${inputName}" value="${v}">
              <span class="rating-btn">${v}<br><small>${labels[i]}</small></span>
            </label>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

async function submitSurvey() {
  const answers = [];
  for (let i = 1; i <= 9; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (!selected) {
      document.getElementById('error-msg').style.display = 'block';
      document.querySelector(`[data-question="${i}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    answers.push(parseInt(selected.value));
  }

  const q10Comment = document.getElementById('q10-comment').value.trim();

  const demographics = {};
  for (let i = 11; i <= 16; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (!selected) {
      document.getElementById('error-msg').style.display = 'block';
      document.querySelector(`[data-question="${i}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    demographics[`q${i}`] = selected.value;
  }

  const instructorScores = {};
  for (let idx = 0; idx < currentUser.instructors.length; idx++) {
    const selected = document.querySelector(`input[name="instructor_${idx}"]:checked`);
    if (!selected) {
      document.getElementById('error-msg').style.display = 'block';
      document.querySelector(`[data-question="${17 + idx}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const inst = currentUser.instructors[idx];
    const instName = typeof inst === 'string' ? inst : inst.name;
    const edu = typeof inst === 'string' ? '' : inst.education;
    const key = edu ? `${edu}__${instName}` : instName;
    instructorScores[key] = parseInt(selected.value);
  }

  const comment1 = document.getElementById('comment1').value.trim();
  const comment2 = document.getElementById('comment2').value.trim();
  const comment3 = document.getElementById('comment3').value.trim();

  document.getElementById('error-msg').style.display = 'none';
  const btn = document.getElementById('submit-btn');
  document.getElementById('btn-text').textContent = '제출 중...';
  btn.disabled = true;

  try {
    // 응답 본문 — name/empNo/course/submittedAt 은 서버가 신뢰 가능한 소스에서 박음 (보안)
    const response = {
      q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4],
      q6: answers[5], q7: answers[6], q8: answers[7], q9: answers[8],
      q10_comment: q10Comment,
      q11: demographics.q11, q12: demographics.q12, q13: demographics.q13,
      q14: demographics.q14, q15: demographics.q15, q16: demographics.q16,
      instructors: instructorScores,
      comment1, comment2, comment3,
    };

    const payload = {
      name: currentUser.name,
      empNo: currentUser.empNo,
      courseId: currentUser.courseId,
      roundId: currentUser.type === 'leadership' ? currentUser.roundId : null,
      response,
    };
    // 중견리더 모드 + 미저장된 선택분이 있으면 서버 트랜잭션에 함께 넣어 학생 doc 에 영속.
    if (currentUser.type === 'leadership'
        && !currentUser.electivesPersisted
        && Array.isArray(currentUser.electives)) {
      payload.electives = currentUser.electives;
    }

    // 서버에서 본인성 검증 + 트랜잭션으로 응답 + completed + (필요시) electives 갱신
    const submit = httpsCallable(functions, 'submitSurveyResponse');
    await submit(payload);

    document.getElementById('screen-survey').style.display = 'none';
    document.getElementById('screen-result').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error(e);
    document.getElementById('btn-text').textContent = '설문 제출하기';
    btn.disabled = false;
    const code = e?.code || '';
    if (code === 'functions/already-exists') {
      alert(e.message || '이미 응답하셨습니다. 감사합니다!');
    } else if (code === 'functions/resource-exhausted') {
      alert('잠시 후 다시 시도해 주세요. (요청 한도 초과)');
    } else if (
      code === 'functions/invalid-argument'
      || code === 'functions/failed-precondition'
      || code === 'functions/not-found'
    ) {
      alert(e.message || '제출할 수 없습니다. 담당자에게 문의해 주세요.');
    } else {
      alert('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
}

// 강사 정렬 — admin 측이 박은 order 필드 우선, 없으면 createdAt fallback.
// (admin-courses / admin-rounds 의 정책과 동일. orderBy('createdAt') 으로 fetch 하면
// admin 에서 수기로 조정한 시간표 순서가 무시되는 버그가 있었음)
function sortInstructors(arr) {
  arr.sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    const ta = a.createdAt?.seconds ?? 0;
    const tb = b.createdAt?.seconds ?? 0;
    return ta - tb;
  });
  return arr;
}

// 본문 텍스트 + 속성 자리 양쪽에서 안전 (따옴표까지 entity).
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// HTML 속성 + onclick 안의 JS 문자열(작은따옴표) 양쪽 컨텍스트에서 안전.
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

window.doLogin = doLogin;
window.startSurvey = startSurvey;
window.submitSurvey = submitSurvey;
window.selectRound = selectRound;
window.confirmElectives = confirmElectives;
