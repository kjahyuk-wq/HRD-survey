// ── 만족도 결과보고서(HWPX) 데이터 계산 ──────────────────────────────
// 브라우저 의존성 없는 순수 함수 모음 (Node 에서도 테스트 가능).
// 집계 규칙은 기존 보고서(대청호 오백리길 2기 등)와 동일:
//   - 항목 평균 = 소수 둘째 자리, 만족이상(%) = 4·5점 비율 소수 첫째 자리(100 → "100")
//   - 분야 평균 = 소속 항목 평균의 평균, 총평균 = 전 항목(객관식+교과) 평균의 평균
//   - 분야 '평균' 행의 만족이상(%) = 항목 비율의 평균(소수 둘째 자리)

// 표준 설문(q1~q9) 문항의 보고서 표기 — 인재개발원 결과보고 서식 문구 그대로
const STD_REPORT_LABELS = {
  q1: '목적달성을 위한 교육기간',
  q2: '목적달성을 위한 교과편성',
  q3: '목적달성을 위한 강사선정',
  q4: '교육내용 및 수준',
  q5: '과정장 및 직원 교육과정 운영',
  q6: '과정 전반적인 만족도',
  q7: '향후 업무 및 개인생활에 도움이 됨',
  q8: '식당 음식의 질 및 서비스',
  q9: '강의실 및 편의시설 수준',
};

// 보고서 서식의 ①~④ 분야 순서. 과정 타입 categories 라벨이 이와 같아야 지원.
export const REPORT_CATEGORIES = ['교육기간', '교육운영', '교육효과', '시설환경'];

export function isReportSupported(cfg) {
  const labels = (cfg?.categories || []).map(c => c.label);
  return labels.length === REPORT_CATEGORIES.length
    && labels.every((l, i) => l === REPORT_CATEGORIES[i]);
}

export function gradeOf(v) {
  if (v >= 4.4) return '매우 만족';
  if (v >= 3.8) return '만족';
  if (v >= 3.0) return '보통';
  if (v >= 2.0) return '불만족';
  return '매우 불만족';
}
const GRADE_ORDER = ['매우 만족', '만족', '보통', '불만족', '매우 불만족'];

const r2 = v => Number(v.toFixed(2));
const r1 = v => Number(v.toFixed(1));
const f2 = v => v.toFixed(2);
const fPct = v => String(r1(v));          // 100 → "100", 96.43 → "96.4"
const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

function reportLabel(q) {
  return STD_REPORT_LABELS[q.key] || String(q.label).replace(/^Q\d+(-\d+)?\.\s*/, '');
}

// 강사 키: 'education__name' (교과목__강사) 또는 'name'
export function splitInstructorKey(k) {
  const i = k.indexOf('__');
  return i >= 0 ? { subject: k.slice(0, i), name: k.slice(i + 2) } : { subject: k, name: '' };
}

// "4개 분야 ‘매우 만족’, 1개 분야 ‘만족’" / "5개 전 분야에서 ‘매우 만족’"
function gradeSummary(grades, unitAll, unit) {
  const counts = {};
  grades.forEach(g => { counts[g] = (counts[g] || 0) + 1; });
  const present = GRADE_ORDER.filter(g => counts[g]);
  if (present.length === 1) return { all: true, grade: present[0], text: `${grades.length}개 ${unitAll} ‘${present[0]}’` };
  return { all: false, text: present.map(g => `${counts[g]}개 ${unit} ‘${g}’`).join(', ') };
}

// 날짜 'YYYY-MM-DD' → '2026. 6. 29.(월)' (sameYear 면 연도 생략)
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
export function formatKoDate(iso, omitYear = false) {
  const d = parseIso(iso);
  if (!d) return '';
  const md = `${d.getUTCMonth() + 1}. ${d.getUTCDate()}.(${DOW[d.getUTCDay()]})`;
  return omitYear ? md : `${d.getUTCFullYear()}. ${md}`;
}
export function formatPeriod(startIso, endIso, withDays = true) {
  const s = parseIso(startIso), e = parseIso(endIso);
  if (!s) return '';
  if (!e || +e === +s) return formatKoDate(startIso) + (withDays ? ' / 1일' : '');
  const days = Math.round((e - s) / 86400000) + 1;
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  return `${formatKoDate(startIso)} ~ ${formatKoDate(endIso, sameYear)}` + (withDays ? ` / ${days}일` : '');
}

// ── 통계 → 보고서 수치 ──────────────────────────────
// stats: admin-stats.computeStats 결과, cfg: getSurveyConfig(courseType)
// excludeKeys: 설문은 받았지만 보고서에는 싣지 않는 문항 (표·분야 평균·총평균·항목 수에서 모두 제외)
export function computeReportNumbers(stats, cfg, excludeKeys = []) {
  const { avgs, dists, hasData, instRaw, instKeys } = stats;

  const items = cfg.scale.map((q, i) => {
    const answered = dists[i].reduce((a, b) => a + b, 0);
    return {
      key: q.key,
      label: reportLabel(q),
      has: hasData[i] && !excludeKeys.includes(q.key),
      avg: hasData[i] ? r2(avgs[i]) : 0,
      pct: answered ? r1((dists[i][3] + dists[i][4]) / answered * 100) : 0,
    };
  });

  const cats = cfg.categories.map(c => {
    const rows = c.indices.map(i => items[i]).filter(it => it.has);
    return {
      label: c.label,
      rows,
      avg: r2(mean(rows.map(r => r.avg))),
      pct: mean(rows.map(r => r.pct)),
    };
  });

  const lectures = instKeys
    .filter(k => instRaw[k] && instRaw[k].count > 0)
    .map(k => {
      const { sum, count, dist } = instRaw[k];
      return { ...splitInstructorKey(k), avg: r2(sum / count), pct: r1((dist[3] + dist[4]) / count * 100) };
    });

  const lecAvg = r2(mean(lectures.map(l => l.avg)));
  const lecPct = mean(lectures.map(l => l.pct));
  const allItemAvgs = [...items.filter(i => i.has).map(i => i.avg), ...lectures.map(l => l.avg)];
  const overallAvg = r2(mean(allItemAvgs));

  return { items, cats, lectures, lecAvg, lecPct, overallAvg, itemCount: allItemAvgs.length };
}

// ── 보고서 템플릿 data 조립 ──────────────────────────────
// meta: { courseTitle, course, goal, period, surveyDate, targetCount, respCount, manager }
// draft: { effect, improvements:[{issue, action}], facility[], impression[], instructor[], surveyImprove[] }
export function buildReportData(nums, meta, draft) {
  const { cats, lectures, lecAvg, lecPct, overallAvg, itemCount } = nums;
  const hasLec = lectures.length > 0;
  const fieldGrades = [...cats.map(c => gradeOf(c.avg)), ...(hasLec ? [gradeOf(lecAvg)] : [])];
  const field = gradeSummary(fieldGrades, '전 분야에서', '분야');

  let lecStatus = '해당 없음';
  let lecMax = '-', lecMin = '-';
  if (hasLec) {
    const lg = gradeSummary(lectures.map(l => gradeOf(l.avg)), '전 교과목', '교과목');
    const TONE = { '매우 만족': '매우 높았음', '만족': '높았음', '보통': '보통 수준이었음' };
    lecStatus = `${lg.text}으로 강의에 대한 만족도가 전반적으로 ${TONE[gradeOf(lecAvg)] || '낮았음'}`;
    lecMax = f2(Math.max(...lectures.map(l => l.avg)));
    lecMin = f2(Math.min(...lectures.map(l => l.avg)));
  }

  const list = (arr, empty) => {
    const xs = (arr || []).map(s => String(s).trim().replace(/^[○∙·\-•]\s*/, '')).filter(Boolean);
    return xs.length ? xs : [empty];
  };
  const improvements = (draft.improvements || [])
    .map(x => ({ issue: String(x.issue || '').trim(), action: String(x.action || '').trim() }))
    .filter(x => x.issue);

  const overallGrade = gradeOf(overallAvg);
  const catRows = c => c.rows.map(r => ({ label: r.label, avg: f2(r.avg), pct: fPct(r.pct) }));

  return {
    ...meta,
    effect: String(draft.effect || '').trim(),
    fieldCount: String(cats.length + (hasLec ? 1 : 0)),
    itemCount: String(itemCount),
    overallAvg: f2(overallAvg),
    overallGrade,
    overallGradeTight: overallGrade.replace(/\s/g, ''),
    improve: improvements.length
      ? improvements.map(x => ({
        issue: x.issue.replace(/^○\s*/, ''),
        action: /^[-–]/.test(x.action) || !x.action ? x.action : `- ${x.action}`,
      }))
      : [{ issue: '없음', action: '없음' }],
    ...Object.fromEntries(cats.flatMap((c, i) => [
      [`cat${i + 1}`, catRows(c)],
      [`cat${i + 1}Count`, String(c.rows.length)],
      [`cat${i + 1}Avg`, f2(c.avg)],
      [`cat${i + 1}Pct`, f2(c.pct)],
    ])),
    lec: hasLec
      ? lectures.map(l => ({ subject: l.subject, name: l.name, avg: f2(l.avg), pct: fPct(l.pct) }))
      : [{ subject: '-', name: '-', avg: '-', pct: '-' }],
    lecCount: String(lectures.length),
    lecAvg: hasLec ? f2(lecAvg) : '-',
    lecPct: hasLec ? f2(lecPct) : '-',
    fieldStatus: field.text,
    lecStatus, lecMax, lecMin,
    facility: list(draft.facility, '편의시설 관련 별다른 건의사항 없음'),
    impression: list(draft.impression, '별도 의견 없음'),
    instructor: list(draft.instructor, '별도 건의 의견 없음'),
    surveyImprove: list(draft.surveyImprove, '별도 추가·개선 의견 없음'),
  };
}

// ── 중견리더양성과정 서식 (평균 소수 첫째 자리, 만족이상 정수, 평균 행이 표 머리 바로 아래) ──
// 중견 보고서는 '과정장 및 직원 교육과정 운영'(q5)을 조사는 하지만 싣지 않음 → 교육운영 4항목
export const LEADERSHIP_EXCLUDED_KEYS = ['q5'];
const LEAD_REPORT_LABELS = {
  q1: '목적 달성을 위한 교육기간',
  q6: '전반적인 과정운영 만족도',
  q7: '향후 업무 및 개인생활 기여도',
};

// 받침 유무로 은/는
function eunNeun(word) {
  const c = String(word).charCodeAt(String(word).length - 1);
  return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0 ? '은' : '는';
}

// "모든 분야(교육기간, …)에서 ‘매우 만족’으로 나타남"
// "교육기간, 교육효과는 ‘매우 만족’이며, 교육운영은 ‘만족’으로 나타남"
function leadFieldStatus(fields) {
  const groups = GRADE_ORDER
    .map(g => ({ g, names: fields.filter(f => f.grade === g).map(f => f.label) }))
    .filter(x => x.names.length);
  if (groups.length === 1) return `모든 분야(${fields.map(f => f.label).join(', ')})에서 ‘${groups[0].g}’으로 나타남`;
  const parts = groups.map(({ g, names }) => `${names.join(', ')}${eunNeun(names[names.length - 1])} ‘${g}’`);
  return `${parts.slice(0, -1).join(', ')}이며, ${parts[parts.length - 1]}으로 나타남`;
}

// meta 는 buildReportData 와 같고 absentCount 추가.
// draft 에 facilityAction / instructorAction (검토결과 "→" 줄) 추가.
export function buildLeadershipReportData(nums, meta, draft) {
  const { cats, lectures } = nums;
  const f1 = v => v.toFixed(1);
  const fInt = v => String(Math.round(v));
  const g1 = v => gradeOf(r1(v));       // 화면에 보이는 값(소수 첫째 자리) 기준 등급
  const hasLec = lectures.length > 0;
  const lecAvg = r1(nums.lecAvg);
  const overallAvg = r1(nums.overallAvg);

  const fields = [
    ...cats.map(c => ({ label: c.label, grade: g1(c.avg) })),
    ...(hasLec ? [{ label: '강의만족도', grade: gradeOf(lecAvg) }] : []),
  ];
  const clean = arr => (arr || []).map(s => String(s).trim().replace(/^[○∙·\-•]\s*/, '')).filter(Boolean);
  const withAction = (items, action) => (items.length && String(action || '').trim() ? [String(action).trim()] : []);
  const facility = clean(draft.facility);
  const instructor = clean(draft.instructor);
  const improvements = (draft.improvements || [])
    .map(x => ({ issue: String(x.issue || '').trim().replace(/^○\s*/, ''), action: String(x.action || '').trim().replace(/^[-–]\s*/, '') }))
    .filter(x => x.issue);

  return {
    ...meta,
    effect: String(draft.effect || '').replace(/\*\*/g, '').trim(),
    fieldCount: String(fields.length),
    itemCount: String(nums.itemCount),
    overallAvg: f1(overallAvg),
    overallGrade: gradeOf(overallAvg),
    improve: improvements.length
      ? improvements.map(x => ({ issue: x.issue, action: x.action || '-' }))
      : [{ issue: '의견없음', action: '-' }],
    ...Object.fromEntries(cats.flatMap((c, i) => [
      [`cat${i + 1}`, c.rows.map(r => ({ label: LEAD_REPORT_LABELS[r.key] || r.label, avg: f1(r.avg), pct: fInt(r.pct) }))],
      [`cat${i + 1}Count`, String(c.rows.length)],
      [`cat${i + 1}Avg`, f1(c.avg)],
      [`cat${i + 1}Pct`, fInt(c.pct)],
    ])),
    lec: hasLec
      ? lectures.map(l => ({ subject: l.subject, name: l.name, avg: f1(l.avg), pct: fInt(l.pct) }))
      : [{ subject: '-', name: '-', avg: '-', pct: '-' }],
    lecCount: String(lectures.length),
    lecAvg: hasLec ? f1(lecAvg) : '-',
    lecPct: hasLec ? fInt(nums.lecPct) : '-',
    lecGrade: hasLec ? gradeOf(lecAvg) : '-',
    fieldStatus: leadFieldStatus(fields),
    facility: facility.length ? facility : ['없음'],
    facilityAction: withAction(facility, draft.facilityAction),
    instructor: instructor.length ? instructor : ['없음'],
    instructorAction: withAction(instructor, draft.instructorAction),
    surveyImprove: clean(draft.surveyImprove).length ? clean(draft.surveyImprove) : ['없음'],
  };
}

// 차트(분야별 만족도 현황)용 라벨·값
export function chartSeries(nums) {
  const labels = nums.cats.map(c => c.label);
  const values = nums.cats.map(c => c.avg);
  if (nums.lectures.length) { labels.push('강의만족도'); values.push(nums.lecAvg); }
  return { labels, values };
}

// ── 주관식 응답 → 보고서 4개 칸 분류 (AI 요약 입력) ──────────────
// 안쪽 배열은 대체 키 체인 (comment1 이 없을 때만 이전 양식 comment 사용)
const COMMENT_BUCKETS = {
  facility: [['q10_comment']],
  impression: [['comment1', 'comment']],
  instructor: [['comment3'], ['nq6_comment'], ['nq7_comment']],
  surveyImprove: [['comment2']],
};
const EMPTY_ANSWER = /^(없음|없습니다|없어요|특별히 없음|x|-|\.)$/i;
export function collectComments(responses) {
  const out = {};
  Object.entries(COMMENT_BUCKETS).forEach(([bucket, chains]) => {
    out[bucket] = [];
    responses.forEach(r => chains.forEach(chain => {
      const v = chain.map(k => String(r[k] || '').trim()).find(Boolean);
      if (v && !EMPTY_ANSWER.test(v)) out[bucket].push(v);
    }));
  });
  return out;
}
