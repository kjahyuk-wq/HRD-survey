// 근태·감점 규칙 — 대전광역시 인재개발원 학칙 [별표 1] 감점 기준표(제11조제1항) 및 제8조③·제10조.
// 순수 함수 모듈 (Firebase 의존 없음) — admin-attendance.js 가 import 하고 node 로 단위 테스트 가능.

// ── 과정 구분 (별표 1 열) ──────────────────────────────
export const TIERS = {
  short: { label: '2주 이하 과정' },
  mid:   { label: '2주 초과 12주 이하 과정' },
  long:  { label: '12주 초과 과정' },
};

// 감점 기준표 [별표 1] (2025.1.17. 개정) — 단위: 결석·외박 = 일, 그 외 = 시간
export const PENALTY_TABLE = {
  //                    2주 이하 | 2주 초과 12주 이하 | 12주 초과
  registrationDelay: { unit: 'hour', short: 1.0,  mid: 0.5,  long: 0.3  },  // 등록지연
  absentUnapproved:  { unit: 'day',  short: 3.0,  mid: 1.5,  long: 2.0  },  // 허가없음 결석·외박
  hourUnapproved:    { unit: 'hour', short: 0.4,  mid: 0.2,  long: 1.0  },  // 허가없음 외출·조퇴·지각·결강
  absentApproved:    { unit: 'day',  short: 1.0,  mid: 0.5,  long: 0.5  },  // 허가받음 결석·외박
  hourApproved:      { unit: 'hour', short: 0.1,  mid: 0.05, long: 0.25 },  // 허가받음 외출·조퇴·지각·결강
};

// 근태 상태 (attendance 기록 status / 허가원 type 공통)
export const STATUS_META = {
  present:   { label: '출석', unit: null },
  absent:    { label: '결석', unit: 'day' },
  overnight: { label: '외박', unit: 'day' },
  late:      { label: '지각', unit: 'hour' },
  leave:     { label: '조퇴', unit: 'hour' },
  outing:    { label: '외출', unit: 'hour' },
  skip:      { label: '결강', unit: 'hour' },
};
export const HOUR_STATUSES = ['late', 'leave', 'outing', 'skip'];
export const DAY_STATUSES = ['absent', 'overnight'];

// 허가 구분
//  approved   허가받음 (허가원 제출 + 원장 허가)
//  unapproved 허가없음 (허가원 제출했으나 허가 못 받음 — 별표1 비고 2)
//  none       무단 (허가원 미제출)
//  pending    심사중 (허가원 제출, 결재 전) — 감점 계산 시 허가없음으로 잠정 처리
//  ''         미기재 (QR 자동 기록 등) — 감점 계산 시 허가없음으로 처리
export const PERMIT_META = {
  approved:   { label: '허가',   short: '허가' },
  unapproved: { label: '미허가', short: '미허가' },
  none:       { label: '무단',   short: '무단' },
  pending:    { label: '심사중', short: '심사중' },
  '':         { label: '—',      short: '' },
};

// 학칙 제8조③ 허가원 사유 각 호
export const REASON_CODES = [
  ['1', '경조사휴가 (복무조례 제18조①)'],
  ['2', '공가 (복무규정 제7조의6)'],
  ['3', '자녀돌봄휴가 (복무규정 제7조의7⑧)'],
  ['4', '업무복귀 필요 (감사·중요행사, 소속부서장 요구)'],
  ['5', '교육 중 불의의 사고·질병'],
  ['6', '본인 대학·대학원 입학식·졸업식·시험'],
  ['7', '그 밖에 원장이 인정하는 경우'],
];
// 제10조 9호 단서: 1호·4호 사유는 퇴교 판정용 불참시간에 포함하지 않음
export const EXPEL_EXEMPT_REASONS = new Set(['1', '4']);

// 점심시간 — 시간 단위 근태 계산에서 제외 (기본 12:00~13:00, 출석 설정의 오전 종료/오후 시작으로 대체 가능)
export const DEFAULT_LUNCH = { start: '12:00', end: '13:00' };

function toMin(t) {
  if (!t || typeof t !== 'string') return NaN;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : NaN;
}
// from~to 분 수에서 점심시간과 겹치는 분을 뺀 값
export function minutesExcludingLunch(fromMin, toMin_, lunch = DEFAULT_LUNCH) {
  if (!Number.isFinite(fromMin) || !Number.isFinite(toMin_) || toMin_ <= fromMin) return 0;
  const ls = toMin(lunch?.start ?? DEFAULT_LUNCH.start), le = toMin(lunch?.end ?? DEFAULT_LUNCH.end);
  let total = toMin_ - fromMin;
  if (Number.isFinite(ls) && Number.isFinite(le) && le > ls) {
    total -= Math.max(0, Math.min(toMin_, le) - Math.max(fromMin, ls));
  }
  return Math.max(0, total);
}

// ── 과정 구분 자동 판정: 첫 수업일 ~ 마지막 수업일 달력 기간 ──
export function computeTier(scheduleDates) {
  const ds = [...(scheduleDates || [])].filter(Boolean).sort();
  if (ds.length < 2) return 'short';
  const span = Math.round((Date.parse(ds[ds.length - 1]) - Date.parse(ds[0])) / 86400000) + 1;
  if (span <= 14) return 'short';
  if (span <= 84) return 'mid';
  return 'long';
}

// ── 허가원 ↔ 날짜·세션 매칭 ──────────────────────────────
export function leaveCovers(leave, date, session) {
  if (!leave || !date) return false;
  const from = leave.dateFrom || leave.date;
  const to = leave.dateTo || from;
  if (!(from <= date && date <= to)) return false;
  const s = leave.sessions || 'all';
  return s === 'all' || !session || session === 'single' || s === session;
}

export function findLeave(leaves, empNo, date, session) {
  const k = String(empNo);
  let best = null;
  for (const l of leaves || []) {
    if (String(l.empNo) !== k || !leaveCovers(l, date, session)) continue;
    // 세션 지정 허가원이 전체 허가원보다 우선, 그 다음 최신 순
    if (!best || (best.sessions === 'all' && l.sessions !== 'all')) best = l;
  }
  return best;
}

// 허가원 decision → permit 값 ('none' = 무단: 허가원 없이 결근·지각 등을 기록만 해 둔 경우)
export function leavePermit(leave) {
  const d = leave?.decision;
  if (d === 'approved' || d === 'unapproved' || d === 'pending' || d === 'none') return d;
  return 'pending';
}

// 'HH:MM' ~ 'HH:MM' 사이 시간 수 (1시간 미만 → 1, 별표1 비고1). 값이 없거나 역순이면 null
export function hoursBetween(from, to, lunch = DEFAULT_LUNCH) {
  const f = toMin(from), t = toMin(to);
  if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f) return null;
  const diff = minutesExcludingLunch(f, t, lunch);
  return Math.max(1, Math.ceil(diff / 60));
}

// 09:00 ~ 18:00, 10분 단위 시각 목록 (필요 시 extra 시각 포함)
export function timeOptions(extra = [], lunch = DEFAULT_LUNCH) {
  const set = new Set();
  const ls = toMin(lunch?.start ?? DEFAULT_LUNCH.start), le = toMin(lunch?.end ?? DEFAULT_LUNCH.end);
  for (let m = 9 * 60; m <= 18 * 60; m += 10) {
    if (m > ls && m < le) continue; // 점심시간 안쪽은 선택 불가
    set.add(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  extra.filter(Boolean).forEach(t => set.add(t));
  return [...set].sort();
}

// ── 유효 근태 계산 (한 학생·날짜·세션) ─────────────────────
// 우선순위: 관리자 수동 기록 > 허가원(+QR 기록 시각) > QR 기록 > 기록 없음
// 반환: { status, permit, hours, time, source, leave, note }
//  source: 'manual' | 'leave' | 'qr' | 'none'
export function resolveEffective({ rec, leave, date, today }) {
  const out = { status: 'absent', permit: '', hours: null, time: '', source: 'none', leave: leave || null, note: '' };

  if (rec && rec.manual) {
    out.source = 'manual';
    out.status = rec.status || 'absent';
    out.permit = rec.permit || '';
    out.hours = numOrNull(rec.hours);
    out.time = rec.manualTime || '';
    if (leave && !out.permit && out.status !== 'present') out.permit = leavePermit(leave);
    return out;
  }

  const qrStatus = rec ? (rec.status || 'present') : null;

  if (leave) {
    const lt = leave.type || 'absent';
    const dayType = DAY_STATUSES.includes(lt);
    if (rec && dayType) {
      // 결석 허가원이 있는데 QR 로 출석 → 실제 출석 우선, 안내만
      out.source = 'qr';
      out.status = qrStatus;
      out.time = rec.checkedAt ? rec.checkedAt : '';
      out.note = '허가원(결석) 있으나 출석';
      return out;
    }
    out.source = 'leave';
    out.status = lt;
    out.permit = leavePermit(leave);
    out.hours = numOrNull(leave.hours);
    if (rec) out.time = rec.checkedAt ? rec.checkedAt : '';
    return out;
  }

  if (rec) {
    out.source = 'qr';
    out.status = qrStatus;
    out.permit = rec.permit || '';
    out.time = rec.checkedAt ? rec.checkedAt : '';
    return out;
  }

  return out; // 기록 없음 → absent / permit ''
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 시각(HH:MM 또는 Date/ms) → 세션 시작 대비 지각 시간 (1시간 미만은 1시간, 별표1 비고 1)
export function lateHours(timeVal, sessionStart, lunch = DEFAULT_LUNCH) {
  if (!timeVal || !sessionStart) return 1;
  let minutes;
  if (typeof timeVal === 'string') {
    const [h, m] = timeVal.split(':').map(Number);
    if (!Number.isFinite(h)) return 1;
    minutes = h * 60 + (m || 0);
  } else {
    // Date | ms | Firestore Timestamp(toDate/toMillis)
    let d;
    if (timeVal instanceof Date) d = timeVal;
    else if (typeof timeVal?.toDate === 'function') d = timeVal.toDate();
    else if (typeof timeVal?.toMillis === 'function') d = new Date(timeVal.toMillis());
    else d = new Date(timeVal);
    if (Number.isNaN(d.getTime())) return 1;
    minutes = d.getHours() * 60 + d.getMinutes();
  }
  const diff = minutesExcludingLunch(toMin(sessionStart), minutes, lunch);
  if (!Number.isFinite(diff) || diff <= 0) return 1;
  return Math.max(1, Math.ceil(diff / 60));
}

// ── 감점 집계 ──────────────────────────────
// students: [{empNo, name}], dates: 수업일(휴강 제외, 오름차순), sessionKeys: ['single'] | ['morning','afternoon']
// getEffective(empNo, date, sess) → resolveEffective 결과
// opts: { tier, today, sessionStarts: {single|morning|afternoon: 'HH:MM'} }
export function computePenalties({ students, dates, sessionKeys, getEffective, tier, today, sessionStarts = {}, lunch = DEFAULT_LUNCH }) {
  const T = PENALTY_TABLE;
  const perSession = sessionKeys.length || 1;
  const firstDate = dates[0];
  const countedDates = dates.filter(d => d <= today);

  return students.map(stu => {
    const r = {
      empNo: stu.empNo, name: stu.name,
      absentApprovedDays: 0, absentUnapprovedDays: 0, absentNoneDays: 0,
      hourApproved: 0, hourUnapproved: 0,
      registrationDelayHours: 0,
      exemptAbsentDays: 0, // 제10조 9호 단서 (1호·4호) — 퇴교 불참시간 산정 제외
      items: [],           // 상세 [{date, session, status, permit, hours, source, penalty}]
      warnings: [],
    };

    for (const d of countedDates) {
      for (const sess of sessionKeys) {
        const eff = getEffective(stu.empNo, d, sess) || {};
        const st = eff.status || 'absent';
        if (st === 'present') continue;
        // 오늘 날짜에 기록이 전혀 없으면 아직 미출석(진행 중) — 무단결석으로 확정하지 않음
        if (d === today && eff.source === 'none') continue;

        const approved = eff.permit === 'approved';
        const reason = eff.leave?.reasonCode;
        let penalty = 0;
        let hours = null;

        if (DAY_STATUSES.includes(st)) {
          const days = 1 / perSession;
          if (approved) { r.absentApprovedDays += days; penalty = T.absentApproved[tier] * days; }
          else {
            r.absentUnapprovedDays += days; penalty = T.absentUnapproved[tier] * days;
            if (!eff.permit || eff.permit === 'none') r.absentNoneDays += days;
          }
          if (approved && EXEMPT_ABSENT(reason)) r.exemptAbsentDays += days;
        } else if (HOUR_STATUSES.includes(st)) {
          hours = eff.hours;
          if (hours == null) {
            hours = st === 'late' ? lateHours(eff.time, sessionStarts[sess] || sessionStarts.single || '09:00', lunch) : 1;
          }
          hours = Number.isFinite(hours) ? Math.max(1, Math.ceil(hours)) : 1;
          if (st === 'late' && d === firstDate) {
            // 입교일 지각 = 등록지연 (제6조·별표1 비고1)
            r.registrationDelayHours += hours;
            penalty = T.registrationDelay[tier] * hours;
            if (!approved && hours >= 4) r.warnings.push('입교일 4시간 이상 무단 지각 (제10조 10호)');
          } else if (approved) { r.hourApproved += hours; penalty = T.hourApproved[tier] * hours; }
          else { r.hourUnapproved += hours; penalty = T.hourUnapproved[tier] * hours; }
        } else {
          continue;
        }
        r.items.push({ date: d, session: sess, status: st, permit: eff.permit || '', hours, source: eff.source, penalty: round2(penalty), reasonCode: reason || '' });
      }
    }

    r.total = round2(r.items.reduce((s, i) => s + i.penalty, 0));

    // 퇴교 사유 경고
    if (r.absentNoneDays > 0) r.warnings.push('허가원 없이 결석·외박 (제10조 2호)');
    const totalDays = countedDates.length;
    if (totalDays > 0) {
      // 불참 일수 근사: 결석일(면제 사유 제외) + 시간단위 합/8
      const missDays = (r.absentApprovedDays + r.absentUnapprovedDays - r.exemptAbsentDays)
        + (r.hourApproved + r.hourUnapproved) / 8;
      r.missRatio = missDays / totalDays;
      const limit = tier === 'long' ? 1 / 20 : 1 / 3;
      if (r.missRatio >= limit - 1e-9) {
        r.warnings.push(`총 교육시간의 ${tier === 'long' ? '1/20' : '1/3'} 이상 불참 (제10조 9호)`);
      }
    } else {
      r.missRatio = 0;
    }
    return r;
  });
}

function EXEMPT_ABSENT(reason) { return reason && EXPEL_EXEMPT_REASONS.has(String(reason)); }
function round2(n) { return Math.round(n * 100) / 100; }
