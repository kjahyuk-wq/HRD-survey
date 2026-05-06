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

// 모듈 간 공유 상태 (ES 모듈 싱글톤으로 공유됨)
export const state = {
  courseIdMap: {},
  courseActive: {},  // name → boolean (false면 종료된 과정)
  lastResponses: [],
  lastCourseName: '',
  lastOrderedInstructorKeys: [],
  lastComputedStats: null,
};

// 유틸 함수
export function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

export function formatDateTimeSec(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
