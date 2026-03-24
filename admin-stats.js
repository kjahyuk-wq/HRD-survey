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
export async function populateStatsSelect() {
  try {
    const snap = await getDocs(collection(db, 'courses'));
    snap.docs.forEach(d => { state.courseIdMap[d.data().name] = d.id; });
    const courses = snap.docs.map(d => d.data().name);
    const sel = document.getElementById('stats-course-select');
    sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
      courses.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  } catch (e) {}
}

export async function loadStats() {
  const course = document.getElementById('stats-course-select').value;
  if (!course) return;
  state.lastCourseName = course;

  document.getElementById('stats-placeholder').style.display = 'none';
  document.getElementById('stats-loading').style.display = 'block';
  document.getElementById('stats-area').style.display = 'none';
  document.getElementById('stats-no-data').style.display = 'none';

  try {
    const courseId = state.courseIdMap[course];
    const [responsesSnap, studentsSnap, instructorsSnap] = await Promise.all([
      getDocs(collection(db, 'courses', courseId, 'responses')),
      getDocs(collection(db, 'courses', courseId, 'students')),
      getDocs(query(collection(db, 'courses', courseId, 'instructors'), orderBy('createdAt')))
    ]);

    const responses = responsesSnap.docs.map(d => ({
      ...d.data(),
      submittedAt: d.data().submittedAt?.toDate?.()?.toISOString() ?? null
    }));
    const students = studentsSnap.docs.map(d => ({
      ...d.data(),
      completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null
    }));
    const orderedInstructorKeys = instructorsSnap.docs.map(d => {
      const { name, education } = d.data();
      return education ? `${education}__${name}` : name;
    });

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
        ? `👨‍🏫 [${escapeHtml(parts[0])}] ${escapeHtml(parts[1])} 강사`
        : `👨‍🏫 ${escapeHtml(key)} 강사`;
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
