import { db } from './firebase-config.js';
import {
  collection, getDocs, addDoc, deleteDoc, doc, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { escapeHtml, escapeAttr } from './admin-utils.js';
import { renderDateFields, readDateFields, wireDateFields } from './admin-courses.js';

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
    <div class="round-row ${active ? '' : 'is-closed'}" id="round-row-${panelIdx}-${idx}">
      <div class="round-row-info">
        <span class="round-num">${round.number}회차</span>
        ${nameLabel}
        ${status}
        ${dateLabel ? `<span class="round-date">${escapeHtml(dateLabel)}</span>` : ''}
      </div>
      <div class="round-row-actions">
        <button class="round-edit-btn" onclick="startEditRound('${cid}', ${panelIdx}, ${idx})">수정</button>
        <button class="round-toggle-btn ${active ? 'closer' : 'reopen'}" onclick="toggleRoundActive('${cid}', ${panelIdx}, ${idx})">${active ? '종료' : '재활성'}</button>
        <button class="delete-btn round-del-btn" onclick="deleteRound('${cid}', ${panelIdx}, ${idx})">삭제</button>
      </div>
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
