import { db } from './firebase-config.js';
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr, NC_SURVEY, normalizeCourseType, getInstructorGroup } from './admin-utils.js';
import { lsRead, lsWrite } from './admin-courses.js';
import { getInstructorCategory, COMMON_CATEGORY } from './admin-rounds.js';

// 강사 정렬 — admin 측이 박은 order 필드 우선, 없으면 createdAt fallback.
// (학생 설문 main.js 의 sortInstructors 와 동일 정책)
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

function buildCourseLabel(name, startDate, endDate, active) {
  const dateLabel = (startDate && endDate)
    ? ` (${String(startDate).replaceAll('-', '.')}~${String(endDate).replaceAll('-', '.')})`
    : '';
  return (active ? '' : '[종료] ') + name + dateLabel;
}

function renderPreviewCourseOptions(courses) {
  courses.sort((a, b) => (a.active === b.active) ? 0 : (a.active ? -1 : 1));
  const sel = document.getElementById('preview-course-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
    courses.map(({ id, name, startDate, endDate, active, type }) => {
      const label = buildCourseLabel(name, startDate, endDate, active);
      return `<option value="${escapeAttr(id)}" data-name="${escapeAttr(name)}" data-type="${type}">${escapeHtml(label)}</option>`;
    }).join('');
  if (prev) sel.value = prev;
}

async function refreshPreviewCoursesFresh(prevCached) {
  try {
    const snap = await getDocs(collection(db, 'courses'));
    const courses = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        active: data.active !== false,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        type: normalizeCourseType(data.type),
      };
    });
    if (courses.length > 0) lsWrite('courses', courses);
    if (courses.length === 0 && Array.isArray(prevCached) && prevCached.length > 0) return;
    renderPreviewCourseOptions(courses);
  } catch (_) {}
}

export async function populatePreviewSelect() {
  // 캐시 있으면 즉시 return + fresh 는 백그라운드. 사내망 long-polling 대기 없이
  // 호출자(goToCourseTab 등)가 sel.value 즉시 설정 가능.
  const cached = lsRead('courses');
  if (Array.isArray(cached) && cached.length > 0) {
    renderPreviewCourseOptions(cached.map(c => ({ ...c })));
    refreshPreviewCoursesFresh(cached); // fire-and-forget
    const sel = document.getElementById('preview-course-select');
    if (sel?.value) loadPreviewInstructors();
    return;
  }
  await refreshPreviewCoursesFresh(null);
  const sel = document.getElementById('preview-course-select');
  if (sel?.value) loadPreviewInstructors();
}

// 미리보기용 회차 셀렉트 — stats 모듈과 동일 패턴 (캐시 키로 같은 과정 재선택 시 재요청 회피)
let lastPopulatedPreviewRoundCourseId = null;

async function populatePreviewRoundSelect(courseId) {
  const sel = document.getElementById('preview-round-select');
  sel.disabled = false;
  sel.innerHTML = '<option value="">-- 회차 선택 --</option>';
  try {
    const snap = await getDocs(collection(db, 'courses', courseId, 'rounds'));
    const rounds = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    rounds.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    if (rounds.length === 0) {
      sel.innerHTML = '<option value="">등록된 회차 없음</option>';
      sel.disabled = true;
      return;
    }
    sel.innerHTML += rounds.map(r => {
      const closed = r.active === false ? ' [종료]' : '';
      const label = (r.name ? `${r.number}회차 · ${r.name}` : `${r.number}회차`) + closed;
      return `<option value="${escapeAttr(r._id)}">${escapeHtml(label)}</option>`;
    }).join('');
  } catch (_) {
    sel.innerHTML = '<option value="">회차 불러오기 실패</option>';
    sel.disabled = true;
  }
}

// 신규자 과정 고정 문항 미리보기 — NC_SURVEY 정의로 동적 생성 (index.html 블록과 동일 구성)
function renderNewcomerPreviewQuestions() {
  const container = document.getElementById('preview-newcomer-questions');
  if (!container || container.dataset.rendered) return;
  container.dataset.rendered = '1';

  const ratingHtml = (name) => [1, 2, 3, 4, 5].map((v, i) => {
    const labels = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
    return `<label class="rating-label"><input type="radio" name="${name}" value="${v}"><span class="rating-btn">${v}<br><small>${labels[i]}</small></span></label>`;
  }).join('');

  let html = NC_SURVEY.map(q => {
    const num = q.label.split('.')[0];  // 'Q1'
    const txt = q.label.slice(q.label.indexOf('.') + 1).trim();
    const body = q.kind === 'scale'
      ? `<div class="rating-group">${ratingHtml(`p${q.key}`)}</div>`
      : `<div class="choice-group">${q.options.map(o =>
          `<label class="choice-label"><input type="radio" name="p${q.key}" value="${escapeAttr(o)}"><span class="choice-btn">${escapeHtml(o)}</span></label>`
        ).join('')}</div>`;
    const sub = (q.key === 'nq6' || q.key === 'nq7')
      ? `<div class="q-card optional">
          <div class="q-num opt">${num}-1 <em>선택</em></div>
          <div class="q-txt">문${num.slice(1)}.에서 불만족하다면 개선해야 할 사항은? (구체적으로)</div>
          <textarea placeholder="개선이 필요한 사항을 작성해 주세요." rows="3"></textarea>
        </div>`
      : '';
    return `<div class="q-card">
        <div class="q-num">${num}</div>
        <div class="q-txt">${escapeHtml(txt)}</div>
        ${body}
      </div>${sub}`;
  }).join('');
  container.innerHTML = html;
}

// 신규자 과정 반 셀렉트 — 강사 group union. 반 없으면 숨김.
function populatePreviewNcGroupSelect(instructors) {
  const sel = document.getElementById('preview-group-select');
  if (!sel) return;
  const seen = new Set();
  const groups = [];
  instructors.forEach(inst => {
    const g = getInstructorGroup(inst);
    if (g && !seen.has(g)) { seen.add(g); groups.push(g); }
  });
  if (groups.length === 0) {
    sel.style.display = 'none';
    sel.value = '';
    sel.innerHTML = '<option value="">(전체)</option>';
    return;
  }
  const prev = sel.value;
  sel.style.display = 'inline-block';
  sel.innerHTML = '<option value="">(전체)</option>' +
    groups.map(g => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join('');
  if (prev && groups.includes(prev)) sel.value = prev;
}

// 카테고리 셀렉트 — 회차 강사 union 에서 추출 ('공통' 외). 없으면 숨김.
function populatePreviewCategorySelect(instructors) {
  const sel = document.getElementById('preview-group-select');
  if (!sel) return;
  const seen = new Set();
  const cats = [];
  instructors.forEach(inst => {
    const c = getInstructorCategory(inst);
    if (c !== COMMON_CATEGORY && !seen.has(c)) {
      seen.add(c);
      cats.push(c);
    }
  });
  if (cats.length === 0) {
    sel.style.display = 'none';
    sel.value = '';
    sel.innerHTML = '<option value="">(전체)</option>';
    return;
  }
  const prev = sel.value;
  sel.style.display = 'inline-block';
  sel.innerHTML = '<option value="">(전체)</option>' +
    `<option value="${COMMON_CATEGORY}">${escapeHtml(COMMON_CATEGORY)}</option>` +
    cats.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if (prev && (prev === COMMON_CATEGORY || cats.includes(prev))) sel.value = prev;
}

export async function loadPreviewInstructors() {
  const sel = document.getElementById('preview-course-select');
  const courseId = sel?.value;
  const opt = sel?.options?.[sel.selectedIndex];
  const courseLabel = opt?.textContent || '';
  const courseType = normalizeCourseType(opt?.dataset.type);
  const badge = document.getElementById('preview-course-badge');
  const container = document.getElementById('preview-instructor-questions');
  const roundSel = document.getElementById('preview-round-select');
  const groupSel = document.getElementById('preview-group-select');

  // 과정 타입별 고정 문항 블록 전환 (표준 vs 신규자)
  const isNewcomer = courseType === 'newcomer';
  const stdBlock = document.getElementById('preview-standard-questions');
  const ncBlock = document.getElementById('preview-newcomer-questions');
  if (stdBlock) stdBlock.style.display = isNewcomer ? 'none' : 'block';
  if (ncBlock) {
    ncBlock.style.display = isNewcomer ? 'block' : 'none';
    if (isNewcomer) renderNewcomerPreviewQuestions();
  }

  if (!courseId) {
    badge.textContent = '교육과정을 선택하세요';
    container.innerHTML = '';
    roundSel.style.display = 'none';
    if (groupSel) { groupSel.style.display = 'none'; groupSel.value = ''; }
    return;
  }

  // 회차 셀렉트 표시/숨김 분기 (중견리더만 노출)
  if (courseType === 'leadership') {
    if (lastPopulatedPreviewRoundCourseId !== courseId) {
      await populatePreviewRoundSelect(courseId);
      lastPopulatedPreviewRoundCourseId = courseId;
    }
    roundSel.style.display = 'inline-block';
  } else {
    roundSel.style.display = 'none';
    // 신규자 과정은 반 필터로 groupSel 재사용 — 강사 fetch 후 populate
    if (groupSel && !isNewcomer) { groupSel.style.display = 'none'; groupSel.value = ''; }
  }

  const roundId = courseType === 'leadership' ? roundSel.value : '';

  // 중견리더인데 회차 미선택 — 안내만 보이고 강사 문항 비움
  if (courseType === 'leadership' && !roundId) {
    badge.textContent = courseLabel;
    container.innerHTML = '<div class="no-data" style="margin:0.5rem 0;">회차를 선택해 주세요.</div>';
    if (groupSel) { groupSel.style.display = 'none'; groupSel.value = ''; }
    return;
  }

  container.innerHTML = '<div class="loading" style="text-align:center;padding:1rem;">강사 정보 불러오는 중...</div>';
  try {
    const instructorsRef = courseType === 'leadership'
      ? collection(db, 'courses', courseId, 'rounds', roundId, 'instructors')
      : collection(db, 'courses', courseId, 'instructors');
    const instSnap = await getDocs(instructorsRef);
    const allInstructors = sortInstructors(instSnap.docs.map(d => d.data()));

    // 필터 셀렉트는 강사 fetch 후에 갱신 (중견리더: 카테고리 / 신규자: 반)
    if (courseType === 'leadership') {
      populatePreviewCategorySelect(allInstructors);
    } else if (isNewcomer) {
      populatePreviewNcGroupSelect(allInstructors);
    }
    const categoryFilter = (courseType === 'leadership' && groupSel?.style.display !== 'none')
      ? (groupSel?.value || '')
      : '';
    const ncGroupFilter = (isNewcomer && groupSel?.style.display !== 'none')
      ? (groupSel?.value || '')
      : '';

    // 라벨 갱신 (중견리더는 회차 + 카테고리, 신규자는 반)
    let displayLabel = courseLabel;
    if (courseType === 'leadership') {
      const rOpt = roundSel.options[roundSel.selectedIndex];
      displayLabel = `${courseLabel} · ${rOpt?.textContent || ''}`;
      if (categoryFilter) displayLabel += ` · ${categoryFilter}`;
    } else if (ncGroupFilter) {
      displayLabel += ` · ${ncGroupFilter}`;
    }
    badge.textContent = displayLabel;

    // 필터 적용 — 중견리더: 한 카테고리만 골라 보기 / 신규자: 그 반 학생이 보는 목록(공통 + 반)
    let instructors = allInstructors;
    if (categoryFilter) {
      instructors = allInstructors.filter(inst => getInstructorCategory(inst) === categoryFilter);
    } else if (ncGroupFilter) {
      instructors = allInstructors.filter(inst => {
        const g = getInstructorGroup(inst);
        return !g || g === ncGroupFilter;
      });
    }

    if (instructors.length === 0) {
      container.innerHTML = '<div class="no-data" style="margin:0.5rem 0;">등록된 강사가 없습니다.</div>';
      return;
    }

    container.innerHTML = instructors.map((inst, i) => {
      const qNum = 17 + i;
      // 칩: 중견리더 = 카테고리, 신규자 = 반. 단기는 기존 그대로 강사명만.
      let catTag = '';
      if (courseType === 'leadership') {
        const cat = getInstructorCategory(inst);
        catTag = cat === COMMON_CATEGORY
          ? '<span class="rg-tag common" style="margin-right:.4rem;">공통</span>'
          : `<span class="rg-tag" style="margin-right:.4rem;">${escapeHtml(cat)}</span>`;
      } else if (isNewcomer) {
        const g = getInstructorGroup(inst);
        catTag = g
          ? `<span class="rg-tag" style="margin-right:.4rem;">${escapeHtml(g)}</span>`
          : '<span class="rg-tag common" style="margin-right:.4rem;">공통</span>';
      }
      const nameLabel = inst.education ? `${escapeHtml(inst.education)} · ${escapeHtml(inst.name)}` : escapeHtml(inst.name);
      const ratingHtml = [1,2,3,4,5].map((v, vi) => {
        const labels = ['매우 불만족','불만족','보통','만족','매우 만족'];
        return `<label class="rating-label"><input type="radio" name="pq${qNum}" value="${v}"><span class="rating-btn">${v}<br><small>${labels[vi]}</small></span></label>`;
      }).join('');
      return `<div class="q-card">
        <div class="q-num">Q${qNum}</div>
        <div class="q-txt">
          <div style="font-size:.8rem;color:#888;margin-bottom:.3rem;">${catTag}강사 만족도 · ${nameLabel}</div>
          강사의 전반적인 강의 만족도는?
        </div>
        <div class="rating-group">${ratingHtml}</div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="no-data">강사 정보를 불러오지 못했습니다.</div>';
  }
}
