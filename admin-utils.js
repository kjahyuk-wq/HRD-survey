// 공유 상수
export const Q_LABELS = [
  'Q1. 과정 목적 달성을 위한 교육기간',
  'Q2. 과정 목적 달성을 위한 교과편성',
  'Q3. 과정 목적 달성을 위한 강사선정',
  'Q4. 교육내용 및 수준',
  'Q5. 과정장 및 직원 교육과정 운영',
  'Q6. 과정 전반적인 만족도',
  'Q7. 교육내용의 향후 업무·개인생활 도움',
  'Q8. 식당 음식의 질 및 서비스',
  'Q9. 교육시설 및 편의시설 수준',
];

export const QUESTION_CATEGORIES = [
  { label: '교육기간', indices: [0] },
  { label: '교육운영', indices: [1, 2, 3, 4, 5] },
  { label: '교육효과', indices: [6] },
  { label: '시설환경', indices: [7, 8] },
];

export const DEMO_QUESTIONS = [
  { key: 'q11', label: 'Q11. 귀하의 근무처', options: ['시 본청', '시 사업소', '구', '동', '기타'] },
  { key: 'q12', label: 'Q12. 귀하의 직급', options: ['5급', '6급', '7급', '8급', '9급', '기타'] },
  { key: 'q13', label: 'Q13. 귀하의 직렬', options: ['행정직', '기술직', '연구직', '관리운영직', '기타'] },
  { key: 'q14', label: 'Q14. 귀하의 연령', options: ['20대', '30대', '40대', '50대'] },
  { key: 'q15', label: 'Q15. 귀하의 성별', options: ['남', '여'] },
  { key: 'q16', label: 'Q16. 입교 동기', options: ['업무능력 개발', '교육이수 점수 취득', '심신의 재충전', '자기개발', '기타'] },
];

// ── 지방공공기관 신규자 과정 (type: 'newcomer') 문항 정의 ──────────────
// 종이 설문지(OMR) 서식과 동일 순서. kind:'scale'=5점 척도(웹 1=매우불만족~5=매우만족),
// kind:'choice'=선택형(문자열 값 저장). 응답 필드 키는 표준(q1~)과 섞이지 않게 nq 접두.
export const NC_SURVEY = [
  { key: 'nq1',  kind: 'scale',  label: 'Q1. 과정 목적 달성을 위한 교육기간' },
  { key: 'nq2',  kind: 'choice', label: 'Q2. 교육기간 유지에 대한 의견', options: ['찬성', '보통', '반대'] },
  { key: 'nq3',  kind: 'choice', label: 'Q3. 본 과정에 입교하게 된 동기', options: ['본인 희망', '교육 담당부서의 배정(권유)'] },
  { key: 'nq4',  kind: 'scale',  label: 'Q4. 신규자의 올바른 가치관 확립에 도움' },
  { key: 'nq5',  kind: 'scale',  label: 'Q5. 과정의 전반적인 교과편성' },
  { key: 'nq6',  kind: 'scale',  label: 'Q6. 소양교육' },
  { key: 'nq7',  kind: 'scale',  label: 'Q7. 직무교육(지방공공기관의 이해, 예산회계, 노무관리 등)' },
  { key: 'nq8',  kind: 'scale',  label: 'Q8. 과정 목적 달성을 위한 강사 선정' },
  { key: 'nq9',  kind: 'scale',  label: 'Q9. 교재 및 교안의 적절성' },
  { key: 'nq10', kind: 'scale',  label: 'Q10. 과정의 전반적인 운영 만족도' },
  { key: 'nq11', kind: 'scale',  label: 'Q11. 교육내용 효과(향후 업무·개인생활 기여도)' },
  { key: 'nq12', kind: 'scale',  label: 'Q12. 식당 음식의 맛과 서비스' },
  { key: 'nq13', kind: 'scale',  label: 'Q13. 교육시설(강의실 등) 수준' },
  { key: 'nq14', kind: 'scale',  label: 'Q14. 기타 편의시설 제공 수준' },
  { key: 'nq15', kind: 'choice', label: 'Q15. 귀하의 연령', options: ['20대', '30대', '40대', '50대'] },
  { key: 'nq16', kind: 'choice', label: 'Q16. 귀하의 성별', options: ['남', '여'] },
];

export const NC_SCALE_QUESTIONS  = NC_SURVEY.filter(q => q.kind === 'scale');
export const NC_CHOICE_QUESTIONS = NC_SURVEY.filter(q => q.kind === 'choice');

// 신규자 척도 문항 카테고리 (인덱스는 NC_SCALE_QUESTIONS 배열 기준)
// nq1(0) nq4(1) nq5(2) nq6(3) nq7(4) nq8(5) nq9(6) nq10(7) nq11(8) nq12(9) nq13(10) nq14(11)
export const NC_QUESTION_CATEGORIES = [
  { label: '교육기간', indices: [0] },
  { label: '교육운영', indices: [1, 2, 3, 4, 5, 6, 7] },
  { label: '교육효과', indices: [8] },
  { label: '시설환경', indices: [9, 10, 11] },
];

const STD_SUBJECTIVE = [
  { key: 'q10_comment', label: 'Q10. 기타 편의시설 건의사항' },
  { key: 'comment1', label: '소감 및 건의사항' },
  { key: 'comment2', label: '만족도 평가 개선 필요 부분' },
  { key: 'comment3', label: '전반적인 과목 및 강사 건의' },
  { key: 'comment', label: '기타 의견 (이전 양식)' },
];

const NC_SUBJECTIVE = [
  { key: 'nq6_comment', label: 'Q6-1. 소양교육 개선사항' },
  { key: 'nq7_comment', label: 'Q7-1. 직무교육 개선사항' },
  { key: 'comment1', label: '소감 및 건의사항' },
  { key: 'comment2', label: '만족도 평가 개선 필요 부분' },
  { key: 'comment3', label: '전반적인 과목 및 강사 건의' },
];

// 과정 타입별 설문 구성 — 통계/엑셀/렌더가 공유하는 단일 소스.
// chartCats.keys 는 scale 배열의 key 기준.
export function getSurveyConfig(courseType) {
  if (courseType === 'newcomer') {
    return {
      scale: NC_SCALE_QUESTIONS,
      categories: NC_QUESTION_CATEGORIES,
      choice: NC_CHOICE_QUESTIONS,
      subjective: NC_SUBJECTIVE,
      overallLabel: '전체 평균 (객관식 + 강사)',
      chartCats: [
        { label: '교육기간', keys: ['nq1'] },
        { label: '교육운영', keys: ['nq4', 'nq5', 'nq6', 'nq7', 'nq8', 'nq9', 'nq10'] },
        { label: '교육효과', keys: ['nq11'] },
        { label: '시설환경', keys: ['nq12', 'nq13', 'nq14'] },
      ],
    };
  }
  return {
    scale: Q_LABELS.map((label, i) => ({ key: `q${i + 1}`, label })),
    categories: QUESTION_CATEGORIES,
    choice: DEMO_QUESTIONS,
    subjective: STD_SUBJECTIVE,
    overallLabel: '전체 평균 (Q1~Q9 + 강사)',
    chartCats: [
      { label: '교육기간', keys: ['q1'] },
      { label: '교육운영', keys: ['q2', 'q3', 'q4', 'q5', 'q6'] },
      { label: '교육효과', keys: ['q7'] },
      { label: '시설환경', keys: ['q8', 'q9'] },
    ],
  };
}

// 과정 타입 캐논 — Firestore/캐시/option dataset 어디서 읽든 이 함수로 정규화.
export function normalizeCourseType(t) {
  if (t === 'leadership') return 'leadership';
  if (t === 'newcomer') return 'newcomer';
  return 'standard';
}

// 신규자 과정 강사/수강생의 반 — 빈 문자열이면 공통(전원 평가) 강사.
export function getInstructorGroup(inst) {
  return (inst && typeof inst.group === 'string') ? inst.group.trim() : '';
}

// 모듈 간 공유 상태 (ES 모듈 싱글톤으로 공유됨)
export const state = {
  courseIdMap: {},
  courseActive: {},      // name → boolean (false면 종료된 과정)
  courseType: {},        // name → 'standard' | 'leadership'
  courseTypeById: {},    // id → 'standard' | 'leadership' (단기과정 skip 분기에 사용)
  lastResponses: [],
  lastCourseName: '',
  lastOrderedInstructorKeys: [],
  lastComputedStats: null,
};

// 본문 텍스트 + 속성 자리 양쪽에서 안전. (따옴표까지 entity 로 변환)
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// HTML 속성 + onclick 안의 JS 문자열 양쪽 컨텍스트에서 안전하게 사용 가능.
// HTML 디코딩 후 JS 문자열 리터럴(작은따옴표) 경계에서 이스케이프 모두 처리.
export function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

export function formatDate(val) {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

export function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

