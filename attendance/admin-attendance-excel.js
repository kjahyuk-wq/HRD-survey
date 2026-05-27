// 출석부 Excel 내보내기 — "요약 + 주차별 상세" 시트 구조.
// 첨부 디자인(녹색 #00944D 헤더, 5일/주 단위 분할, 결재란)을 재현.
// xlsx-js-style 의 XLSX 글로벌을 사용 (SheetJS Community 는 셀 스타일 미지원).
//
// TODO[조퇴]: 현재 출결 시스템은 조퇴 시각 입력 UI 가 없음.
//   - 모든 조퇴 카운트는 0 (요약/주차 모두)
//   - 혼합 일(일부 세션 출석 + 일부 세션 결석)은 보수적으로 "결석" 처리
//   - 조퇴 입력 UI 추가 시 collapseDayStatus / aggregateStudent 의 분기 보강 필요

import { formatTime, formatFullDate, toDateStr } from './utils.js';

const COLOR = {
  GREEN:       '00944D',
  GREEN_LIGHT: 'D9EAD3',
  YELLOW:      'FFE699',
  ORANGE:      'F9CB9C',
  RED:         'EA9999',
  STRIPE:      'FAFAFA',
  WHITE:       'FFFFFF',
  BORDER:      'BFBFBF',
  TEXT_RED:    'C00000',
};
const FONT = '맑은 고딕';

// ── 스타일 빌더 ───────────────────────────────────────────
function border(rgb = COLOR.BORDER, style = 'thin') {
  const b = { style, color: { rgb } };
  return { top: b, bottom: b, left: b, right: b };
}
function font(opts = {}) {
  return { name: FONT, sz: 10, color: { rgb: '000000' }, ...opts };
}
function fill(rgb) {
  return { patternType: 'solid', fgColor: { rgb }, bgColor: { rgb } };
}
const ALIGN_CENTER = { horizontal: 'center', vertical: 'center', wrapText: true };

// 자주 쓰는 스타일 묶음
const S = {
  title: {
    font: font({ bold: true, sz: 16, color: { rgb: COLOR.WHITE } }),
    fill: fill(COLOR.GREEN),
    alignment: ALIGN_CENTER,
    border: border(COLOR.GREEN, 'medium'),
  },
  kpiLabel: {
    font: font({ bold: true, sz: 10, color: { rgb: '1F1F1F' } }),
    fill: fill(COLOR.GREEN_LIGHT),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  kpiValue: {
    font: font({ bold: true, sz: 11 }),
    fill: fill(COLOR.WHITE),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  sectionHeader: {
    font: font({ bold: true, sz: 11, color: { rgb: COLOR.WHITE } }),
    fill: fill(COLOR.GREEN),
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    border: border(COLOR.GREEN),
  },
  chipLate: {
    font: font({ bold: true, sz: 9 }),
    fill: fill(COLOR.YELLOW),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  chipLeave: {
    font: font({ bold: true, sz: 9 }),
    fill: fill(COLOR.ORANGE),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  chipAbsent: {
    font: font({ bold: true, sz: 9 }),
    fill: fill(COLOR.RED),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  tableHeader: {
    font: font({ bold: true, sz: 10.5, color: { rgb: COLOR.WHITE } }),
    fill: fill(COLOR.GREEN),
    alignment: ALIGN_CENTER,
    border: border(COLOR.GREEN),
  },
  subHeader: {
    font: font({ bold: true, sz: 9.5 }),
    fill: fill(COLOR.GREEN_LIGHT),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  cellEven: {
    font: font({ sz: 10 }),
    fill: fill(COLOR.WHITE),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  cellOdd: {
    font: font({ sz: 10 }),
    fill: fill(COLOR.STRIPE),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  cellLeftEven: {
    font: font({ sz: 10 }),
    fill: fill(COLOR.WHITE),
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    border: border(),
  },
  cellLeftOdd: {
    font: font({ sz: 10 }),
    fill: fill(COLOR.STRIPE),
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    border: border(),
  },
  statusLate: {
    font: font({ bold: true, sz: 10 }),
    fill: fill(COLOR.YELLOW),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  statusLeave: {
    font: font({ bold: true, sz: 10 }),
    fill: fill(COLOR.ORANGE),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  statusAbsent: {
    font: font({ bold: true, sz: 10 }),
    fill: fill(COLOR.RED),
    alignment: ALIGN_CENTER,
    border: border(),
  },
  rateBad: {
    font: font({ bold: true, sz: 10, color: { rgb: COLOR.TEXT_RED } }),
    fill: fill(COLOR.WHITE),
    alignment: ALIGN_CENTER,
    border: border(),
    numFmt: '0%',
  },
  rateBadStripe: {
    font: font({ bold: true, sz: 10, color: { rgb: COLOR.TEXT_RED } }),
    fill: fill(COLOR.STRIPE),
    alignment: ALIGN_CENTER,
    border: border(),
    numFmt: '0%',
  },
  rateGood: {
    font: font({ sz: 10 }),
    fill: fill(COLOR.WHITE),
    alignment: ALIGN_CENTER,
    border: border(),
    numFmt: '0%',
  },
  rateGoodStripe: {
    font: font({ sz: 10 }),
    fill: fill(COLOR.STRIPE),
    alignment: ALIGN_CENTER,
    border: border(),
    numFmt: '0%',
  },
  signLine: {
    font: font({ sz: 11 }),
    alignment: { horizontal: 'right', vertical: 'center', indent: 2 },
  },
};

// ── 데이터 집계 ───────────────────────────────────────────
function recTime(rec) {
  if (!rec) return '';
  if (rec.manual) return rec.manualTime || '';
  return rec.checkedAt ? formatTime(rec.checkedAt) : '';
}

// 그 날의 세션 기록들을 하루 단위 status/시각으로 collapse.
// 우선순위: (조퇴 UI 미구현 → 혼합일은 결석 처리)
//   - all absent (or 기록 없음)            → absent
//   - any 'leave'                          → leave  (출근→  / 시각 미입력)
//   - any 'late'                           → late   (지각 도착 시각)
//   - 모든 세션 present (혼합 아님)         → present (출근 시각)
//   - 그 외 혼합                            → absent (TODO: 조퇴 UI 추가 시 분기 보강)
function collapseDayStatus(sessRecords, sessionCount) {
  const recs = sessRecords.filter(Boolean);
  const allAbsent = recs.length === 0 || recs.every(r => (r.status || 'present') === 'absent');
  if (allAbsent) return { status: 'absent', timeStr: '' };

  const leaveRec = recs.find(r => r.status === 'leave');
  if (leaveRec) {
    const arr = recs.find(r => (r.status || 'present') !== 'absent' && (r.status || 'present') !== 'leave');
    const arrTime = recTime(arr || leaveRec);
    return { status: 'leave', timeStr: arrTime ? `${arrTime}→` : '' };
  }

  const lateRec = recs.find(r => r.status === 'late');
  if (lateRec) return { status: 'late', timeStr: recTime(lateRec) };

  const allPresent =
    recs.length === sessionCount &&
    recs.every(r => (r.status || 'present') === 'present');
  if (allPresent) return { status: 'present', timeStr: recTime(recs[0]) };

  return { status: 'absent', timeStr: '' };
}

// 학생 한 명의 (전체 기간) 출석/지각/조퇴/결석 카운트 + 일별 결과
function aggregateStudent(stu, dates, sessionKeys, attendanceIndex) {
  const days = dates.map(d => {
    const sessRecs = sessionKeys.map(s =>
      attendanceIndex.get(`${stu.empNo}_${d}_${s}`) || null
    );
    return { date: d, ...collapseDayStatus(sessRecs, sessionKeys.length) };
  });
  const c = { present: 0, late: 0, leave: 0, absent: 0 };
  days.forEach(d => { c[d.status] = (c[d.status] || 0) + 1; });
  return { days, counts: c };
}

function buildRemark(c) {
  const parts = [];
  if (c.absent) parts.push(`결석 ${c.absent}회`);
  if (c.leave)  parts.push(`조퇴 ${c.leave}회`);
  if (c.late)   parts.push(`지각 ${c.late}회`);
  return parts.join(', ');
}

// 5일/주 단위 분할 (실제 수업일 기준 — 휴일은 호출자가 이미 제거)
function chunkByWeek(dates, perWeek = 5) {
  const out = [];
  for (let i = 0; i < dates.length; i += perWeek) out.push(dates.slice(i, i + perWeek));
  return out;
}

// ── 시트 빌더 ───────────────────────────────────────────
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function shortDateLabel(s) {
  const d = new Date(s + 'T00:00:00');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}.${dd} (${DOW[d.getDay()]})`;
}
function shortRange(dates) {
  if (!dates.length) return '';
  const f = (s) => {
    const d = new Date(s + 'T00:00:00');
    return `${d.getMonth() + 1}.${d.getDate()}`;
  };
  return `${f(dates[0])}~${f(dates[dates.length - 1])}`;
}

// 워크시트 객체에 cell 을 설정. 빈 셀에도 스타일 적용 가능하도록 보조.
function setCell(ws, addr, value, style, type) {
  if (value === undefined || value === null || value === '') {
    ws[addr] = { v: '', t: 's', s: style };
  } else {
    ws[addr] = { v: value, t: type || (typeof value === 'number' ? 'n' : 's'), s: style };
    if (style && style.numFmt) ws[addr].z = style.numFmt;
  }
}
function ref(r, c) { return XLSX.utils.encode_cell({ r, c }); }

// ── 요약 시트 ───────────────────────────────────────────
function buildSummarySheet(ctx) {
  const { courseName, periodStr, students, totalDays,
    totals, handlerName, managerName } = ctx;

  const COLS = 9; // A~I
  const ws = {};
  const merges = [];
  const rows = [];

  const pushRow = (h) => { rows.push({ hpt: h }); return rows.length - 1; };

  // Row 1: title (h=38)
  const R_TITLE = pushRow(38);
  setCell(ws, ref(R_TITLE, 0), `${courseName}  출 석 부`, S.title);
  merges.push({ s: { r: R_TITLE, c: 0 }, e: { r: R_TITLE, c: COLS - 1 } });

  pushRow(6); // spacer

  // Row 3: KPI labels (h=22)
  const R_KPI_LBL = pushRow(22);
  setCell(ws, ref(R_KPI_LBL, 0), '교육기간', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 1), '', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 2), '교육생', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 3), '출석', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 4), '지각', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 5), '조퇴', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 6), '결석', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 7), '출석률', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 8), '', S.kpiLabel);
  merges.push({ s: { r: R_KPI_LBL, c: 0 }, e: { r: R_KPI_LBL, c: 1 } });
  merges.push({ s: { r: R_KPI_LBL, c: 7 }, e: { r: R_KPI_LBL, c: 8 } });

  // Row 4: KPI values (h=28)
  const R_KPI_VAL = pushRow(28);
  const ratePct = totals.totalSlots > 0
    ? (totals.present + totals.late + totals.leave) / totals.totalSlots
    : 0;
  setCell(ws, ref(R_KPI_VAL, 0), periodStr, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 1), '', S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 2), `${students.length}명`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 3), `${totals.present}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 4), `${totals.late}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 5), `${totals.leave}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 6), `${totals.absent}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 7), `${(ratePct * 100).toFixed(1)}%`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 8), '', S.kpiValue);
  merges.push({ s: { r: R_KPI_VAL, c: 0 }, e: { r: R_KPI_VAL, c: 1 } });
  merges.push({ s: { r: R_KPI_VAL, c: 7 }, e: { r: R_KPI_VAL, c: 8 } });

  pushRow(10); // spacer

  // Row 6: section header + chips (h=24)
  const R_SEC = pushRow(24);
  setCell(ws, ref(R_SEC, 0), '■ 교육생별 출석 현황', S.sectionHeader);
  setCell(ws, ref(R_SEC, 1), '', S.sectionHeader);
  setCell(ws, ref(R_SEC, 2), '', S.sectionHeader);
  setCell(ws, ref(R_SEC, 3), '', S.sectionHeader);
  setCell(ws, ref(R_SEC, 4), '■ 지각', S.chipLate);
  setCell(ws, ref(R_SEC, 5), '', S.chipLate);
  setCell(ws, ref(R_SEC, 6), '■ 조퇴', S.chipLeave);
  setCell(ws, ref(R_SEC, 7), '■ 결석', S.chipAbsent);
  setCell(ws, ref(R_SEC, 8), '', S.chipAbsent);
  merges.push({ s: { r: R_SEC, c: 0 }, e: { r: R_SEC, c: 3 } });
  merges.push({ s: { r: R_SEC, c: 4 }, e: { r: R_SEC, c: 5 } });
  merges.push({ s: { r: R_SEC, c: 7 }, e: { r: R_SEC, c: 8 } });

  // Row 7: table header (h=28)
  const R_HDR = pushRow(28);
  ['교번', '이름', '총 일수', '출석', '지각', '조퇴', '결석', '출석률', '비고']
    .forEach((label, i) => setCell(ws, ref(R_HDR, i), label, S.tableHeader));

  // Rows 8..: students
  const R_DATA_START = rows.length;
  students.forEach((stu, idx) => {
    const r = pushRow(19);
    const odd = idx % 2 === 1;
    const base = odd ? S.cellOdd : S.cellEven;
    const baseLeft = odd ? S.cellLeftOdd : S.cellLeftEven;
    const c = stu._counts;
    const attended = c.present + c.late + c.leave;
    const rate = totalDays > 0 ? attended / totalDays : 0;
    const isFull = rate >= 1 - 1e-9;
    const rateStyle = isFull
      ? (odd ? S.rateGoodStripe : S.rateGood)
      : (odd ? S.rateBadStripe : S.rateBad);

    setCell(ws, ref(r, 0), idx + 1, base, 'n');
    setCell(ws, ref(r, 1), stu.name || '', baseLeft);
    setCell(ws, ref(r, 2), totalDays, base, 'n');
    setCell(ws, ref(r, 3), c.present, base, 'n');
    setCell(ws, ref(r, 4), c.late, c.late > 0 ? S.statusLate : base, 'n');
    setCell(ws, ref(r, 5), c.leave, c.leave > 0 ? S.statusLeave : base, 'n');
    setCell(ws, ref(r, 6), c.absent, c.absent > 0 ? S.statusAbsent : base, 'n');
    setCell(ws, ref(r, 7), rate, rateStyle, 'n');
    setCell(ws, ref(r, 8), buildRemark(c), baseLeft);
  });

  // Signature lines (요약 시트만)
  pushRow(8);
  const R_WRITER = pushRow(28);
  const writer = handlerName ? `작성자: ${handlerName}   (인)` : '작성자:                (인)';
  setCell(ws, ref(R_WRITER, 0), writer, S.signLine);
  merges.push({ s: { r: R_WRITER, c: 0 }, e: { r: R_WRITER, c: COLS - 1 } });

  const R_APPROVER = pushRow(28);
  const approver = managerName ? `결재자: ${managerName}   (인)` : '결재자:                (인)';
  setCell(ws, ref(R_APPROVER, 0), approver, S.signLine);
  merges.push({ s: { r: R_APPROVER, c: 0 }, e: { r: R_APPROVER, c: COLS - 1 } });

  ws['!ref'] = `A1:${ref(rows.length - 1, COLS - 1)}`;
  ws['!cols'] = [6, 12, 9, 8, 8, 8, 8, 10, 14].map(w => ({ wch: w }));
  ws['!rows'] = rows;
  ws['!merges'] = merges;
  ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  // 인쇄 반복 행은 진입점에서 _xlnm.Print_Titles 정의명으로 등록. 헤더 행 수만 expose.
  ws['!printHeader'] = [ 1, R_HDR + 1 ];
  return ws;
}

// ── 주차 시트 ───────────────────────────────────────────
function buildWeekSheet(ctx, weekIdx, weekDates) {
  const { courseName, sessionKeys, students, attendanceIndex } = ctx;
  const N = weekDates.length; // 1..5
  const COLS = 2 + N * 2 + 1; // 교번 + 이름 + N×(상태+시각) + 주간출석률
  const ws = {};
  const merges = [];
  const rows = [];
  const pushRow = (h) => { rows.push({ hpt: h }); return rows.length - 1; };

  // Row 1: title
  const R_TITLE = pushRow(36);
  const weekLabel = `${weekIdx + 1}주차 (${shortRange(weekDates)})`;
  setCell(ws, ref(R_TITLE, 0), `${courseName}  출 석 부   |   ${weekLabel}`, S.title);
  merges.push({ s: { r: R_TITLE, c: 0 }, e: { r: R_TITLE, c: COLS - 1 } });

  pushRow(6); // spacer

  // Row 3~4: 주차 단위 KPI
  let weekPresent = 0, weekLate = 0, weekLeave = 0, weekAbsent = 0;
  const studentWeekDays = students.map(stu => {
    const days = weekDates.map(d => {
      const sessRecs = sessionKeys.map(s =>
        attendanceIndex.get(`${stu.empNo}_${d}_${s}`) || null
      );
      return collapseDayStatus(sessRecs, sessionKeys.length);
    });
    days.forEach(d => {
      if (d.status === 'present') weekPresent++;
      else if (d.status === 'late') weekLate++;
      else if (d.status === 'leave') weekLeave++;
      else weekAbsent++;
    });
    return days;
  });
  const weekTotal = students.length * N;
  const weekRate = weekTotal > 0 ? (weekPresent + weekLate + weekLeave) / weekTotal : 0;

  const R_KPI_LBL = pushRow(22);
  const R_KPI_VAL = pushRow(26);
  // 분할: 교육기간(A:C), 교육생(D:E), 출석(F:G), 지각, 조퇴, 결석, 출석률(끝 3칸)
  const COL_LAST = COLS - 1;
  setCell(ws, ref(R_KPI_LBL, 0), '교육기간', S.kpiLabel);
  for (let i = 1; i <= 2; i++) setCell(ws, ref(R_KPI_LBL, i), '', S.kpiLabel);
  merges.push({ s: { r: R_KPI_LBL, c: 0 }, e: { r: R_KPI_LBL, c: 2 } });
  setCell(ws, ref(R_KPI_LBL, 3), '교육생', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 4), '', S.kpiLabel);
  merges.push({ s: { r: R_KPI_LBL, c: 3 }, e: { r: R_KPI_LBL, c: 4 } });
  setCell(ws, ref(R_KPI_LBL, 5), '출석', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 6), '', S.kpiLabel);
  merges.push({ s: { r: R_KPI_LBL, c: 5 }, e: { r: R_KPI_LBL, c: 6 } });
  setCell(ws, ref(R_KPI_LBL, 7), '지각', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 8), '조퇴', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 9), '결석', S.kpiLabel);
  setCell(ws, ref(R_KPI_LBL, 10), '출석률', S.kpiLabel);
  for (let i = 11; i <= COL_LAST; i++) setCell(ws, ref(R_KPI_LBL, i), '', S.kpiLabel);
  if (COL_LAST > 10) merges.push({ s: { r: R_KPI_LBL, c: 10 }, e: { r: R_KPI_LBL, c: COL_LAST } });

  setCell(ws, ref(R_KPI_VAL, 0), `${formatFullDate(weekDates[0])} ~ ${formatFullDate(weekDates[N - 1])}`, S.kpiValue);
  for (let i = 1; i <= 2; i++) setCell(ws, ref(R_KPI_VAL, i), '', S.kpiValue);
  merges.push({ s: { r: R_KPI_VAL, c: 0 }, e: { r: R_KPI_VAL, c: 2 } });
  setCell(ws, ref(R_KPI_VAL, 3), `${students.length}명`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 4), '', S.kpiValue);
  merges.push({ s: { r: R_KPI_VAL, c: 3 }, e: { r: R_KPI_VAL, c: 4 } });
  setCell(ws, ref(R_KPI_VAL, 5), `${weekPresent}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 6), '', S.kpiValue);
  merges.push({ s: { r: R_KPI_VAL, c: 5 }, e: { r: R_KPI_VAL, c: 6 } });
  setCell(ws, ref(R_KPI_VAL, 7), `${weekLate}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 8), `${weekLeave}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 9), `${weekAbsent}건`, S.kpiValue);
  setCell(ws, ref(R_KPI_VAL, 10), `${(weekRate * 100).toFixed(1)}%`, S.kpiValue);
  for (let i = 11; i <= COL_LAST; i++) setCell(ws, ref(R_KPI_VAL, i), '', S.kpiValue);
  if (COL_LAST > 10) merges.push({ s: { r: R_KPI_VAL, c: 10 }, e: { r: R_KPI_VAL, c: COL_LAST } });

  // Row 5: 범례 chips
  const R_LEGEND = pushRow(18);
  for (let i = 0; i < COLS; i++) setCell(ws, ref(R_LEGEND, i), '', { fill: fill(COLOR.WHITE) });
  // 지각 / 조퇴 / 결석 칩을 적당히 배치 (3,4 / 5,6,7 / 8,9)
  if (COL_LAST >= 9) {
    setCell(ws, ref(R_LEGEND, 3), '■ 지각', S.chipLate);
    setCell(ws, ref(R_LEGEND, 4), '', S.chipLate);
    merges.push({ s: { r: R_LEGEND, c: 3 }, e: { r: R_LEGEND, c: 4 } });
    setCell(ws, ref(R_LEGEND, 5), '■ 조퇴 (출근시각→조퇴시각)', S.chipLeave);
    setCell(ws, ref(R_LEGEND, 6), '', S.chipLeave);
    setCell(ws, ref(R_LEGEND, 7), '', S.chipLeave);
    merges.push({ s: { r: R_LEGEND, c: 5 }, e: { r: R_LEGEND, c: 7 } });
    setCell(ws, ref(R_LEGEND, 8), '■ 결석', S.chipAbsent);
    setCell(ws, ref(R_LEGEND, 9), '', S.chipAbsent);
    merges.push({ s: { r: R_LEGEND, c: 8 }, e: { r: R_LEGEND, c: 9 } });
  }

  // Row 6~7: table header (2-row, day spans 2 cols)
  const R_HDR1 = pushRow(24);
  const R_HDR2 = pushRow(22);
  setCell(ws, ref(R_HDR1, 0), '교번', S.tableHeader);
  setCell(ws, ref(R_HDR2, 0), '', S.tableHeader);
  merges.push({ s: { r: R_HDR1, c: 0 }, e: { r: R_HDR2, c: 0 } });
  setCell(ws, ref(R_HDR1, 1), '이름', S.tableHeader);
  setCell(ws, ref(R_HDR2, 1), '', S.tableHeader);
  merges.push({ s: { r: R_HDR1, c: 1 }, e: { r: R_HDR2, c: 1 } });

  for (let i = 0; i < N; i++) {
    const cStatus = 2 + i * 2;
    const cTime = cStatus + 1;
    setCell(ws, ref(R_HDR1, cStatus), shortDateLabel(weekDates[i]), S.tableHeader);
    setCell(ws, ref(R_HDR1, cTime), '', S.tableHeader);
    merges.push({ s: { r: R_HDR1, c: cStatus }, e: { r: R_HDR1, c: cTime } });
    setCell(ws, ref(R_HDR2, cStatus), '상태', S.subHeader);
    setCell(ws, ref(R_HDR2, cTime), '시각', S.subHeader);
  }
  setCell(ws, ref(R_HDR1, COL_LAST), '주간\n출석률', S.tableHeader);
  setCell(ws, ref(R_HDR2, COL_LAST), '', S.tableHeader);
  merges.push({ s: { r: R_HDR1, c: COL_LAST }, e: { r: R_HDR2, c: COL_LAST } });

  // Data rows
  students.forEach((stu, idx) => {
    const r = pushRow(19);
    const odd = idx % 2 === 1;
    const base = odd ? S.cellOdd : S.cellEven;
    const baseLeft = odd ? S.cellLeftOdd : S.cellLeftEven;
    const days = studentWeekDays[idx];
    setCell(ws, ref(r, 0), idx + 1, base, 'n');
    setCell(ws, ref(r, 1), stu.name || '', baseLeft);
    let attended = 0;
    for (let i = 0; i < N; i++) {
      const cStatus = 2 + i * 2;
      const cTime = cStatus + 1;
      const day = days[i];
      let statusStyle = base;
      let statusLabel = '출석';
      if (day.status === 'late')   { statusStyle = S.statusLate;   statusLabel = '지각'; attended++; }
      else if (day.status === 'leave') { statusStyle = S.statusLeave; statusLabel = '조퇴'; attended++; }
      else if (day.status === 'absent') { statusStyle = S.statusAbsent; statusLabel = '결석'; }
      else { attended++; }
      setCell(ws, ref(r, cStatus), statusLabel, statusStyle);
      setCell(ws, ref(r, cTime), day.timeStr, day.timeStr ? base : (day.status === 'absent' ? base : base));
    }
    const rate = N > 0 ? attended / N : 0;
    const isFull = rate >= 1 - 1e-9;
    const rateStyle = isFull
      ? (odd ? S.rateGoodStripe : S.rateGood)
      : (odd ? S.rateBadStripe : S.rateBad);
    setCell(ws, ref(r, COL_LAST), rate, rateStyle, 'n');
  });

  ws['!ref'] = `A1:${ref(rows.length - 1, COLS - 1)}`;
  // 컬럼 너비: 교번 5.5, 이름 11, [상태 7.5, 시각 13]×N, 주간출석률 9.5
  const cols = [{ wch: 5.5 }, { wch: 11 }];
  for (let i = 0; i < N; i++) cols.push({ wch: 7.5 }, { wch: 13 });
  cols.push({ wch: 9.5 });
  ws['!cols'] = cols;
  ws['!rows'] = rows;
  ws['!merges'] = merges;
  ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  ws['!printHeader'] = [ 1, R_HDR2 + 1 ];
  return ws;
}

// ── pageSetup 후처리 (xlsx-js-style 미지원 우회) ─────────
// xlsx-js-style 은 sheetPr/pageSetup/printOptions 를 출력 XML 에 쓰지 않음.
// 출력 zip 을 fflate 로 풀어 워크시트 XML 에 직접 주입.
// OOXML schema 순서를 엄격히 지켜야 Excel 이 거부하지 않음:
//   sheetPr → dimension → sheetViews → sheetFormatPr → cols → sheetData → ...
//   → mergeCells → printOptions → pageMargins → pageSetup → headerFooter → ignoredErrors
function patchPageSetup(arrayBuffer, sheetOrientations) {
  if (typeof fflate === 'undefined') {
    console.warn('[excel] fflate 미로드 — pageSetup 주입 생략. 인쇄 시 가로/맞춤 수동 설정 필요.');
    return new Uint8Array(arrayBuffer);
  }
  const files = fflate.unzipSync(new Uint8Array(arrayBuffer));
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  for (let i = 0; i < sheetOrientations.length; i++) {
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    if (!files[sheetPath]) continue;
    let xml = dec.decode(files[sheetPath]);

    // 1) sheetPr (fitToPage="1") — <worksheet ...> 직후, dimension 앞에 삽입
    if (!/<sheetPr[\s>]/.test(xml)) {
      xml = xml.replace(
        /(<worksheet\b[^>]*>)/,
        '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
      );
    }

    // 2) printOptions — <pageMargins/> 앞에 삽입
    if (!/<printOptions[\s/>]/.test(xml)) {
      xml = xml.replace(
        /<pageMargins\b/,
        '<printOptions horizontalCentered="1"/><pageMargins'
      );
    }

    // 3) pageSetup — <pageMargins .../> 바로 뒤에 삽입
    const orient = sheetOrientations[i];
    const pageSetupXml = `<pageSetup orientation="${orient}" paperSize="9" fitToHeight="1" fitToWidth="1"/>`;
    if (!/<pageSetup[\s/>]/.test(xml)) {
      xml = xml.replace(
        /(<pageMargins\b[^/]*\/>)/,
        `$1${pageSetupXml}`
      );
    }

    files[sheetPath] = enc.encode(xml);
  }
  return fflate.zipSync(files);
}

function triggerDownload(uint8, fname) {
  const blob = new Blob([uint8], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 진입점 ───────────────────────────────────────────
// ctx 필수: { courseName, students(name/empNo 정렬됨), dates(휴일 제외 정렬), sessionKeys, attendanceIndex, handlerName, managerName }
export function exportAttendanceWorkbook(ctx) {
  if (typeof XLSX === 'undefined') {
    throw new Error('XLSX 가 로드되지 않았습니다. xlsx-js-style 스크립트를 먼저 포함해 주세요.');
  }
  const { courseName, students, dates, sessionKeys, attendanceIndex,
    handlerName, managerName } = ctx;

  if (!students.length) throw new Error('등록된 교육생이 없습니다.');
  if (!dates.length) throw new Error('수업일이 없습니다.');

  // 학생별 집계 (요약 + 비고용)
  const studentsAgg = students.map(stu => {
    const agg = aggregateStudent(stu, dates, sessionKeys, attendanceIndex);
    return { ...stu, _counts: agg.counts, _days: agg.days };
  });

  const totals = studentsAgg.reduce((acc, s) => {
    acc.present += s._counts.present;
    acc.late    += s._counts.late;
    acc.leave   += s._counts.leave;
    acc.absent  += s._counts.absent;
    return acc;
  }, { present: 0, late: 0, leave: 0, absent: 0 });
  totals.totalSlots = students.length * dates.length;

  const periodStr = `${formatFullDate(dates[0])} ~ ${formatFullDate(dates[dates.length - 1])}`;

  const wb = XLSX.utils.book_new();
  const orientations = [];

  const summaryCtx = {
    courseName, periodStr,
    students: studentsAgg, totalDays: dates.length,
    totals, handlerName, managerName,
  };
  const summaryWs = buildSummarySheet(summaryCtx);
  XLSX.utils.book_append_sheet(wb, summaryWs, '요약');
  orientations.push('portrait');

  const weeks = chunkByWeek(dates, 5);
  const weekCtx = { courseName, students: studentsAgg, sessionKeys, attendanceIndex };
  weeks.forEach((weekDates, wi) => {
    const name = `${wi + 1}주차 (${shortRange(weekDates)})`;
    const ws = buildWeekSheet(weekCtx, wi, weekDates);
    XLSX.utils.book_append_sheet(wb, ws, name);
    orientations.push('landscape');
  });

  // 인쇄 영역 / 반복 행 (시트 이름 기준으로 설정)
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Names) wb.Workbook.Names = [];
  wb.SheetNames.forEach((sheetName, sIdx) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const hdrRowCount = ws['!printHeader'] ? ws['!printHeader'][1] : 7;
    const last = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).e : null;
    if (!last) return;
    const quoted = `'${sheetName.replace(/'/g, "''")}'`;
    wb.Workbook.Names.push({
      Name: '_xlnm.Print_Titles',
      Ref: `${quoted}!$1:$${hdrRowCount}`,
      Sheet: sIdx,
    });
    wb.Workbook.Names.push({
      Name: '_xlnm.Print_Area',
      Ref: `${quoted}!$A$1:$${XLSX.utils.encode_col(last.c)}$${last.r + 1}`,
      Sheet: sIdx,
    });
  });

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const patched = patchPageSetup(buf, orientations);
  const fname = `출석부_${courseName}_${toDateStr(new Date())}.xlsx`;
  triggerDownload(patched, fname);
}
