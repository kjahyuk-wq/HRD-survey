import { db } from './firebase-config.js';
import {
  collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, Q_LABELS, QUESTION_CATEGORIES, DEMO_QUESTIONS, escapeHtml, escapeAttr, formatDate } from './admin-utils.js';

// ── 통계 단일 패스 계산 ──────────────────────────────
export function computeStats(responses, orderedInstructorKeys) {
  const n = responses.length;
  const keys = ['q1','q2','q3','q4','q5','q6','q7','q8','q9'];

  // 초기화
  const sums = new Array(9).fill(0);
  const dists = keys.map(() => [0, 0, 0, 0, 0]); // 인덱스 0~4 = 점수 1~5
  const instRaw = {}; // key -> { sum, count, dist[] }
  const demoRaw = {}; // dq.key -> { opt -> count }
  DEMO_QUESTIONS.forEach(dq => {
    demoRaw[dq.key] = {};
    dq.options.forEach(o => { demoRaw[dq.key][o] = 0; });
  });

  // 단일 패스
  responses.forEach(r => {
    keys.forEach((k, i) => {
      const v = Number(r[k]);
      if (v >= 1 && v <= 5) { sums[i] += v; dists[i][v - 1]++; }
    });

    let obj = r.instructors || {};
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = {}; } }
    Object.entries(obj).forEach(([k, score]) => {
      const v = Number(score);
      if (v >= 1 && v <= 5) {
        if (!instRaw[k]) instRaw[k] = { sum: 0, count: 0, dist: [0, 0, 0, 0, 0] };
        instRaw[k].sum += v;
        instRaw[k].count++;
        instRaw[k].dist[v - 1]++;
      }
    });

    DEMO_QUESTIONS.forEach(dq => {
      const val = String(r[dq.key] || '').trim();
      if (val && demoRaw[dq.key][val] !== undefined) demoRaw[dq.key][val]++;
    });
  });

  const avgs = sums.map((s, i) => n > 0 ? s / n : 0);
  const hasData = dists.map(d => d.some(c => c > 0));

  const allInstKeys = Object.keys(instRaw);
  const instKeys = orderedInstructorKeys.filter(k => instRaw[k])
    .concat(allInstKeys.filter(k => !orderedInstructorKeys.includes(k)));

  return { n, keys, avgs, dists, hasData, instRaw, instKeys, demoRaw };
}

// ── 통계 탭 ──────────────────────────────
// 같은 이름의 과정을 기간으로 구분하기 위해 option label에 날짜 포함
function buildCourseLabel(name, startDate, endDate, active) {
  const dateLabel = (startDate && endDate)
    ? ` (${String(startDate).replaceAll('-', '.')}~${String(endDate).replaceAll('-', '.')})`
    : '';
  return (active ? '' : '[종료] ') + name + dateLabel;
}

export async function populateStatsSelect() {
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
        type: data.type === 'leadership' ? 'leadership' : 'standard',
      };
    });
    courses.sort((a, b) => (a.active === b.active) ? 0 : (a.active ? -1 : 1));
    const sel = document.getElementById('stats-course-select');
    sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
      courses.map(({ id, name, startDate, endDate, active, type }) => {
        const label = buildCourseLabel(name, startDate, endDate, active);
        return `<option value="${escapeAttr(id)}" data-name="${escapeAttr(name)}" data-type="${type}">${escapeHtml(label)}</option>`;
      }).join('');
  } catch (e) {}
}

// 회차 셀렉트 — 중견리더 과정 선택 시에만 채움/노출. 캐시 키로 같은 과정 재호출 시 재요청 회피.
// 회차 데이터(특히 groups)를 캐시해두면 분반 셀렉트 갱신 시 추가 fetch 없이 처리 가능.
let lastPopulatedRoundCourseId = null;
const roundsByCourse = {};  // courseId → [{...round, _id}]

async function populateRoundSelect(courseId) {
  const sel = document.getElementById('stats-round-select');
  sel.disabled = false;
  sel.innerHTML = '<option value="">-- 회차 선택 --</option>';
  try {
    const snap = await getDocs(collection(db, 'courses', courseId, 'rounds'));
    const rounds = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    rounds.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    roundsByCourse[courseId] = rounds;
    if (rounds.length === 0) {
      sel.innerHTML = '<option value="">등록된 회차 없음</option>';
      sel.disabled = true;
      return;
    }
    sel.innerHTML += rounds.map(r => {
      const closed = r.active === false ? ' [종료]' : '';
      const label = (r.name ? `${r.number}회차 · ${r.name}` : `${r.number}회차`) + closed;
      return `<option value="${escapeAttr(r._id)}" data-num="${r.number}" data-name="${escapeAttr(r.name || '')}">${escapeHtml(label)}</option>`;
    }).join('');
  } catch (_) {
    sel.innerHTML = '<option value="">회차 불러오기 실패</option>';
    sel.disabled = true;
  }
}

// 분반 셀렉트 채움 — 회차 데이터의 groups 기반. 분반 0개면 셀렉트 숨김.
function populateGroupSelect(courseId, roundId) {
  const sel = document.getElementById('stats-group-select');
  if (!sel) return;
  const round = (roundsByCourse[courseId] || []).find(r => r._id === roundId);
  const groups = Array.isArray(round?.groups) ? round.groups : [];
  if (groups.length === 0) {
    sel.style.display = 'none';
    sel.value = '';
    sel.innerHTML = '<option value="">(전체)</option>';
    return;
  }
  // 기존 선택값 보존 (회차 변경해도 같은 분반 이름이면 유지)
  const prev = sel.value;
  sel.style.display = 'inline-block';
  sel.innerHTML = '<option value="">(전체)</option>' +
    groups.map(g => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join('');
  if (prev && groups.includes(prev)) sel.value = prev;
}

export async function loadStats() {
  const sel = document.getElementById('stats-course-select');
  const courseId = sel?.value;
  if (!courseId) return;
  const opt = sel.options[sel.selectedIndex];
  const courseName  = opt?.dataset.name || '';
  const courseLabel = opt?.textContent || courseName;
  const courseType  = opt?.dataset.type === 'leadership' ? 'leadership' : 'standard';
  state.lastCourseName  = courseName;
  state.lastCourseLabel = courseLabel;
  state.lastCourseType  = courseType;

  const roundSel = document.getElementById('stats-round-select');
  const groupSel = document.getElementById('stats-group-select');

  // 회차 셀렉트 표시/숨김 및 채우기 — 중견리더만
  if (courseType === 'leadership') {
    if (lastPopulatedRoundCourseId !== courseId) {
      await populateRoundSelect(courseId);
      lastPopulatedRoundCourseId = courseId;
    }
    roundSel.style.display = 'inline-block';
  } else {
    roundSel.style.display = 'none';
    if (groupSel) { groupSel.style.display = 'none'; groupSel.value = ''; }
    state.lastRoundId = '';
    state.lastRoundLabel = '';
    state.lastRoundNumber = 0;
    state.lastRoundName = '';
    state.lastGroupName = '';
    state.lastGroupLabel = '';
  }

  const roundId = courseType === 'leadership' ? roundSel.value : '';

  // 중견리더인데 회차 미선택 — 안내만 보이고 통계 비움
  if (courseType === 'leadership' && !roundId) {
    const ph = document.getElementById('stats-placeholder');
    ph.style.display = 'block';
    ph.textContent = '회차를 선택해 주세요.';
    document.getElementById('stats-loading').style.display = 'none';
    document.getElementById('stats-area').style.display = 'none';
    document.getElementById('stats-no-data').style.display = 'none';
    const nameEl = document.getElementById('stats-course-name');
    if (nameEl) nameEl.textContent = courseLabel;
    if (groupSel) { groupSel.style.display = 'none'; groupSel.value = ''; }
    state.lastRoundId = '';
    state.lastRoundLabel = '';
    state.lastGroupName = '';
    state.lastGroupLabel = '';
    return;
  }

  // 회차 선택됐으면 분반 셀렉트 갱신
  if (courseType === 'leadership') {
    populateGroupSelect(courseId, roundId);
  }
  const groupName = (courseType === 'leadership' && groupSel?.style.display !== 'none') ? (groupSel?.value || '') : '';

  // 라벨 갱신 (분반까지 포함)
  let displayLabel = courseLabel;
  if (courseType === 'leadership') {
    const rOpt = roundSel.options[roundSel.selectedIndex];
    const rLabel = rOpt?.textContent || '';
    state.lastRoundId = roundId;
    state.lastRoundLabel = rLabel;
    state.lastRoundNumber = parseInt(rOpt?.dataset.num) || 0;
    state.lastRoundName = rOpt?.dataset.name || '';
    displayLabel = `${courseLabel} · ${rLabel}`;
    if (groupName) {
      displayLabel += ` · ${groupName}`;
      state.lastGroupName = groupName;
      state.lastGroupLabel = groupName;
    } else {
      state.lastGroupName = '';
      state.lastGroupLabel = '';
    }
  }
  const nameEl = document.getElementById('stats-course-name');
  if (nameEl) nameEl.textContent = displayLabel;

  document.getElementById('stats-placeholder').style.display = 'none';
  document.getElementById('stats-loading').style.display = 'block';
  document.getElementById('stats-area').style.display = 'none';
  document.getElementById('stats-no-data').style.display = 'none';

  try {
    // 데이터 경로 분기 — 학생 컬렉션은 과정 단위 그대로(C 모델)
    const responsesRef = courseType === 'leadership'
      ? collection(db, 'courses', courseId, 'rounds', roundId, 'responses')
      : collection(db, 'courses', courseId, 'responses');
    const instructorsRef = courseType === 'leadership'
      ? collection(db, 'courses', courseId, 'rounds', roundId, 'instructors')
      : collection(db, 'courses', courseId, 'instructors');

    const [responsesSnap, studentsSnap, instructorsSnap] = await Promise.all([
      getDocs(responsesRef),
      getDocs(collection(db, 'courses', courseId, 'students')),
      getDocs(query(instructorsRef, orderBy('createdAt')))
    ]);

    let responses = responsesSnap.docs.map(d => ({
      ...d.data(),
      submittedAt: d.data().submittedAt?.toDate?.()?.toISOString() ?? null
    }));
    // 분반 선택 시 응답 필터: response.groupName이 일치하는 것만
    if (groupName) {
      responses = responses.filter(r => (r.groupName || '') === groupName);
    }

    // renderStats는 학생.completed 필드를 본다 — 회차 모드에서는 completedRounds.includes(roundId)로 매핑.
    // 분반 선택 시: 분모 학생도 그 분반 학생으로 좁힘.
    let students = studentsSnap.docs.map(d => {
      const data = d.data();
      const isComplete = courseType === 'leadership'
        ? Array.isArray(data.completedRounds) && data.completedRounds.includes(roundId)
        : !!data.completed;
      return {
        ...data,
        completed: isComplete,
        completedAt: data.completedAt?.toDate?.()?.toISOString() ?? null
      };
    });
    if (groupName) {
      students = students.filter(s => (s.group || '') === groupName);
    }

    // 강사 키 순서: 분반 선택 시 그 분반에 노출되는 강사로 좁힘 (학생 흐름과 동일 로직)
    const allInstructors = instructorsSnap.docs.map(d => d.data());
    const visibleInstructors = groupName
      ? allInstructors.filter(inst => {
          const igs = Array.isArray(inst.groups) ? inst.groups : [];
          if (igs.length === 0) return true;  // 구 데이터 호환
          return igs.includes(groupName) || igs.includes('common');
        })
      : allInstructors;
    const orderedInstructorKeys = visibleInstructors.map(({ name, education }) =>
      education ? `${education}__${name}` : name
    );

    document.getElementById('stats-loading').style.display = 'none';

    if (!responses.length) {
      document.getElementById('stats-no-data').style.display = 'block';
      return;
    }

    state.lastResponses = responses;
    state.lastOrderedInstructorKeys = orderedInstructorKeys;
    state.lastComputedStats = computeStats(responses, orderedInstructorKeys);

    renderStats(state.lastComputedStats, students, responses);
    document.getElementById('stats-area').style.display = 'block';
  } catch (e) {
    document.getElementById('stats-loading').textContent = '데이터를 불러오지 못했습니다.';
  }
}

export function renderStats(stats, students, responses) {
  const { n, avgs, dists, hasData, instRaw, instKeys, demoRaw } = stats;
  const totalStudents = students.length;
  const completedStudents = students.filter(s => s.completed).length;
  const rate = totalStudents > 0 ? Math.round(completedStudents / totalStudents * 100) : 0;
  const notCompleted = students.filter(s => !s.completed);

  document.getElementById('total-students').textContent = totalStudents + '명';
  document.getElementById('completion-rate').textContent = rate + '%';
  document.getElementById('completion-detail').textContent = `${completedStudents} / ${totalStudents}명`;
  document.getElementById('not-completed').textContent = notCompleted.length + '명';

  const ncSection = document.getElementById('not-completed-section');
  if (notCompleted.length > 0) {
    ncSection.style.display = 'block';
    document.getElementById('not-completed-list').innerHTML = notCompleted.map(s =>
      `<span class="nc-badge">${escapeHtml(s.name)}</span>`
    ).join('');
  } else {
    ncSection.style.display = 'none';
  }

  const makeQCard = (avg, i, dist) => {
    if (!hasData[i]) return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${Q_LABELS[i]}</span>
          <span class="q-stat-avg" style="color:#aaa;">응답 없음</span>
        </div>
        <div style="color:#bbb;font-size:0.82rem;padding:0.3rem 0;">아직 수집된 응답이 없습니다.</div>
      </div>`;
    const pct = (avg / 5 * 100).toFixed(1);
    const color = avg >= 4.5 ? '#22c55e' : avg >= 3.5 ? '#0066cc' : avg >= 2.5 ? '#f59e0b' : '#ef4444';
    const satisfyPct = n > 0 ? ((dist[3] + dist[4]) / n * 100).toFixed(1) : '0.0';
    return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${Q_LABELS[i]}</span>
          <span class="q-stat-avg" style="color:${color}">${avg.toFixed(2)}점</span>
          <span class="q-stat-satisfy">만족이상 ${satisfyPct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="dist-row">
          ${dist.map((cnt, j) => `
            <div class="dist-item">
              <div class="dist-bar-wrap"><div class="dist-bar" style="height:${n>0?(cnt/n*60):0}px;background:${color}"></div></div>
              <div class="dist-label">${j+1}점</div>
              <div class="dist-count">${cnt}명</div>
            </div>`).join('')}
        </div>
      </div>`;
  };

  document.getElementById('question-stats').innerHTML = QUESTION_CATEGORIES.map(cat => {
    const validIdx = cat.indices.filter(i => hasData[i]);
    const catValidAvgs = validIdx.map(i => avgs[i]);
    const catAvg = catValidAvgs.length > 0 ? catValidAvgs.reduce((a, b) => a + b, 0) / catValidAvgs.length : null;
    const catColor = catAvg !== null ? (catAvg >= 4.5 ? '#22c55e' : catAvg >= 3.5 ? '#0066cc' : catAvg >= 2.5 ? '#f59e0b' : '#ef4444') : '#aaa';
    const catSatisfyTotal = validIdx.reduce((sum, i) => sum + dists[i].reduce((a, b) => a + b, 0), 0);
    const catSatisfyCount = validIdx.reduce((sum, i) => sum + dists[i][3] + dists[i][4], 0);
    const catSatisfyPct = catSatisfyTotal > 0 ? (catSatisfyCount / catSatisfyTotal * 100).toFixed(1) : null;
    const catAvgHtml = catAvg !== null
      ? `<span class="cat-header-avg" style="color:${catColor}">평균 ${catAvg.toFixed(2)}점 &nbsp;·&nbsp; 만족이상 ${catSatisfyPct}%</span>`
      : '';
    return `<div class="cat-header">${cat.label}${catAvgHtml}</div>` +
      cat.indices.map(i => makeQCard(avgs[i], i, dists[i])).join('');
  }).join('');

  if (instKeys.length > 0) {
    document.getElementById('instructor-stats-section').style.display = 'block';
    const allInstScores = instKeys.flatMap(k => {
      const r = instRaw[k];
      return Array.from({ length: r.count }, (_, i) => {
        // reconstruct scores from dist for flat operations
        let scores = [];
        r.dist.forEach((cnt, idx) => { for (let j = 0; j < cnt; j++) scores.push(idx + 1); });
        return scores;
      }).flat();
    });
    // simpler: use sum/count
    const instTotalSum = instKeys.reduce((a, k) => a + instRaw[k].sum, 0);
    const instTotalCount = instKeys.reduce((a, k) => a + instRaw[k].count, 0);
    const instTotalAvg = instTotalSum / instTotalCount;
    const instTotalColor = instTotalAvg >= 4.5 ? '#22c55e' : instTotalAvg >= 3.5 ? '#0066cc' : instTotalAvg >= 2.5 ? '#f59e0b' : '#ef4444';
    const instTotalSatisfy = instKeys.reduce((a, k) => a + instRaw[k].dist[3] + instRaw[k].dist[4], 0);
    const instTotalSatisfyPct = instTotalCount > 0 ? (instTotalSatisfy / instTotalCount * 100).toFixed(1) : '0.0';

    document.getElementById('instructor-stats').innerHTML = `
      <div class="inst-total-summary">
        <span class="inst-total-label">강사 전체 평균</span>
        <span class="inst-total-avg" style="color:${instTotalColor}">${instTotalAvg.toFixed(2)}점</span>
        <span class="q-stat-satisfy">만족이상 ${instTotalSatisfyPct}%</span>
      </div>` + instKeys.map(key => {
      const { sum, count, dist } = instRaw[key];
      const avg = sum / count;
      const pct = (avg / 5 * 100).toFixed(1);
      const color = avg >= 4.5 ? '#22c55e' : avg >= 3.5 ? '#0066cc' : avg >= 2.5 ? '#f59e0b' : '#ef4444';
      const instSatisfyPct = count > 0 ? ((dist[3] + dist[4]) / count * 100).toFixed(1) : '0.0';
      const parts = key.split('__');
      const label = parts.length === 2
        ? `[${escapeHtml(parts[0])}] ${escapeHtml(parts[1])} 강사`
        : `${escapeHtml(key)} 강사`;
      return `
        <div class="q-stat-card">
          <div class="q-stat-header">
            <span class="q-stat-label">${label}</span>
            <span class="q-stat-avg" style="color:${color}">${avg.toFixed(2)}점</span>
            <span class="q-stat-satisfy">만족이상 ${instSatisfyPct}%</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="dist-row">
            ${dist.map((c, j) => `
              <div class="dist-item">
                <div class="dist-bar-wrap"><div class="dist-bar" style="height:${count>0?(c/count*60):0}px;background:${color}"></div></div>
                <div class="dist-label">${j+1}점</div>
                <div class="dist-count">${c}명</div>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');
  } else {
    document.getElementById('instructor-stats-section').style.display = 'none';
  }

  // 전체 평균
  const validAvgs = avgs.filter((_, i) => hasData[i]);
  const allScoresForOverall = validAvgs.map(v => Number(v.toFixed(2)));
  instKeys.forEach(k => {
    const { sum, count } = instRaw[k];
    if (count > 0) allScoresForOverall.push(Number((sum / count).toFixed(2)));
  });
  const overallAvg = allScoresForOverall.length > 0
    ? allScoresForOverall.reduce((a, b) => a + b, 0) / allScoresForOverall.length
    : 0;
  document.getElementById('overall-avg').textContent = overallAvg.toFixed(2);

  document.getElementById('demographics-stats-section').style.display = 'block';
  document.getElementById('demographics-stats').innerHTML = DEMO_QUESTIONS.map(dq => {
    const counts = dq.options.map(opt => demoRaw[dq.key][opt] || 0);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) {
      return `
        <div class="q-stat-card">
          <div class="q-stat-header">
            <span class="q-stat-label">${dq.label}</span>
            <span class="q-stat-avg" style="color:#aaa;">응답 없음</span>
          </div>
          <div style="color:#bbb;font-size:0.82rem;padding:0.3rem 0;">아직 수집된 응답이 없습니다.</div>
        </div>`;
    }
    return `
      <div class="q-stat-card">
        <div class="q-stat-header">
          <span class="q-stat-label">${dq.label}</span>
          <span class="q-stat-avg" style="color:#555;">${total}명 응답</span>
        </div>
        <div class="demo-dist">
          ${dq.options.map((opt, i) => {
            const cnt = counts[i];
            const pct = total > 0 ? (cnt / total * 100).toFixed(1) : 0;
            return `
              <div class="demo-item">
                <span class="demo-label">${i + 1}. ${escapeHtml(opt)}</span>
                <div class="bar-track" style="flex:1;"><div class="bar-fill" style="width:${pct}%;background:#0066cc;"></div></div>
                <span class="demo-count">${cnt}명 (${pct}%)</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  const subjectiveTypes = [
    { key: 'q10_comment', label: 'Q10. 기타 편의시설 건의사항' },
    { key: 'comment1', label: '소감 및 건의사항' },
    { key: 'comment2', label: '만족도 평가 개선 필요 부분' },
    { key: 'comment3', label: '전반적인 과목 및 강사 건의' },
    { key: 'comment', label: '기타 의견 (이전 양식)' },
  ];
  let totalCommentCount = 0;
  let commentListHtml = '';
  subjectiveTypes.forEach(({ key, label }) => {
    const items = responses.filter(r => r[key] && String(r[key]).trim());
    if (!items.length) return;
    totalCommentCount += items.length;
    commentListHtml += `<div class="comment-sub-title">${escapeHtml(label)}</div>`;
    commentListHtml += items.map(r => `
      <div class="comment-item">
        <div class="comment-date">익명 · ${formatDate(r.submittedAt)}</div>
        <div class="comment-text">${escapeHtml(String(r[key]))}</div>
      </div>`).join('');
  });
  document.getElementById('comment-count').textContent = totalCommentCount + '건';
  document.getElementById('comments-list').innerHTML = commentListHtml || '<div class="no-comment">작성된 의견이 없습니다.</div>';
}
