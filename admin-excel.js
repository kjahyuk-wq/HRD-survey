import { state, Q_LABELS, DEMO_QUESTIONS, escapeHtml } from './admin-utils.js';
import { computeStats } from './admin-stats.js';

// ── 라벨 헬퍼 ──────────────────────────────
// state.lastRoundLabel은 중견리더 과정에서 회차 선택 시에만 채워짐. 단기는 빈 문자열.
function getExportCourseLabel() {
  return state.lastCourseLabel || state.lastCourseName || '';
}
function getExportFullLabel() {
  const c = getExportCourseLabel();
  return state.lastRoundLabel ? `${c} · ${state.lastRoundLabel}` : c;
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

// ── 엑셀 내보내기 (업로드용) ──────────────────────────────
export async function exportStatsExcel() {
  if (!state.lastResponses.length) return;
  await loadXLSX();

  const stats = state.lastComputedStats || computeStats(state.lastResponses, state.lastOrderedInstructorKeys);
  const { instKeys } = stats;
  const responses = state.lastResponses;

  const wb = XLSX.utils.book_new();

  const instHeaders = instKeys.map(k => {
    const parts = k.split('__');
    return parts.length === 2 ? `[${parts[0]}] ${parts[1]} 강사` : `${k} 강사`;
  });
  const totalCols = 9 + 1 + 6 + instKeys.length;
  const headers1 = ['순번', ...Array.from({length: totalCols}, (_, i) => i + 1)];
  const sheet1Data = [headers1];

  responses.forEach((r, idx) => {
    const row = [idx + 1];
    ['q1','q2','q3','q4','q5','q6','q7','q8','q9'].forEach(k => {
      const v = Number(r[k]);
      row.push((v >= 1 && v <= 5) ? 6 - v : '');
    });
    row.push('');
    DEMO_QUESTIONS.forEach(dq => {
      const val = String(r[dq.key] || '').trim();
      const i = val ? dq.options.indexOf(val) + 1 : '';
      row.push(i > 0 ? `${i}_0` : '');
    });
    let instObj = r.instructors || {};
    if (typeof instObj === 'string') { try { instObj = JSON.parse(instObj); } catch { instObj = {}; } }
    instKeys.forEach(k => {
      const v = Number(instObj[k]);
      row.push((v >= 1 && v <= 5) ? `${6 - v}_0` : '');
    });
    sheet1Data.push(row);
  });

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1Data), '객관식');

  const sheet2Headers = [
    '순번',
    'Q10. 기타 편의시설 건의사항',
    '소감 및 건의사항',
    '만족도 평가 개선 필요 부분',
    '전반적인 과목 및 강사 건의',
  ];
  const sheet2Data = [sheet2Headers];
  let commentIdx = 1;
  responses.forEach(r => {
    const q10 = String(r.q10_comment || '').trim();
    const c1 = String(r.comment1 || r.comment || '').trim();
    const c2 = String(r.comment2 || '').trim();
    const c3 = String(r.comment3 || '').trim();
    if (q10 || c1 || c2 || c3) {
      sheet2Data.push([commentIdx++, q10, c1, c2, c3]);
    }
  });
  if (sheet2Data.length === 1) {
    sheet2Data.push(['', '(수집된 주관식 응답이 없습니다)', '', '', '']);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2Data), '주관식');

  const filename = `${getExportFullLabel()}_설문결과_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ── 결과 보기용 엑셀 내보내기 ──────────────────────────────
export async function exportResultsExcel() {
  if (!state.lastResponses.length) return;
  await loadXLSX();

  const responses = state.lastResponses;
  const n = responses.length;
  const stats = state.lastComputedStats || computeStats(responses, state.lastOrderedInstructorKeys);
  const { avgs, dists, hasData, instRaw, instKeys, demoRaw } = stats;
  const wb = XLSX.utils.book_new();

  // ── 시트1: 만족도 통계 ──
  const keys = ['q1','q2','q3','q4','q5','q6','q7','q8','q9'];
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
  const statsData = [
    ['교육과정', courseLabelForCell, '', '', '', '', '', ''],
    ...(roundLabelForCell ? [['회차', roundLabelForCell, '', '', '', '', '', '']] : []),
    ['응답자 수', n + '명', '', '', '', '', '', ''],
    ['작성일', new Date().toLocaleDateString('ko-KR'), '', '', '', '', '', ''],
    ['전체 평균 (Q1~Q9 + 강사)', Number(overallAvg.toFixed(2)), '', '', '', '', '', ''],
    [],
    ['항목', '평균점수', '만족이상(%)', '1점(명)', '2점(명)', '3점(명)', '4점(명)', '5점(명)'],
  ];

  keys.forEach((k, i) => {
    statsData.push([
      Q_LABELS[i],
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
    const instTotalAvg = instTotalSum / instTotalCount;
    const instTotalSatisfy = instKeys.reduce((a, k) => a + instRaw[k].dist[3] + instRaw[k].dist[4], 0);
    const instTotalSatisfyPct = instTotalCount > 0 ? instTotalSatisfy / instTotalCount * 100 : 0;
    statsData.push(['강사 전체 평균', Number(instTotalAvg.toFixed(2)), Number(instTotalSatisfyPct.toFixed(1)), '', '', '', '', '']);
    instKeys.forEach(key => {
      const { sum, count, dist } = instRaw[key];
      const avg = sum / count;
      const satisfyPct = count > 0 ? (dist[3] + dist[4]) / count * 100 : 0;
      const parts = key.split('__');
      const label = parts.length === 2 ? `[${parts[0]}] ${parts[1]} 강사` : `${key} 강사`;
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
    ['응답자 수', n + '명'],
    []
  ];
  DEMO_QUESTIONS.forEach(dq => {
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
  const commentData = [
    ['교육과정', courseLabelForCell],
    ...(roundLabelForCell ? [['회차', roundLabelForCell]] : []),
    ['응답자 수', n + '명'],
    [],
    ['순번', 'Q10. 기타 편의시설 건의사항', '소감 및 건의사항', '만족도 평가 개선 필요 부분', '전반적인 과목 및 강사 건의'],
  ];
  let cidx = 1;
  responses.forEach(r => {
    const q10 = String(r.q10_comment || '').trim();
    const c1 = String(r.comment1 || r.comment || '').trim();
    const c2 = String(r.comment2 || '').trim();
    const c3 = String(r.comment3 || '').trim();
    if (q10 || c1 || c2 || c3) commentData.push([cidx++, q10, c1, c2, c3]);
  });
  if (commentData.length === 4) commentData.push(['', '(수집된 주관식 응답이 없습니다)', '', '', '']);
  const ws3 = XLSX.utils.aoa_to_sheet(commentData);
  ws3['!cols'] = [{ wch: 6 }, { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, ws3, '주관식 의견');

  const filename = `${getExportFullLabel()}_만족도결과_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);

  // ── 분야별 막대그래프 PNG ──
  const catDefs = [
    { label: '교육기간', keys: ['q1'] },
    { label: '교육운영', keys: ['q2','q3','q4','q5','q6'] },
    { label: '교육효과', keys: ['q7'] },
    { label: '시설환경', keys: ['q8','q9'] },
  ];
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
