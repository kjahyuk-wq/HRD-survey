// ── 만족도 결과보고서(HWPX) ──────────────────────────────
// [결과보고서(한글)] 버튼 → 편집 창을 열고 AI(Cloud Function) 서술 초안을 받아 채움
// → 담당자가 확인·수정 → templates/survey-report.hwpx 에 수치·서술을 채워 다운로드.
import { functions } from './firebase-config.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";
import { state, escapeHtml, getSurveyConfig } from './admin-utils.js';
import { computeStats } from './admin-stats.js';
import { generateCategoryChart } from './admin-excel.js';
import { fillHwpxSection, serializeXml } from './hwpx-fill.js';
import {
  isReportSupported, computeReportNumbers, buildReportData, buildLeadershipReportData, chartSeries,
  LEADERSHIP_EXCLUDED_KEYS,
  collectComments, formatPeriod, formatKoDate,
} from './survey-report-data.js';

// 중견리더양성과정은 회차별 보고서 서식이 따로 있음 (평균 소수 첫째 자리, 검토결과 "→" 줄 등)
const TEMPLATE_URLS = {
  short: 'templates/survey-report.hwpx',
  leadership: 'templates/survey-report-leadership.hwpx',
};
const DEFAULT_ACTIONS = { facility: '교육지원과에 내용 전달', instructor: '교육계획 수립시 반영' };
const isLeadership = () => state.lastCourseType === 'leadership';
const LS_MANAGER = 'reportManager';
const lsGoalKey = id => `reportGoal:${id}`;

// 과정(+회차)별 AI 초안 캐시 — 창을 닫았다 다시 열어도 재호출하지 않음
const draftCache = new Map();

function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

// ── JSZip 동적 로드 ──
let _jszip = null;
async function loadJSZip() {
  if (_jszip) return _jszip;
  if (window.JSZip) return (_jszip = window.JSZip);
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('JSZip 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(s);
  });
  return (_jszip = window.JSZip);
}

function reportKey() {
  return `${state.lastCourseId || state.lastCourseName}|${state.lastRoundId || ''}|${state.lastGroupName || ''}`;
}

function reportCourseName() {
  let name = state.lastCourseName || '';
  if (state.lastRoundLabel) name += ` ${state.lastRoundLabel}`;
  if (state.lastGroupLabel) name += ` ${state.lastGroupLabel}`;
  return name;
}

function currentNumbers() {
  const cfg = getSurveyConfig(state.lastCourseType);
  const stats = state.lastComputedStats || computeStats(state.lastResponses, state.lastOrderedInstructorKeys, cfg);
  return { cfg, nums: computeReportNumbers(stats, cfg, isLeadership() ? LEADERSHIP_EXCLUDED_KEYS : []) };
}

// ── 편집 창 ──
function ensureModal() {
  let el = document.getElementById('report-modal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'report-modal';
  el.className = 'report-modal-backdrop';
  el.innerHTML = `
    <div class="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
      <div class="report-modal-head">
        <h2 id="report-modal-title">만족도 결과보고서 (한글)</h2>
        <button type="button" class="report-close" data-act="close" aria-label="닫기">×</button>
      </div>
      <div class="report-modal-body">
        <div id="report-status" class="report-status" role="status"></div>

        <fieldset class="report-group">
          <legend>설문 개요</legend>
          <label><span>보고서 제목(맨 위)</span><input id="rp-title" type="text"></label>
          <label><span>과정명</span><input id="rp-course" type="text"></label>
          <label><span>교육목표 <small>(두 줄이면 줄바꿈)</small></span><textarea id="rp-goal" rows="2"></textarea></label>
          <div class="report-row">
            <label><span>교육기간</span><input id="rp-period" type="text"></label>
            <label><span>설문일</span><input id="rp-survey-date" type="text"></label>
          </div>
          <div class="report-row">
            <label><span>설문대상(명)</span><input id="rp-target" type="text" inputmode="numeric"></label>
            <label><span>설문참여(명)</span><input id="rp-resp" type="text" inputmode="numeric"></label>
          </div>
          <label><span>과정장 / 담당자 <small>(다음에도 기억)</small></span><input id="rp-manager" type="text" placeholder="교육운영팀장: 홍길동 / 담당자: 행정7급 홍길동"></label>
        </fieldset>

        <fieldset class="report-group">
          <legend>총평 · 보완할 점 <span class="report-ai-badge">AI 초안</span></legend>
          <label><span>(교육효과) <small>**굵게** 표시한 부분은 한글에서 굵은 글씨</small></span><textarea id="rp-effect" rows="4"></textarea></label>
          <div class="report-sub-label">보완(개선)할 점 <small>(비워 두면 '없음'으로 표시)</small></div>
          <div id="rp-improve-list" class="report-improve-list"></div>
          <button type="button" class="report-link-btn" data-act="add-improve">+ 항목 추가</button>
        </fieldset>

        <fieldset class="report-group">
          <legend>교육생 의견(주관식) 요약 <span class="report-ai-badge">AI 초안</span> <small>한 줄에 하나씩</small></legend>
          <label><span>시설환경 · 편의시설 건의사항</span><textarea id="rp-facility" rows="3"></textarea></label>
          <label class="rp-lead-only"><span>→ 시설환경 검토결과 <small>(비우면 생략)</small></span><input id="rp-facility-action" type="text"></label>
          <label class="rp-short-only"><span>소감 및 건의사항</span><textarea id="rp-impression" rows="4"></textarea></label>
          <label><span>전반적인 과목 및 강사 관련 건의</span><textarea id="rp-instructor" rows="3"></textarea></label>
          <label class="rp-lead-only"><span>→ 과목·강사 검토결과 <small>(비우면 생략)</small></span><input id="rp-instructor-action" type="text"></label>
          <label><span>만족도 평가에 추가 또는 개선 의견</span><textarea id="rp-survey-improve" rows="3"></textarea></label>
        </fieldset>

        <details class="report-raw">
          <summary>주관식 원문 보기</summary>
          <div id="rp-raw"></div>
        </details>
      </div>
      <div class="report-modal-foot">
        <button type="button" class="excel-export-btn secondary" data-act="ai">AI 초안 다시 만들기</button>
        <button type="button" class="excel-export-btn" data-act="download">한글(HWPX) 다운로드</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target === el || act === 'close') closeModal();
    else if (act === 'add-improve') addImproveRow();
    else if (act === 'remove-improve') e.target.closest('.report-improve-row')?.remove();
    else if (act === 'ai') runAiDraft(true);
    else if (act === 'download') downloadReport();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.classList.contains('open')) closeModal();
  });
  return el;
}

function closeModal() {
  document.getElementById('report-modal')?.classList.remove('open');
  document.body.classList.remove('report-modal-lock');
}

function setStatus(msg, kind = '') {
  const s = document.getElementById('report-status');
  if (!s) return;
  s.className = `report-status ${kind}`;
  s.textContent = msg;
  s.style.display = msg ? 'block' : 'none';
}

function addImproveRow(issue = '', action = '') {
  const list = document.getElementById('rp-improve-list');
  const row = document.createElement('div');
  row.className = 'report-improve-row';
  row.innerHTML = `
    <input type="text" class="rp-issue" placeholder="건의·의견">
    <input type="text" class="rp-action" placeholder="검토·조치 (예: 차기 교육계획 수립 시 검토)">
    <button type="button" class="report-link-btn danger" data-act="remove-improve" aria-label="이 항목 삭제">삭제</button>`;
  row.querySelector('.rp-issue').value = issue;
  row.querySelector('.rp-action').value = action;
  list.appendChild(row);
}

const val = id => document.getElementById(id).value;
const setVal = (id, v) => { document.getElementById(id).value = v ?? ''; };
const lines = id => val(id).split('\n').map(s => s.trim()).filter(Boolean);

function fillDraft(draft) {
  setVal('rp-effect', draft.effect || '');
  document.getElementById('rp-improve-list').innerHTML = '';
  (draft.improvements || []).forEach(x => addImproveRow(x.issue, x.action));
  setVal('rp-facility', (draft.facility || []).join('\n'));
  setVal('rp-impression', (draft.impression || []).join('\n'));
  setVal('rp-instructor', (draft.instructor || []).join('\n'));
  setVal('rp-survey-improve', (draft.surveyImprove || []).join('\n'));
  setVal('rp-facility-action', draft.facilityAction ?? DEFAULT_ACTIONS.facility);
  setVal('rp-instructor-action', draft.instructorAction ?? DEFAULT_ACTIONS.instructor);
}

// 중견 서식은 '소감' 칸이 없어 AI 가 소감 칸에 요약한 의견을 과목·강사 건의 칸으로 합침
function adaptDraftForCourse(draft) {
  if (!isLeadership()) return draft;
  return { ...draft, instructor: [...(draft.instructor || []), ...(draft.impression || [])], impression: [] };
}

function readDraft() {
  const improvements = Array.from(document.querySelectorAll('#rp-improve-list .report-improve-row'))
    .map(r => ({ issue: r.querySelector('.rp-issue').value.trim(), action: r.querySelector('.rp-action').value.trim() }))
    .filter(x => x.issue);
  return {
    effect: val('rp-effect'),
    improvements,
    facility: lines('rp-facility'),
    impression: lines('rp-impression'),
    instructor: lines('rp-instructor'),
    surveyImprove: lines('rp-survey-improve'),
    facilityAction: val('rp-facility-action').trim(),
    instructorAction: val('rp-instructor-action').trim(),
  };
}

function renderRawComments(comments) {
  const LABELS = {
    facility: '편의시설 건의사항', impression: '소감 및 건의사항',
    instructor: '과목 및 강사 건의', surveyImprove: '만족도 평가 개선 의견',
  };
  document.getElementById('rp-raw').innerHTML = Object.entries(LABELS).map(([k, label]) => {
    const xs = comments[k] || [];
    return `<div class="report-raw-group"><b>${label} (${xs.length}건)</b>${
      xs.length ? `<ul>${xs.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<p>응답 없음</p>'}</div>`;
  }).join('');
}

// ── 진입점 ──
export function openSurveyReport() {
  if (!state.lastResponses.length) { alert('응답이 있는 과정을 먼저 선택해 주세요.'); return; }
  const { cfg } = currentNumbers();
  if (!isReportSupported(cfg)) {
    alert('이 과정 유형은 결과보고서 서식(교육기간·교육운영·교육효과·시설환경)과 문항 구성이 달라 아직 지원하지 않습니다.');
    return;
  }

  const modal = ensureModal();
  const lead = isLeadership();
  modal.classList.toggle('is-leadership', lead);
  const n = state.lastResponses.length;
  if (lead) {
    // 중견: 제목 "과정명(회차명)", 과정명 줄에 전체 과정 기간, 교육기간은 이번 회차
    const roundName = state.lastRoundName || state.lastRoundLabel || '';
    setVal('rp-title', `${state.lastCourseName}${roundName ? `(${roundName})` : ''}`);
    const whole = formatPeriod(state.lastCourseStart, state.lastCourseEnd, false);
    setVal('rp-course', whole ? `${state.lastCourseName} / ${whole}` : state.lastCourseName);
    setVal('rp-period', formatPeriod(state.lastRoundStart, state.lastRoundEnd, false));
    setVal('rp-survey-date', formatKoDate(state.lastRoundEnd || ''));
  } else {
    setVal('rp-title', reportCourseName());
    setVal('rp-course', reportCourseName());
    setVal('rp-period', formatPeriod(state.lastCourseStart, state.lastCourseEnd));
    setVal('rp-survey-date', formatKoDate(state.lastCourseEnd || ''));
  }
  setVal('rp-goal', lsGet(lsGoalKey(state.lastCourseId)));
  setVal('rp-target', String(state.lastStudentCount || n));
  setVal('rp-resp', String(n));
  setVal('rp-manager', lsGet(LS_MANAGER));
  renderRawComments(collectComments(state.lastResponses));

  modal.classList.add('open');
  document.body.classList.add('report-modal-lock');

  const cached = draftCache.get(reportKey());
  if (cached) { fillDraft(cached); setStatus(''); }
  else { fillDraft({}); runAiDraft(false); }
}

let aiRunning = false;
async function runAiDraft(isRetry) {
  if (aiRunning) return;
  if (isRetry && !confirm('지금 편집한 총평·의견 내용을 AI 초안으로 다시 덮어쓸까요?')) return;
  aiRunning = true;
  const btn = document.querySelector('#report-modal [data-act="ai"]');
  btn.disabled = true;
  setStatus('AI가 주관식 의견을 읽고 총평 초안을 작성하고 있습니다… (보통 20초~1분)', 'busy');
  const key = reportKey();
  try {
    const { nums } = currentNumbers();
    const comments = collectComments(state.lastResponses);
    const call = httpsCallable(functions, 'generateSurveyReportDraft', { timeout: 300000 });
    const res = await call({
      courseName: val('rp-title'),
      goal: val('rp-goal'),
      period: val('rp-period'),
      respondents: state.lastResponses.length,
      overallAvg: nums.overallAvg.toFixed(2),
      categories: nums.cats.map(c => ({
        label: c.label, avg: c.avg.toFixed(2),
        items: c.rows.map(r => ({ label: r.label, avg: r.avg.toFixed(2), pct: String(r.pct) })),
      })),
      lectures: nums.lectures.map(l => ({ subject: l.subject, name: l.name, avg: l.avg.toFixed(2) })),
      comments,
    });
    const draft = adaptDraftForCourse(res.data?.draft || {});
    draftCache.set(key, draft);
    // 사용자가 기다리는 동안 다른 과정으로 바꾸지 않았을 때만 화면에 반영
    if (key === reportKey()) {
      fillDraft(draft);
      setStatus('AI 초안을 채웠습니다. 내용을 확인·수정한 뒤 다운로드하세요.', 'ok');
    }
  } catch (e) {
    console.error('[report] AI 초안 실패', e);
    const code = String(e?.code || '').replace(/^functions\//, '');
    const msg = code === 'not-found' || code === 'internal'
      ? 'AI 초안 기능에 연결하지 못했습니다(함수 미배포 또는 서버 오류).'
      : code === 'deadline-exceeded' ? 'AI 응답이 너무 오래 걸려 중단했습니다.'
        : (e?.message || 'AI 초안을 만들지 못했습니다.');
    setStatus(`${msg} 서술 부분을 직접 입력해도 다운로드할 수 있습니다.`, 'error');
  } finally {
    aiRunning = false;
    btn.disabled = false;
  }
}

function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function safeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').trim();
}

async function downloadReport() {
  const btn = document.querySelector('#report-modal [data-act="download"]');
  btn.disabled = true;
  try {
    const lead = isLeadership();
    const title = val('rp-title').trim();
    lsSet(LS_MANAGER, val('rp-manager').trim());
    lsSet(lsGoalKey(state.lastCourseId), val('rp-goal'));
    draftCache.set(reportKey(), readDraft());

    const { nums } = currentNumbers();
    const target = val('rp-target').trim(), responded = val('rp-resp').trim();
    const meta = {
      courseTitle: title,
      course: val('rp-course').trim(),
      goal: val('rp-goal').trim(),
      period: val('rp-period').trim(),
      surveyDate: val('rp-survey-date').trim(),
      targetCount: target,
      respCount: responded,
      absentCount: String(Math.max(0, (Number(target) || 0) - (Number(responded) || 0))),
      manager: val('rp-manager').trim(),
    };
    const data = lead ? buildLeadershipReportData(nums, meta, readDraft()) : buildReportData(nums, meta, readDraft());

    const JSZip = await loadJSZip();
    const resp = await fetch(TEMPLATE_URLS[lead ? 'leadership' : 'short'], { cache: 'no-cache' });
    if (!resp.ok) throw new Error('보고서 서식 파일을 불러오지 못했습니다.');
    const tpl = await JSZip.loadAsync(await resp.arrayBuffer());

    const parser = new DOMParser();
    const section = parser.parseFromString(await tpl.file('Contents/section0.xml').async('string'), 'application/xml');
    const header = parser.parseFromString(await tpl.file('Contents/header.xml').async('string'), 'application/xml');
    fillHwpxSection(section, header, data);

    const { labels, values } = chartSeries(nums);
    const digits = lead ? 1 : 2;   // 보고서 본문 숫자와 같은 자릿수
    const chartPng = dataUrlToBytes(generateCategoryChart(title, labels,
      values.map(v => Number(v.toFixed(digits))), digits));

    // HWPX 규칙: mimetype 이 첫 항목이고 무압축이어야 한글이 연다 → 새 zip 으로 재구성
    const out = new JSZip();
    out.file('mimetype', await tpl.file('mimetype').async('uint8array'), { compression: 'STORE' });
    const noDirs = { createFolders: false };   // 원본처럼 폴더 항목 없이 파일만
    for (const [path, f] of Object.entries(tpl.files)) {
      if (path === 'mimetype' || f.dir) continue;
      let content;
      if (path === 'Contents/section0.xml') content = serializeXml(section, XMLSerializer);
      else if (path === 'Contents/header.xml') content = serializeXml(header, XMLSerializer);
      else if (path === 'BinData/image1.png') content = chartPng;
      else if (path === 'Preview/PrvText.txt') content = `${title} 학습자반응(만족도) 설문분석 결과`;
      else content = await f.async('uint8array');
      out.file(path, content, noDirs);
    }
    const blob = await out.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // 파일명도 기존 관례대로 — 중견: "…결과보고(7~8월)", 그 외: "…결과(과정명)"
    a.download = safeFileName(lead
      ? `학습자반응(만족도) 설문분석 결과보고(${state.lastRoundName || title}).hwpx`
      : `학습자반응(만족도) 설문분석 결과(${title}).hwpx`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus('다운로드했습니다. 한글에서 열어 쪽 나눔을 확인한 뒤 공문에 첨부하세요.', 'ok');
  } catch (e) {
    console.error('[report] HWPX 생성 실패', e);
    setStatus(`보고서 파일을 만들지 못했습니다: ${e.message || e}`, 'error');
  } finally {
    btn.disabled = false;
  }
}
