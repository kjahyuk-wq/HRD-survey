// attendance 폴더 내 공용 헬퍼.
// checkin.js / scan.js / admin-attendance.js 에서 import.
import { Timestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// HTML 본문(텍스트 노드)에 안전하게 출력하기 위한 이스케이프
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// "YYYY-MM-DD" (로컬 시간대 기준 — toISOString 은 UTC 기준이라 KST 자정에 하루 빠지는 버그)
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "YYYY년 M월 D일"
export function formatDisplayDate(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// "YYYY.MM.DD"
export function formatFullDate(s) {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// "M/D"
export function formatShortDate(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Timestamp / Date / number / string → "HH:MM"
export function formatTime(ts) {
  if (!ts) return '';
  const d = ts instanceof Timestamp
    ? ts.toDate()
    : (ts?.toDate ? ts.toDate() : new Date(ts));
  return d.toTimeString().slice(0, 5);
}

// 양력 고정일 + 음력 공휴일(2025/2026 추정치).
// 매년 음력 공휴일은 실제 달력으로 보강 필요.
export function getBuiltinHolidays(year) {
  const y = String(year);
  const fixed = [
    `${y}-01-01`, // 신정
    `${y}-03-01`, // 삼일절
    `${y}-05-05`, // 어린이날
    `${y}-06-06`, // 현충일
    `${y}-08-15`, // 광복절
    `${y}-10-03`, // 개천절
    `${y}-10-09`, // 한글날
    `${y}-12-25`, // 성탄절
  ];
  const lunar = {
    2025: ['2025-01-28', '2025-01-29', '2025-01-30', '2025-05-05', '2025-10-05', '2025-10-06', '2025-10-07'],
    2026: ['2026-02-16', '2026-02-17', '2026-02-18', '2026-05-24', '2026-10-05', '2026-10-06', '2026-10-07'],
  };
  return [...fixed, ...(lunar[year] || [])];
}
