import { db } from './firebase-config.js';
import {
  collection, getDocs, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { escapeHtml, escapeAttr } from './admin-utils.js';
import { renderDateFields, readDateFields, wireDateFields } from './admin-courses.js';
import { loadXLSX } from './admin-excel.js';

// 패널별 회차 캐시 — 편집 시 원본 복원·중복 번호 검증·삭제 라벨 표시에 활용
const panelRounds = {};

export async function loadRounds(courseId, panelIdx) {
  const panel = document.getElementById(`round-panel-${panelIdx}`);
  if (!panel) return;
  panel.innerHTML = '<div class="round-loading">불러오는 중...</div>';
  try {
    const snap = await getDocs(collection(db, 'courses', courseId, 'rounds'));
    const rounds = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    rounds.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    panelRounds[panelIdx] = rounds;
    renderRoundPanel(courseId, panelIdx, rounds);
  } catch (e) {
    panel.innerHTML = '<div class="round-loading">불러오기 실패</div>';
  }
}

function renderRoundPanel(courseId, panelIdx, rounds) {
  const panel = document.getElementById(`round-panel-${panelIdx}`);
  const cid = escapeAttr(courseId);
  const nextNumber = rounds.length > 0 ? Math.max(...rounds.map(r => r.number || 0)) + 1 : 1;

  const addForm = `
    <div class="round-add-form">
      <div class="round-add-fields">
        <label class="round-add-field round-num-field">
          <span>회차</span>
          <input type="number" id="new-round-num-${panelIdx}" value="${nextNumber}" min="1" max="99">
        </label>
        <label class="round-add-field round-name-field">
          <span>회차명 (선택)</span>
          <input type="text" id="new-round-name-${panelIdx}" placeholder="예: 리더십 마인드셋" maxlength="60">
        </label>
        <label class="round-add-field round-date-field">
          <span>기간</span>
          <div class="round-date-pair">
            ${renderDateFields(`new-round-start-${panelIdx}`)}
            <span class="date-sep">~</span>
            ${renderDateFields(`new-round-end-${panelIdx}`)}
          </div>
        </label>
      </div>
      <button class="add-btn round-add-btn" onclick="addRound('${cid}', ${panelIdx})">+ 회차 추가</button>
    </div>
  `;

  const listHtml = rounds.length === 0
    ? '<div class="round-empty">아직 등록된 회차가 없습니다. 위에서 1회차를 추가해 주세요.</div>'
    : rounds.map((r, i) => renderRoundRow(cid, panelIdx, r, i)).join('');

  panel.innerHTML = `${addForm}<div class="round-list">${listHtml}</div>`;
  wireDateFields(panel);
}

function renderRoundRow(cid, panelIdx, round, idx) {
  const active = round.active !== false;
  const dateLabel = (round.startDate && round.endDate)
    ? `${String(round.startDate).replaceAll('-', '.')} ~ ${String(round.endDate).replaceAll('-', '.')}`
    : '';
  const status = active
    ? `<span class="round-status active">진행중</span>`
    : `<span class="round-status closed">종료</span>`;
  const nameLabel = round.name ? `<span class="round-name">${escapeHtml(round.name)}</span>` : '';

  return `
    <div class="round-item" id="round-item-${panelIdx}-${idx}">
      <div class="round-row ${active ? '' : 'is-closed'}" id="round-row-${panelIdx}-${idx}">
        <div class="round-row-info">
          <span class="round-num">${round.number}회차</span>
          ${nameLabel}
          ${status}
          ${dateLabel ? `<span class="round-date">${escapeHtml(dateLabel)}</span>` : ''}
        </div>
        <div class="round-row-actions">
          <button class="round-inst-btn" id="round-inst-btn-${panelIdx}-${idx}" onclick="toggleRoundInstructors('${cid}', ${panelIdx}, ${idx})" title="회차별 강사 관리">강사관리</button>
          <button class="round-edit-btn" onclick="startEditRound('${cid}', ${panelIdx}, ${idx})">수정</button>
          <button class="round-toggle-btn ${active ? 'closer' : 'reopen'}" onclick="toggleRoundActive('${cid}', ${panelIdx}, ${idx})">${active ? '종료' : '재활성'}</button>
          <button class="delete-btn round-del-btn" onclick="deleteRound('${cid}', ${panelIdx}, ${idx})">삭제</button>
        </div>
      </div>
      <div class="round-inst-panel" id="round-inst-panel-${panelIdx}-${idx}" style="display:none;"></div>
    </div>
  `;
}

export async function addRound(courseId, panelIdx) {
  const numEl  = document.getElementById(`new-round-num-${panelIdx}`);
  const nameEl = document.getElementById(`new-round-name-${panelIdx}`);
  const number    = parseInt(numEl?.value);
  const name      = nameEl?.value.trim() || '';
  const startDate = readDateFields(`new-round-start-${panelIdx}`);
  const endDate   = readDateFields(`new-round-end-${panelIdx}`);

  if (!Number.isFinite(number) || number < 1) {
    alert('회차 번호를 1 이상의 숫자로 입력해 주세요.');
    numEl?.focus(); return;
  }
  if (!startDate) {
    alert('회차 시작일을 입력해 주세요. (YYYY-MM-DD)');
    document.getElementById(`new-round-start-${panelIdx}-y`)?.focus();
    return;
  }
  if (!endDate) {
    alert('회차 종료일을 입력해 주세요. (YYYY-MM-DD)');
    document.getElementById(`new-round-end-${panelIdx}-y`)?.focus();
    return;
  }
  if (endDate < startDate) {
    alert('종료일이 시작일보다 빠를 수 없습니다.');
    return;
  }

  const existing = (panelRounds[panelIdx] || []).find(r => r.number === number);
  if (existing) {
    alert(`${number}회차가 이미 존재합니다.`);
    return;
  }

  const btn = document.querySelector(`#round-panel-${panelIdx} .round-add-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '추가 중...'; }

  try {
    await addDoc(collection(db, 'courses', courseId, 'rounds'), {
      number, name, startDate, endDate, active: true,
      createdAt: serverTimestamp()
    });
    await loadRounds(courseId, panelIdx);
  } catch (e) {
    alert('회차 추가 중 오류가 발생했습니다.');
    if (btn) { btn.disabled = false; btn.textContent = '+ 회차 추가'; }
  }
}

export function startEditRound(courseId, panelIdx, idx) {
  const round = panelRounds[panelIdx]?.[idx];
  if (!round) return;
  const row = document.getElementById(`round-row-${panelIdx}-${idx}`);
  if (!row) return;
  const cid = escapeAttr(courseId);
  row.classList.add('is-editing');
  row.innerHTML = `
    <div class="round-edit-form">
      <div class="round-edit-fields">
        <label class="round-edit-field round-num-field">
          <span>회차</span>
          <input type="number" id="edit-round-num-${panelIdx}-${idx}" value="${round.number}" min="1" max="99">
        </label>
        <label class="round-edit-field round-name-field">
          <span>회차명 (선택)</span>
          <input type="text" id="edit-round-name-${panelIdx}-${idx}" value="${escapeAttr(round.name || '')}" maxlength="60">
        </label>
        <label class="round-edit-field round-date-field">
          <span>기간</span>
          <div class="round-date-pair">
            ${renderDateFields(`edit-round-start-${panelIdx}-${idx}`, round.startDate)}
            <span class="date-sep">~</span>
            ${renderDateFields(`edit-round-end-${panelIdx}-${idx}`, round.endDate)}
          </div>
        </label>
      </div>
      <div class="round-edit-actions">
        <button class="inst-save-btn" onclick="saveEditRound('${cid}', ${panelIdx}, ${idx})">저장</button>
        <button class="inst-cancel-btn" onclick="cancelEditRound('${cid}', ${panelIdx})">취소</button>
      </div>
    </div>
  `;
  wireDateFields(row);
  document.getElementById(`edit-round-num-${panelIdx}-${idx}`)?.focus();
}

export async function saveEditRound(courseId, panelIdx, idx) {
  const round = panelRounds[panelIdx]?.[idx];
  if (!round) return;
  const numEl  = document.getElementById(`edit-round-num-${panelIdx}-${idx}`);
  const nameEl = document.getElementById(`edit-round-name-${panelIdx}-${idx}`);
  const number    = parseInt(numEl?.value);
  const name      = nameEl?.value.trim() || '';
  const startDate = readDateFields(`edit-round-start-${panelIdx}-${idx}`);
  const endDate   = readDateFields(`edit-round-end-${panelIdx}-${idx}`);

  if (!Number.isFinite(number) || number < 1) { numEl?.focus(); return; }
  if (!startDate || !endDate) { alert('기간을 정확히 입력해 주세요.'); return; }
  if (endDate < startDate) { alert('종료일이 시작일보다 빠를 수 없습니다.'); return; }

  const dup = (panelRounds[panelIdx] || []).find(r => r.number === number && r._id !== round._id);
  if (dup) { alert(`${number}회차가 이미 존재합니다.`); return; }

  const saveBtn = document.querySelector(`#round-row-${panelIdx}-${idx} .inst-save-btn`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
  try {
    await updateDoc(doc(db, 'courses', courseId, 'rounds', round._id), {
      number, name, startDate, endDate
    });
    await loadRounds(courseId, panelIdx);
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
  }
}

export async function cancelEditRound(courseId, panelIdx) {
  await loadRounds(courseId, panelIdx);
}

export async function toggleRoundActive(courseId, panelIdx, idx) {
  const round = panelRounds[panelIdx]?.[idx];
  if (!round) return;
  const newActive = round.active === false;
  const label = `${round.number}회차${round.name ? ` "${round.name}"` : ''}`;
  const msg = newActive
    ? `${label}을(를) 다시 활성 상태로 전환하시겠습니까?`
    : `${label}을(를) 종료 처리하시겠습니까?\n\n• 응답·강사 데이터는 보관됩니다.\n• 언제든 재활성 가능합니다.`;
  if (!confirm(msg)) return;

  try {
    await updateDoc(doc(db, 'courses', courseId, 'rounds', round._id), { active: newActive });
    await loadRounds(courseId, panelIdx);
  } catch (e) {
    alert('상태 변경 중 오류가 발생했습니다.');
  }
}

export async function deleteRound(courseId, panelIdx, idx) {
  const round = panelRounds[panelIdx]?.[idx];
  if (!round) return;
  const label = `${round.number}회차${round.name ? ` "${round.name}"` : ''}`;
  const msg = `${label}을(를) 영구 삭제하시겠습니까?\n\n` +
    `• 회차의 강사·응답 데이터가 모두 삭제됩니다.\n` +
    `• 이 작업은 되돌릴 수 없습니다.`;
  if (!confirm(msg)) return;

  try {
    // 회차 하위 컬렉션 정리 후 회차 문서 삭제
    const instSnap = await getDocs(collection(db, 'courses', courseId, 'rounds', round._id, 'instructors'));
    await Promise.all(instSnap.docs.map(d => deleteDoc(d.ref)));
    const respSnap = await getDocs(collection(db, 'courses', courseId, 'rounds', round._id, 'responses'));
    await Promise.all(respSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'courses', courseId, 'rounds', round._id));
    await loadRounds(courseId, panelIdx);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

// ── 회차별 강사 관리 (Phase 3) ──────────────────────────────
// 데이터 경로: courses/{cid}/rounds/{rid}/instructors/{iid}
// 캐시 키: `${panelIdx}-${roundIdx}` — 한 과정 카드 안에서도 회차별로 분리

const roundInstructorsCache = {};

// 회차 행의 [강사관리] 버튼: 같은 panelIdx 내에서 한 번에 한 회차만 열림 (아코디언)
export async function toggleRoundInstructors(courseId, panelIdx, roundIdx) {
  const round = panelRounds[panelIdx]?.[roundIdx];
  if (!round) return;
  const target = document.getElementById(`round-inst-panel-${panelIdx}-${roundIdx}`);
  const targetBtn = document.getElementById(`round-inst-btn-${panelIdx}-${roundIdx}`);
  if (!target) return;

  // 이미 열려있으면 닫기
  if (target.style.display !== 'none') {
    target.style.display = 'none';
    targetBtn?.classList.remove('active');
    return;
  }

  // 같은 회차관리 패널 내 다른 강사 패널 모두 닫기
  document.querySelectorAll(`#round-panel-${panelIdx} .round-inst-panel`).forEach(el => {
    if (el !== target) el.style.display = 'none';
  });
  document.querySelectorAll(`#round-panel-${panelIdx} .round-inst-btn.active`).forEach(b => {
    if (b !== targetBtn) b.classList.remove('active');
  });

  target.style.display = 'block';
  targetBtn?.classList.add('active');
  await loadRoundInstructors(courseId, round._id, panelIdx, roundIdx);
}

async function loadRoundInstructors(courseId, roundId, panelIdx, roundIdx) {
  const key = `${panelIdx}-${roundIdx}`;
  const panel = document.getElementById(`round-inst-panel-${panelIdx}-${roundIdx}`);
  if (!panel) return;
  panel.innerHTML = '<div class="inst-loading">불러오는 중...</div>';
  try {
    const snap = await getDocs(collection(db, 'courses', courseId, 'rounds', roundId, 'instructors'));
    let instructors = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    // order 우선, 없으면 createdAt — admin-courses의 loadInstructors와 동일 정책
    instructors.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      const ta = a.createdAt?.seconds || 0;
      const tb = b.createdAt?.seconds || 0;
      return ta - tb;
    });
    instructors.forEach((inst, i) => { if (inst.order === undefined) inst.order = i * 10; });
    roundInstructorsCache[key] = instructors;
    renderRoundInstructorsPanel(courseId, roundId, panelIdx, roundIdx, instructors);
  } catch (e) {
    panel.innerHTML = '<div class="inst-loading">불러오기 실패</div>';
  }
}

function renderRoundInstructorsPanel(courseId, roundId, panelIdx, roundIdx, instructors) {
  const panel = document.getElementById(`round-inst-panel-${panelIdx}-${roundIdx}`);
  const cid = escapeAttr(courseId);
  const rid = escapeAttr(roundId);
  const total = instructors.length;
  const k = `${panelIdx}-${roundIdx}`;
  const round = panelRounds[panelIdx]?.[roundIdx];
  const definedGroups = (round && Array.isArray(round.groups)) ? round.groups : [];
  const hasGroups = definedGroups.length > 0;

  // 분반 정의 영역 (분반 0개여도 추가 입력은 항상 노출)
  const groupChipsHtml = hasGroups
    ? definedGroups.map(g => `
        <span class="round-group-chip">
          <span class="rg-name">${escapeHtml(g)}</span>
          <button class="rg-rename" onclick="renameRoundGroup('${cid}', ${panelIdx}, ${roundIdx}, '${escapeAttr(g)}')" title="이름 변경">✏️</button>
          <button class="rg-delete" onclick="deleteRoundGroup('${cid}', ${panelIdx}, ${roundIdx}, '${escapeAttr(g)}')" title="삭제">✕</button>
        </span>`).join('')
    : '<span class="round-groups-empty">아직 분반이 정의되지 않았습니다. 분반 없이 운영하면 모든 강사가 모든 학생에게 노출됩니다.</span>';

  const groupsSectionHtml = `
    <div class="round-groups-section">
      <div class="round-groups-header">분반 정의 <span class="rg-count">${definedGroups.length}개</span></div>
      <div class="round-groups-add-row">
        <input type="text" id="round-group-name-${k}" placeholder="예: 1조" maxlength="20"
          onkeydown="if(event.key==='Enter')addRoundGroup('${cid}', ${panelIdx}, ${roundIdx})">
        <button class="add-btn" onclick="addRoundGroup('${cid}', ${panelIdx}, ${roundIdx})">+ 분반 추가</button>
      </div>
      <div class="round-groups-list">${groupChipsHtml}</div>
    </div>`;

  // 강사 추가 폼 위 분반 멀티 체크박스 — 단일 추가/엑셀 일괄등록 모두 이 상태 사용.
  // 기본값은 모든 분반 체크 (대부분 공통 강사). 특정 조 전용이면 다른 분반 체크 해제.
  const addGroupsCheckHtml = hasGroups
    ? `<div class="round-inst-add-groups" id="round-inst-add-groups-${k}">
         <span class="rg-pick-label">분반:</span>
         ${definedGroups.map(g =>
           `<label class="round-inst-group-chk"><input type="checkbox" data-group="${escapeAttr(g)}" checked><span>${escapeHtml(g)}</span></label>`
         ).join('')}
       </div>`
    : '';

  // 강사 테이블 분반 컬럼 (분반 정의된 경우만)
  const groupsCol = hasGroups ? '<th>분반</th>' : '';
  const groupsCellFn = inst => {
    if (!hasGroups) return '';
    const igs = Array.isArray(inst.groups) ? inst.groups : [];
    if (igs.length === 0) return '<td><span class="rg-empty">미지정</span></td>';
    const chips = igs.map(g => g === 'common'
      ? '<span class="rg-tag common">공통</span>'
      : `<span class="rg-tag">${escapeHtml(g)}</span>`).join(' ');
    return `<td>${chips}</td>`;
  };

  const listHtml = total === 0
    ? '<div class="inst-empty">등록된 강사가 없습니다. 강사를 추가해 주세요.</div>'
    : `<div class="student-bulk-actions">
        <button class="bulk-delete-btn" id="round-inst-bulk-delete-btn-${k}" onclick="deleteSelectedRoundInstructors('${cid}', '${rid}', ${panelIdx}, ${roundIdx})" disabled>선택 삭제</button>
       </div>
       <table class="student-table">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" id="round-inst-select-all-${k}" onclick="toggleRoundInstSelectAll(${panelIdx}, ${roundIdx}, this)"></th>
          <th>강의명</th><th>강사명</th>${groupsCol}<th style="width:160px">순서 / 관리</th>
        </tr></thead>
        <tbody>
          ${instructors.map((inst, i) => {
            const eid = escapeAttr(inst._id || '');
            const en = escapeAttr(inst.name || '');
            return `<tr id="round-inst-row-${k}-${i}">
              <td><input type="checkbox" class="round-inst-checkbox-${k}" data-id="${eid}" data-name="${en}" onchange="updateRoundInstBulkDeleteBtn(${panelIdx}, ${roundIdx})"></td>
              <td style="text-align:left">${escapeHtml(inst.education || '')}</td>
              <td style="text-align:left">${escapeHtml(inst.name || '')}</td>
              ${groupsCellFn(inst)}
              <td>
                <div class="inst-action-btns">
                  <button class="inst-move-btn" onclick="moveRoundInstructor('${cid}', '${rid}', ${panelIdx}, ${roundIdx}, ${i}, 'up')" ${i === 0 ? 'disabled' : ''} title="위로">▲</button>
                  <button class="inst-move-btn" onclick="moveRoundInstructor('${cid}', '${rid}', ${panelIdx}, ${roundIdx}, ${i}, 'down')" ${i === total - 1 ? 'disabled' : ''} title="아래로">▼</button>
                  <button class="inst-edit-btn" onclick="startEditRoundInstructor('${cid}', '${rid}', ${panelIdx}, ${roundIdx}, ${i})">수정</button>
                  <button class="delete-btn" onclick="deleteRoundInstructor('${cid}', '${rid}', ${panelIdx}, ${roundIdx}, '${eid}', '${en}', this)">삭제</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

  panel.innerHTML = `
    ${groupsSectionHtml}
    <div class="inst-add-row">
      <input type="text" id="round-inst-edu-${k}" placeholder="강의명 (예: 리더십 1교시)" maxlength="50">
      <input type="text" id="round-inst-name-${k}" placeholder="강사명 (예: 홍길동)" maxlength="20">
      <button class="add-btn round-inst-add-btn" onclick="addRoundInstructor('${cid}', '${rid}', ${panelIdx}, ${roundIdx})">+ 추가</button>
    </div>
    ${addGroupsCheckHtml}
    <div class="excel-upload-area" style="margin-top:.5rem;">
      <div class="excel-upload-label">엑셀 일괄 등록 <span class="excel-tip">A열: 강의명 / B열: 강사명 / 2행부터 데이터${hasGroups ? ' · 분반은 위 체크박스 상태가 일괄 적용됨' : ''}</span></div>
      <div class="excel-upload-row">
        <label class="excel-file-btn" for="round-inst-excel-input-${k}">파일 선택</label>
        <input type="file" id="round-inst-excel-input-${k}" accept=".xlsx,.xls" style="display:none" onchange="handleRoundInstExcelUpload(${panelIdx}, ${roundIdx}, this)">
        <span id="round-inst-excel-name-${k}" class="excel-file-name">선택된 파일 없음</span>
        <button class="add-btn" id="round-inst-excel-btn-${k}" onclick="uploadRoundExcelInstructors('${cid}', '${rid}', ${panelIdx}, ${roundIdx})" disabled>일괄 등록</button>
      </div>
      <div id="round-inst-excel-preview-${k}" class="excel-preview" style="display:none;"></div>
      <div id="round-inst-excel-progress-${k}" class="excel-progress" style="display:none;"></div>
    </div>
    <div class="inst-list">${listHtml}</div>
  `;
}

// 분반 멀티 체크박스에서 선택된 그룹 배열 추출 (강사 추가 폼 / 편집 행 모두 사용)
function readGroupsFromCheckboxes(containerEl) {
  if (!containerEl) return [];
  return Array.from(containerEl.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.dataset.group);
}

export async function addRoundInstructor(courseId, roundId, panelIdx, roundIdx) {
  const k = `${panelIdx}-${roundIdx}`;
  const eduEl  = document.getElementById(`round-inst-edu-${k}`);
  const nameEl = document.getElementById(`round-inst-name-${k}`);
  const edu  = eduEl?.value.trim();
  const name = nameEl?.value.trim();
  if (!edu)  { eduEl?.focus(); return; }
  if (!name) { nameEl?.focus(); return; }

  // 분반 정의된 회차에서는 groups 배열이 비면 차단
  const round = panelRounds[panelIdx]?.[roundIdx];
  const definedGroups = (round && Array.isArray(round.groups)) ? round.groups : [];
  let groups = null;
  if (definedGroups.length > 0) {
    groups = readGroupsFromCheckboxes(document.getElementById(`round-inst-add-groups-${k}`));
    if (groups.length === 0) {
      alert('이 강사가 속할 분반을 선택해 주세요. (공통 또는 하나 이상의 분반)');
      return;
    }
  }

  const cur = roundInstructorsCache[k] || [];
  const maxOrder = cur.length > 0 ? Math.max(...cur.map(i => i.order ?? 0)) : -10;

  const btn = document.querySelector(`#round-inst-panel-${panelIdx}-${roundIdx} .round-inst-add-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '추가 중...'; }
  try {
    const data = { name, education: edu, createdAt: serverTimestamp(), order: maxOrder + 10 };
    if (groups) data.groups = groups;
    await addDoc(collection(db, 'courses', courseId, 'rounds', roundId, 'instructors'), data);
    if (eduEl)  eduEl.value = '';
    if (nameEl) nameEl.value = '';
    await loadRoundInstructors(courseId, roundId, panelIdx, roundIdx);
  } catch (e) {
    alert('강사 추가 중 오류가 발생했습니다.');
    if (btn) { btn.disabled = false; btn.textContent = '+ 추가'; }
  }
}

export async function deleteRoundInstructor(courseId, roundId, panelIdx, roundIdx, instId, name, btnEl) {
  if (!confirm(`"${name}" 강사를 삭제하시겠습니까?`)) return;
  btnEl.disabled = true; btnEl.textContent = '삭제 중...';
  try {
    await deleteDoc(doc(db, 'courses', courseId, 'rounds', roundId, 'instructors', instId));
    await loadRoundInstructors(courseId, roundId, panelIdx, roundIdx);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    btnEl.disabled = false; btnEl.textContent = '삭제';
  }
}

export async function moveRoundInstructor(courseId, roundId, panelIdx, roundIdx, idx, direction) {
  const key = `${panelIdx}-${roundIdx}`;
  const insts = roundInstructorsCache[key];
  if (!insts) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= insts.length) return;

  const a = insts[idx], b = insts[targetIdx];
  const t = a.order; a.order = b.order; b.order = t;
  try {
    await Promise.all([
      updateDoc(doc(db, 'courses', courseId, 'rounds', roundId, 'instructors', a._id), { order: a.order }),
      updateDoc(doc(db, 'courses', courseId, 'rounds', roundId, 'instructors', b._id), { order: b.order }),
    ]);
    await loadRoundInstructors(courseId, roundId, panelIdx, roundIdx);
  } catch (e) {
    alert('순서 변경 중 오류가 발생했습니다.');
    const r = a.order; a.order = b.order; b.order = r;  // 메모리 롤백
  }
}

export function startEditRoundInstructor(courseId, roundId, panelIdx, roundIdx, idx) {
  const k = `${panelIdx}-${roundIdx}`;
  const inst = roundInstructorsCache[k]?.[idx];
  if (!inst) return;
  const row = document.getElementById(`round-inst-row-${k}-${idx}`);
  if (!row) return;
  const cid = escapeAttr(courseId);
  const rid = escapeAttr(roundId);
  const round = panelRounds[panelIdx]?.[roundIdx];
  const definedGroups = (round && Array.isArray(round.groups)) ? round.groups : [];
  const hasGroups = definedGroups.length > 0;
  const igs = Array.isArray(inst.groups) ? inst.groups : [];

  // 기존 'common' 키워드 강사는 모든 분반 체크된 상태로 시작 (저장하면 명시 분반 배열로 마이그레이션)
  const isLegacyCommon = igs.includes('common');
  const groupsTd = hasGroups
    ? `<td><div class="round-inst-edit-groups" id="round-inst-edit-groups-${k}-${idx}">
        ${definedGroups.map(g =>
          `<label class="round-inst-group-chk"><input type="checkbox" data-group="${escapeAttr(g)}"${(isLegacyCommon || igs.includes(g)) ? ' checked' : ''}><span>${escapeHtml(g)}</span></label>`
        ).join('')}
      </div></td>`
    : '';

  row.innerHTML = `
    <td><input type="checkbox" disabled></td>
    <td><input type="text" id="edit-rinst-edu-${k}-${idx}" value="${escapeAttr(inst.education || '')}" maxlength="50" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    <td><input type="text" id="edit-rinst-name-${k}-${idx}" value="${escapeAttr(inst.name || '')}" maxlength="20" style="width:100%;padding:.4rem .6rem;border:2px solid #0066cc;border-radius:7px;font-size:.88rem;"></td>
    ${groupsTd}
    <td>
      <div class="inst-action-btns">
        <button class="inst-save-btn" onclick="saveEditRoundInstructor('${cid}', '${rid}', ${panelIdx}, ${roundIdx}, ${idx})">저장</button>
        <button class="inst-cancel-btn" onclick="cancelEditRoundInstructor('${cid}', '${rid}', ${panelIdx}, ${roundIdx})">취소</button>
      </div>
    </td>`;
  document.getElementById(`edit-rinst-edu-${k}-${idx}`)?.focus();
}

export async function saveEditRoundInstructor(courseId, roundId, panelIdx, roundIdx, idx) {
  const k = `${panelIdx}-${roundIdx}`;
  const inst = roundInstructorsCache[k]?.[idx];
  if (!inst) return;
  const eduEl  = document.getElementById(`edit-rinst-edu-${k}-${idx}`);
  const nameEl = document.getElementById(`edit-rinst-name-${k}-${idx}`);
  const edu  = eduEl?.value.trim();
  const name = nameEl?.value.trim();
  if (!edu)  { eduEl?.focus(); return; }
  if (!name) { nameEl?.focus(); return; }

  // 분반 정의된 회차에서는 groups 비면 차단
  const round = panelRounds[panelIdx]?.[roundIdx];
  const definedGroups = (round && Array.isArray(round.groups)) ? round.groups : [];
  let groups = null;
  if (definedGroups.length > 0) {
    groups = readGroupsFromCheckboxes(document.getElementById(`round-inst-edit-groups-${k}-${idx}`));
    if (groups.length === 0) {
      alert('이 강사가 속할 분반을 선택해 주세요. (공통 또는 하나 이상의 분반)');
      return;
    }
  }

  const saveBtn = document.querySelector(`#round-inst-row-${k}-${idx} .inst-save-btn`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
  try {
    const updateData = { name, education: edu };
    if (groups) updateData.groups = groups;
    await updateDoc(doc(db, 'courses', courseId, 'rounds', roundId, 'instructors', inst._id), updateData);
    await loadRoundInstructors(courseId, roundId, panelIdx, roundIdx);
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
  }
}

export async function cancelEditRoundInstructor(courseId, roundId, panelIdx, roundIdx) {
  await loadRoundInstructors(courseId, roundId, panelIdx, roundIdx);
}

// ── 회차 강사 일괄선택 삭제 + 엑셀 일괄등록 (Phase 3 보완) ──────────────────────────────
// 단기과정 강사관리(admin-courses.js)의 패턴을 회차별로 복제.
// 엑셀 파싱 결과는 패널-회차 키별로 보관해 다른 회차의 미리보기와 충돌하지 않게 한다.

const roundInstExcelData = {};

export function handleRoundInstExcelUpload(panelIdx, roundIdx, input) {
  const k = `${panelIdx}-${roundIdx}`;
  const fileName = input.files[0]?.name || '선택된 파일 없음';
  document.getElementById(`round-inst-excel-name-${k}`).textContent = fileName;
  if (input.files[0]) parseRoundInstExcelFile(panelIdx, roundIdx, input.files[0]);
}

async function parseRoundInstExcelFile(panelIdx, roundIdx, file) {
  const k = `${panelIdx}-${roundIdx}`;
  document.getElementById(`round-inst-excel-preview-${k}`).style.display = 'none';
  document.getElementById(`round-inst-excel-progress-${k}`).style.display = 'none';
  document.getElementById(`round-inst-excel-btn-${k}`).disabled = true;
  roundInstExcelData[k] = [];

  await loadXLSX();
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const parsed = [], errors = [];
      for (let i = 1; i < rows.length; i++) {
        const edu  = String(rows[i][0] || '').trim();
        const name = String(rows[i][1] || '').trim();
        if (!edu && !name) continue;
        if (!edu)  { errors.push(`${i+1}행: 강의명이 없습니다.`); continue; }
        if (!name) { errors.push(`${i+1}행: 강사명이 없습니다.`); continue; }
        parsed.push({ edu, name });
      }

      const preview = document.getElementById(`round-inst-excel-preview-${k}`);
      preview.style.display = 'block';

      if (parsed.length === 0 && errors.length === 0) {
        preview.innerHTML = '<div class="excel-preview-error">데이터가 없습니다. 파일을 확인해 주세요.</div>';
        return;
      }

      let html = `<strong>총 ${parsed.length}건 인식됨</strong>`;
      if (errors.length > 0) {
        html += errors.map(err => `<div class="excel-preview-error">${escapeHtml(err)}</div>`).join('');
      }
      html += parsed.map((s, i) =>
        `<div class="excel-preview-row">${i+1}. [${escapeHtml(s.edu)}] ${escapeHtml(s.name)}</div>`
      ).join('');
      preview.innerHTML = html;

      if (parsed.length > 0) {
        roundInstExcelData[k] = parsed;
        document.getElementById(`round-inst-excel-btn-${k}`).disabled = false;
      }
    } catch (_) {
      const preview = document.getElementById(`round-inst-excel-preview-${k}`);
      preview.style.display = 'block';
      preview.innerHTML = '<div class="excel-preview-error">파일을 읽을 수 없습니다. 엑셀 형식(.xlsx/.xls)인지 확인해 주세요.</div>';
    }
  };
  reader.readAsArrayBuffer(file);
}

export async function uploadRoundExcelInstructors(courseId, roundId, panelIdx, roundIdx) {
  const k = `${panelIdx}-${roundIdx}`;
  const data = roundInstExcelData[k];
  if (!data || data.length === 0) return;

  // 분반 정의된 회차면 추가 폼의 분반 체크박스 상태를 일괄 적용 — 비면 차단
  const round = panelRounds[panelIdx]?.[roundIdx];
  const definedGroups = (round && Array.isArray(round.groups)) ? round.groups : [];
  let groups = null;
  if (definedGroups.length > 0) {
    groups = readGroupsFromCheckboxes(document.getElementById(`round-inst-add-groups-${k}`));
    if (groups.length === 0) {
      alert('이 강사들이 속할 분반을 선택해 주세요. (공통 또는 하나 이상의 분반)');
      return;
    }
  }

  const btn = document.getElementById(`round-inst-excel-btn-${k}`);
  btn.disabled = true;
  const progress = document.getElementById(`round-inst-excel-progress-${k}`);
  progress.style.display = 'block';

  const cur = roundInstructorsCache[k] || [];
  const maxOrder = cur.length > 0 ? Math.max(...cur.map(i => i.order ?? 0)) : -10;

  const instRef = collection(db, 'courses', courseId, 'rounds', roundId, 'instructors');
  const total = data.length;
  const CHUNK = 400;
  let success = 0, fail = 0;

  for (let start = 0; start < total; start += CHUNK) {
    const slice = data.slice(start, start + CHUNK);
    progress.textContent = `등록 중... (${start + slice.length}/${total})`;
    const batch = writeBatch(db);
    slice.forEach(({ edu, name }, j) => {
      const docData = {
        name, education: edu,
        createdAt: serverTimestamp(),
        order: maxOrder + (start + j + 1) * 10
      };
      if (groups) docData.groups = groups;
      batch.set(doc(instRef), docData);
    });
    try {
      await batch.commit();
      success += slice.length;
    } catch (_) {
      fail += slice.length;
    }
  }

  progress.textContent = `완료: ${success}건 등록${fail > 0 ? `, ${fail}건 실패` : ''}`;
  roundInstExcelData[k] = [];
  document.getElementById(`round-inst-excel-input-${k}`).value = '';
  document.getElementById(`round-inst-excel-name-${k}`).textContent = '선택된 파일 없음';
  document.getElementById(`round-inst-excel-preview-${k}`).style.display = 'none';

  await loadRoundInstructors(courseId, roundId, panelIdx, roundIdx);
}

export function toggleRoundInstSelectAll(panelIdx, roundIdx, checkbox) {
  const k = `${panelIdx}-${roundIdx}`;
  document.querySelectorAll(`.round-inst-checkbox-${k}`).forEach(cb => cb.checked = checkbox.checked);
  updateRoundInstBulkDeleteBtn(panelIdx, roundIdx);
}

export function updateRoundInstBulkDeleteBtn(panelIdx, roundIdx) {
  const k = `${panelIdx}-${roundIdx}`;
  const all     = document.querySelectorAll(`.round-inst-checkbox-${k}`);
  const checked = document.querySelectorAll(`.round-inst-checkbox-${k}:checked`);
  const btn     = document.getElementById(`round-inst-bulk-delete-btn-${k}`);
  const selectAll = document.getElementById(`round-inst-select-all-${k}`);
  if (btn) {
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length > 0 ? `선택 삭제 (${checked.length}명)` : '선택 삭제';
  }
  if (selectAll && all.length > 0) {
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    selectAll.checked = checked.length === all.length;
  }
}

export async function deleteSelectedRoundInstructors(courseId, roundId, panelIdx, roundIdx) {
  const k = `${panelIdx}-${roundIdx}`;
  const checked = document.querySelectorAll(`.round-inst-checkbox-${k}:checked`);
  if (!checked.length) return;
  const count = checked.length;
  if (!confirm(`선택한 ${count}명의 강사를 삭제하시겠습니까?`)) return;
  const btn = document.getElementById(`round-inst-bulk-delete-btn-${k}`);
  btn.disabled = true; btn.textContent = '삭제 중...';
  try {
    await Promise.all(Array.from(checked).map(cb =>
      deleteDoc(doc(db, 'courses', courseId, 'rounds', roundId, 'instructors', cb.dataset.id))
    ));
    await loadRoundInstructors(courseId, roundId, panelIdx, roundIdx);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
    btn.disabled = false; btn.textContent = `선택 삭제 (${count}명)`;
  }
}

// ── 분반 CRUD (Phase 5-α) ──────────────────────────────
// 분반은 회차 문서의 groups: string[] 에 저장. 분반 이름이 곧 식별자.
// 강사 문서의 groups: string[] 는 'common' 키워드 또는 분반 이름들.
// 분반 미정의(groups 빈 배열) 회차는 모든 강사가 모든 학생에게 노출 (호환).

const RESERVED_GROUP_NAMES = new Set(['common', 'COMMON', 'Common']);

export async function addRoundGroup(courseId, panelIdx, roundIdx) {
  const k = `${panelIdx}-${roundIdx}`;
  const round = panelRounds[panelIdx]?.[roundIdx];
  if (!round) return;
  const input = document.getElementById(`round-group-name-${k}`);
  const name = (input?.value || '').trim();
  if (!name) { input?.focus(); return; }
  if (name.length > 20) { alert('분반 이름은 20자 이하로 입력해 주세요.'); return; }
  if (RESERVED_GROUP_NAMES.has(name)) { alert('"common"은 예약어입니다. 다른 이름을 사용해 주세요.'); return; }

  const groups = Array.isArray(round.groups) ? round.groups : [];
  if (groups.includes(name)) { alert(`이미 "${name}" 분반이 존재합니다.`); return; }

  try {
    const newGroups = [...groups, name];
    await updateDoc(doc(db, 'courses', courseId, 'rounds', round._id), { groups: newGroups });
    round.groups = newGroups;
    if (input) input.value = '';
    await loadRoundInstructors(courseId, round._id, panelIdx, roundIdx);
  } catch (e) {
    alert('분반 추가 중 오류가 발생했습니다.');
  }
}

export async function renameRoundGroup(courseId, panelIdx, roundIdx, oldName) {
  const k = `${panelIdx}-${roundIdx}`;
  const round = panelRounds[panelIdx]?.[roundIdx];
  if (!round) return;
  const newName = (prompt(`"${oldName}" 분반의 새 이름을 입력해 주세요.`, oldName) || '').trim();
  if (!newName || newName === oldName) return;
  if (newName.length > 20) { alert('분반 이름은 20자 이하로 입력해 주세요.'); return; }
  if (RESERVED_GROUP_NAMES.has(newName)) { alert('"common"은 예약어입니다.'); return; }

  const groups = Array.isArray(round.groups) ? round.groups : [];
  if (groups.includes(newName)) { alert(`이미 "${newName}" 분반이 존재합니다.`); return; }

  try {
    const newGroups = groups.map(g => g === oldName ? newName : g);
    const insts = roundInstructorsCache[k] || [];
    const affectedInsts = insts.filter(i => Array.isArray(i.groups) && i.groups.includes(oldName));

    const batch = writeBatch(db);
    batch.update(doc(db, 'courses', courseId, 'rounds', round._id), { groups: newGroups });
    affectedInsts.forEach(inst => {
      const newIgs = inst.groups.map(g => g === oldName ? newName : g);
      batch.update(doc(db, 'courses', courseId, 'rounds', round._id, 'instructors', inst._id), { groups: newIgs });
    });
    await batch.commit();
    round.groups = newGroups;
    await loadRoundInstructors(courseId, round._id, panelIdx, roundIdx);
  } catch (e) {
    alert('분반 이름 변경 중 오류가 발생했습니다.');
  }
}

export async function deleteRoundGroup(courseId, panelIdx, roundIdx, name) {
  const k = `${panelIdx}-${roundIdx}`;
  const round = panelRounds[panelIdx]?.[roundIdx];
  if (!round) return;
  const insts = roundInstructorsCache[k] || [];
  const affected = insts.filter(i => Array.isArray(i.groups) && i.groups.includes(name));

  let msg = `"${name}" 분반을 삭제하시겠습니까?`;
  if (affected.length > 0) {
    msg += `\n\n${affected.length}명의 강사 분반 지정에서 "${name}" 이(가) 자동 제거됩니다.`;
  }
  if (!confirm(msg)) return;

  try {
    const groups = Array.isArray(round.groups) ? round.groups : [];
    const newGroups = groups.filter(g => g !== name);
    const batch = writeBatch(db);
    batch.update(doc(db, 'courses', courseId, 'rounds', round._id), { groups: newGroups });
    affected.forEach(inst => {
      const newIgs = inst.groups.filter(g => g !== name);
      batch.update(doc(db, 'courses', courseId, 'rounds', round._id, 'instructors', inst._id), { groups: newIgs });
    });
    await batch.commit();
    round.groups = newGroups;
    await loadRoundInstructors(courseId, round._id, panelIdx, roundIdx);
  } catch (e) {
    alert('분반 삭제 중 오류가 발생했습니다.');
  }
}
