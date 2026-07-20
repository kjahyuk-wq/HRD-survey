import { state, escapeHtml, getSurveyConfig, NC_SURVEY } from './admin-utils.js';
import { computeStats } from './admin-stats.js';

// ── 라벨 헬퍼 ──────────────────────────────
// state.lastRoundLabel/lastGroupLabel은 중견리더 과정에서만 채워짐. 단기는 빈 문자열.
// lastGroupLabel 은 카테고리 필터 (예: '체련활동') — 미선택 시 빈 문자열.
function getExportCourseLabel() {
  return state.lastCourseLabel || state.lastCourseName || '';
}
function getExportFullLabel() {
  const c = getExportCourseLabel();
  let label = state.lastRoundLabel ? `${c} · ${state.lastRoundLabel}` : c;
  if (state.lastGroupLabel) label += ` · ${state.lastGroupLabel}`;
  return label;
}

// ── XLSX 동적 로드 ──────────────────────────────
let _xlsxLoaded = false;

export async function loadXLSX() {
  if (_xlsxLoaded || typeof XLSX !== 'undefined') { _xlsxLoaded = true; return; }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => { _xlsxLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('XLSX 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(s);
  });
}

// 단기는 응답 있는 강사만(기존 동작 유지), 중견리더·신규자는 강사 전체(0응답 포함) 고정 순서.
// state.lastRoundLabel 이 비어있지 않으면 중견리더 모드 (loadStats 가 채움).
function pickExportInstKeys(stats) {
  const fixedOrder = !!(state.lastRoundLabel) || state.lastCourseType === 'newcomer';
  return fixedOrder ? stats.instKeysFullOrder : stats.instKeys;
}

// ── 엑셀 내보내기 (업로드용) ──────────────────────────────
export async function exportStatsExcel() {
  if (!state.lastResponses.length) return;
  await loadXLSX();

  const isNewcomer = state.lastCourseType === 'newcomer';
  const cfg = getSurveyConfig(state.lastCourseType);
  const stats = state.lastComputedStats || computeStats(state.lastResponses, state.lastOrderedInstructorKeys, cfg);
  const instKeys = pickExportInstKeys(stats);
  const responses = state.lastResponses;

  const wb = XLSX.utils.book_new();

  // 신규자: 문항 1~16 설문지 순서 그대로 + 결번 4칸(OMR 17~20 없음, 강사 문항이 21번부터) + 강사
  // 표준: 기존 서식 유지 — 9 척도 + 빈칸 1(Q10 주관식 자리) + 인적사항 6 + 강사
  const NC_BLANKS = 4;
  const totalCols = isNewcomer
    ? NC_SURVEY.length + NC_BLANKS + instKeys.length
    : 9 + 1 + 6 + instKeys.length;
  const headers1 = ['순번', ...Array.from({length: totalCols}, (_, i) => i + 1)];
  const sheet1Data = [headers1];

  responses.forEach((r, idx) => {
    const row = [idx + 1];
    if (isNewcomer) {
      // 척도: 웹 5=매우만족 → OMR ①=매우만족 이라 6-v 로 반전. 선택형: 보기 번호_0.
      NC_SURVEY.forEach(q => {
        if (q.kind === 'scale') {
          const v = Number(r[q.key]);
          row.push((v >= 1 && v <= 5) ? 6 - v : '');
        } else {
          const val = String(r[q.key] || '').trim();
          const i = val ? q.options.indexOf(val) + 1 : '';
          row.push(i > 0 ? `${i}_0` : '');
        }
      });
      for (let b = 0; b < NC_BLANKS; b++) row.push('');
    } else {
      ['q1','q2','q3','q4','q5','q6','q7','q8','q9'].forEach(k => {
        const v = Number(r[k]);
        row.push((v >= 1 && v <= 5) ? 6 - v : '');
      });
      row.push('');
      cfg.choice.forEach(dq => {
        const val = String(r[dq.key] || '').trim();
        const i = val ? dq.options.indexOf(val) + 1 : '';
        row.push(i > 0 ? `${i}_0` : '');
      });
    }
    let instObj = r.instructors || {};
    if (typeof instObj === 'string') { try { instObj = JSON.parse(instObj); } catch { instObj = {}; } }
    instKeys.forEach(k => {
      const v = Number(instObj[k]);
      row.push((v >= 1 && v <= 5) ? `${6 - v}_0` : '');
    });
    sheet1Data.push(row);
  });

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1Data), '객관식');

  const sheet2Headers = isNewcomer
    ? ['순번', 'Q6-1. 소양교육 개선사항', 'Q7-1. 직무교육 개선사항', '소감 및 건의사항', '만족도 평가 개선 필요 부분', '전반적인 과목 및 강사 건의']
    : ['순번', 'Q10. 기타 편의시설 건의사항', '소감 및 건의사항', '만족도 평가 개선 필요 부분', '전반적인 과목 및 강사 건의'];
  const sheet2Data = [sheet2Headers];
  let commentIdx = 1;
  responses.forEach(r => {
    const cols = isNewcomer
      ? [r.nq6_comment, r.nq7_comment, r.comment1 || r.comment, r.comment2, r.comment3]
      : [r.q10_comment, r.comment1 || r.comment, r.comment2, r.comment3];
    const trimmed = cols.map(v => String(v || '').trim());
    if (trimmed.some(v => v)) {
      sheet2Data.push([commentIdx++, ...trimmed]);
    }
  });
  if (sheet2Data.length === 1) {
    sheet2Data.push(['', '(수집된 주관식 응답이 없습니다)', ...new Array(sheet2Headers.length - 2).fill('')]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2Data), '주관식');

  const filename = `${getExportFullLabel()}_설문결과_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ── 결과 보기용 엑셀 내보내기 ──────────────────────────────
export async function exportResultsExcel() {
  if (!state.lastResponses.length) return;
  await loadXLSX();

  const cfg = getSurveyConfig(state.lastCourseType);
  const responses = state.lastResponses;
  const n = responses.length;
  const stats = state.lastComputedStats || computeStats(responses, state.lastOrderedInstructorKeys, cfg);
  const { avgs, dists, hasData, instRaw, demoRaw } = stats;
  const instKeys = pickExportInstKeys(stats);
  const wb = XLSX.utils.book_new();

  // ── 시트1: 만족도 통계 ──
  const keys = cfg.scale.map(q => q.key);
  const satisfyPcts = dists.map(d => n > 0 ? (d[3] + d[4]) / n * 100 : 0);

  const validAvgs = avgs.filter((_, i) => hasData[i]);
  const allScoresForOverall = validAvgs.map(v => Number(v.toFixed(2)));
  instKeys.forEach(k => {
    const { sum, count } = instRaw[k];
    if (count > 0) allScoresForOverall.push(Number((sum / count).toFixed(2)));
  });
  const overallAvg = allScoresForOverall.length > 0
    ? allScoresForOverall.reduce((a, b) => a + b, 0) / allScoresForOverall.length
    : 0;

  const courseLabelForCell = getExportCourseLabel();
  const roundLabelForCell  = state.lastRoundLabel || '';
  const categoryLabelForCell = state.lastGroupLabel || '';
  const statsData = [
    ['교육과정', courseLabelForCell, '', '', '', '', '', ''],
    ...(roundLabelForCell ? [['회차', roundLabelForCell, '', '', '', '', '', '']] : []),
    ...(categoryLabelForCell ? [['카테고리', categoryLabelForCell, '', '', '', '', '', '']] : []),
    ['응답자 수', n + '명', '', '', '', '', '', ''],
    ['작성일', new Date().toLocaleDateString('ko-KR'), '', '', '', '', '', ''],
    [cfg.overallLabel, Number(overallAvg.toFixed(2)), '', '', '', '', '', ''],
    [],
    ['항목', '평균점수', '만족이상(%)', '1점(명)', '2점(명)', '3점(명)', '4점(명)', '5점(명)'],
  ];

  keys.forEach((k, i) => {
    statsData.push([
      cfg.scale[i].label,
      Number(avgs[i].toFixed(2)),
      Number(satisfyPcts[i].toFixed(1)),
      dists[i][0], dists[i][1], dists[i][2], dists[i][3], dists[i][4]
    ]);
  });

  if (instKeys.length > 0) {
    statsData.push([]);
    statsData.push(['── 강사별 만족도 ──', '', '', '', '', '', '', '']);
    const instTotalSum = instKeys.reduce((a, k) => a + instRaw[k].sum, 0);
    const instTotalCount = instKeys.reduce((a, k) => a + instRaw[k].count, 0);
    const instTotalAvg = instTotalCount > 0 ? instTotalSum / instTotalCount : 0;
    const instTotalSatisfy = instKeys.reduce((a, k) => a + instRaw[k].dist[3] + instRaw[k].dist[4], 0);
    const instTotalSatisfyPct = instTotalCount > 0 ? instTotalSatisfy / instTotalCount * 100 : 0;
    statsData.push(['강사 전체 평균', Number(instTotalAvg.toFixed(2)), Number(instTotalSatisfyPct.toFixed(1)), '', '', '', '', '']);
    // 0응답 강사는 응답자 수 0 으로 한 줄 유지 (인재개발원 서식 강사 열 고정 순서 보장)
    instKeys.forEach(key => {
      const { sum, count, dist } = instRaw[key];
      const parts = key.split('__');
      const label = parts.length === 2 ? `[${parts[0]}] ${parts[1]} 강사` : `${key} 강사`;
      if (count === 0) {
        statsData.push([label, '', '', '', '', '', '', '']);
        return;
      }
      const avg = sum / count;
      const satisfyPct = (dist[3] + dist[4]) / count * 100;
      statsData.push([label, Number(avg.toFixed(2)), Number(satisfyPct.toFixed(1)), dist[0], dist[1], dist[2], dist[3], dist[4]]);
    });
  }

  const ws1 = XLSX.utils.aoa_to_sheet(statsData);
  ws1['!cols'] = [{ wch: 42 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws1, '만족도 통계');

  // ── 시트2: 응답자 특성 ──
  const demoData = [
    ['교육과정', courseLabelForCell],
    ...(roundLabelForCell ? [['회차', roundLabelForCell]] : []),
    ...(categoryLabelForCell ? [['카테고리', categoryLabelForCell]] : []),
    ['응답자 수', n + '명'],
    []
  ];
  cfg.choice.forEach(dq => {
    const counts = dq.options.map(opt => demoRaw[dq.key][opt] || 0);
    const total = counts.reduce((a, b) => a + b, 0);
    demoData.push([dq.label, '인원(명)', '비율(%)']);
    dq.options.forEach((opt, i) => {
      const pct = total > 0 ? counts[i] / total * 100 : 0;
      demoData.push([`  ${opt}`, counts[i], Number(pct.toFixed(1))]);
    });
    demoData.push(['  합계', total, '']);
    demoData.push([]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(demoData);
  ws2['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, '응답자 특성');

  // ── 시트3: 주관식 의견 ──
  // 주관식 컬럼은 과정 타입별 정의(cfg.subjective) 순서. legacy 'comment' 키는 comment1 에 흡수.
  const subjectiveCols = cfg.subjective.filter(s => s.key !== 'comment');
  const commentData = [
    ['교육과정', courseLabelForCell],
    ...(roundLabelForCell ? [['회차', roundLabelForCell]] : []),
    ...(categoryLabelForCell ? [['카테고리', categoryLabelForCell]] : []),
    ['응답자 수', n + '명'],
    [],
    ['순번', ...subjectiveCols.map(s => s.label)],
  ];
  const commentHeaderRows = commentData.length;
  let cidx = 1;
  responses.forEach(r => {
    const vals = subjectiveCols.map(s => {
      if (s.key === 'comment1') return String(r.comment1 || r.comment || '').trim();
      return String(r[s.key] || '').trim();
    });
    if (vals.some(v => v)) commentData.push([cidx++, ...vals]);
  });
  if (commentData.length === commentHeaderRows) {
    commentData.push(['', '(수집된 주관식 응답이 없습니다)', ...new Array(Math.max(0, subjectiveCols.length - 1)).fill('')]);
  }
  const ws3 = XLSX.utils.aoa_to_sheet(commentData);
  ws3['!cols'] = [{ wch: 6 }, ...subjectiveCols.map(() => ({ wch: 35 }))];
  XLSX.utils.book_append_sheet(wb, ws3, '주관식 의견');

  const filename = `${getExportFullLabel()}_만족도결과_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);

  // ── 분야별 막대그래프 PNG ──
  const catDefs = cfg.chartCats;
  const catAvgs = catDefs.map(cat => {
    const vals = cat.keys.map(k => avgs[keys.indexOf(k)]);
    return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
  });
  const instTotalSum2 = instKeys.reduce((a, k) => a + instRaw[k].sum, 0);
  const instTotalCount2 = instKeys.reduce((a, k) => a + instRaw[k].count, 0);
  const instCatAvg = instTotalCount2 > 0 ? Number((instTotalSum2 / instTotalCount2).toFixed(2)) : null;
  const chartLabels = [...catDefs.map(c => c.label), '강사'];
  const chartValues = [...catAvgs, instCatAvg];

  const chartPng = generateCategoryChart(getExportFullLabel(), chartLabels, chartValues);
  setTimeout(() => {
    const a = document.createElement('a');
    a.href = chartPng;
    a.download = `${getExportFullLabel()}_분야별만족도_${new Date().toISOString().slice(0,10)}.png`;
    a.click();
  }, 400);
}

function generateCategoryChart(courseName, labels, values) {
  const W = 875, H = 677;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const ml = 68, mr = 24, mt = 72, mb = 82;
  const cw = W - ml - mr, ch = H - mt - mb;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('분야별 만족도 현황', W / 2, 44);

  ctx.textAlign = 'right';
  ctx.font = 'bold 22px sans-serif';
  for (let v = 0; v <= 5; v++) {
    const y = mt + ch - (v / 5) * ch;
    ctx.strokeStyle = v === 0 ? '#94a3b8' : '#dde3ed';
    ctx.lineWidth = v === 0 ? 2.5 : 1;
    ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + cw, y); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillText(String(v), ml - 8, y + 8);
  }

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(ml, mt + ch); ctx.lineTo(ml + cw, mt + ch); ctx.stroke();

  const barN = labels.length;
  const slotW = cw / barN;
  const barW = slotW * 0.58;

  labels.forEach((label, i) => {
    const val = values[i];
    if (val === null || isNaN(val)) return;

    const x = ml + slotW * i + (slotW - barW) / 2;
    const barH = (val / 5) * ch;
    const y = mt + ch - barH;

    const grad = ctx.createLinearGradient(x, y, x, mt + ch);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#1e40af');
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, barW, barH, [5, 5, 0, 0]);
    } else {
      ctx.rect(x, y, barW, barH);
    }
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(val.toFixed(2), x + barW / 2, y - 11);

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(label, x + barW / 2, mt + ch + 50);
  });

  return canvas.toDataURL('image/png');
}
