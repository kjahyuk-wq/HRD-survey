import { db } from './firebase-config.js';
import {
  collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { state, escapeHtml, escapeAttr } from './admin-utils.js';

function buildCourseLabel(name, startDate, endDate, active) {
  const dateLabel = (startDate && endDate)
    ? ` (${String(startDate).replaceAll('-', '.')}~${String(endDate).replaceAll('-', '.')})`
    : '';
  return (active ? '' : '[종료] ') + name + dateLabel;
}

export async function populatePreviewSelect() {
  try {
    const snap = await getDocs(collection(db, 'courses'));
    const courses = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        active: data.active !== false,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        type: data.type === 'leadership' ? 'leadership' : 'standard',
      };
    });
    courses.sort((a, b) => (a.active === b.active) ? 0 : (a.active ? -1 : 1));
    const sel = document.getElementById('preview-course-select');
    const current = sel.value;
    sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
      courses.map(({ id, name, startDate, endDate, active, type }) => {
        const label = buildCourseLabel(name, startDate, endDate, active);
        return `<option value="${escapeAttr(id)}" data-name="${escapeAttr(name)}" data-type="${type}"${id === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
    if (current) loadPreviewInstructors();
  } catch (e) {}
}

// 미리보기용 회차 셀렉트 — stats 모듈과 동일 패턴 (캐시 키로 같은 과정 재선택 시 재요청 회피)
let lastPopulatedPreviewRoundCourseId = null;
async function populatePreviewRoundSelect(courseId) {
  const sel = document.getElementById('preview-round-select');
  sel.disabled = false;
  sel.innerHTML = '<option value="">-- 회차 선택 --</option>';
  try {
    const snap = await getDocs(collection(db, 'courses', courseId, 'rounds'));
    const rounds = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
    rounds.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    if (rounds.length === 0) {
      sel.innerHTML = '<option value="">등록된 회차 없음</option>';
      sel.disabled = true;
      return;
    }
    sel.innerHTML += rounds.map(r => {
      const closed = r.active === false ? ' [종료]' : '';
      const label = (r.name ? `${r.number}회차 · ${r.name}` : `${r.number}회차`) + closed;
      return `<option value="${escapeAttr(r._id)}">${escapeHtml(label)}</option>`;
    }).join('');
  } catch (_) {
    sel.innerHTML = '<option value="">회차 불러오기 실패</option>';
    sel.disabled = true;
  }
}

export async function loadPreviewInstructors() {
  const sel = document.getElementById('preview-course-select');
  const courseId = sel?.value;
  const opt = sel?.options?.[sel.selectedIndex];
  const courseLabel = opt?.textContent || '';
  const courseType = opt?.dataset.type === 'leadership' ? 'leadership' : 'standard';
  const badge = document.getElementById('preview-course-badge');
  const container = document.getElementById('preview-instructor-questions');
  const roundSel = document.getElementById('preview-round-select');

  if (!courseId) {
    badge.textContent = '교육과정을 선택하세요';
    container.innerHTML = '';
    roundSel.style.display = 'none';
    return;
  }

  // 회차 셀렉트 표시/숨김 분기 (중견리더만 노출)
  if (courseType === 'leadership') {
    if (lastPopulatedPreviewRoundCourseId !== courseId) {
      await populatePreviewRoundSelect(courseId);
      lastPopulatedPreviewRoundCourseId = courseId;
    }
    roundSel.style.display = 'inline-block';
  } else {
    roundSel.style.display = 'none';
  }

  const roundId = courseType === 'leadership' ? roundSel.value : '';

  // 중견리더인데 회차 미선택 — 안내만 보이고 강사 문항 비움
  if (courseType === 'leadership' && !roundId) {
    badge.textContent = courseLabel;
    container.innerHTML = '<div class="no-data" style="margin:0.5rem 0;">회차를 선택해 주세요.</div>';
    return;
  }

  // 라벨 갱신 (중견리더는 회차 라벨도 함께)
  let displayLabel = courseLabel;
  if (courseType === 'leadership') {
    const rOpt = roundSel.options[roundSel.selectedIndex];
    displayLabel = `${courseLabel} · ${rOpt?.textContent || ''}`;
  }
  badge.textContent = displayLabel;

  container.innerHTML = '<div class="loading" style="text-align:center;padding:1rem;">강사 정보 불러오는 중...</div>';
  try {
    const instructorsRef = courseType === 'leadership'
      ? collection(db, 'courses', courseId, 'rounds', roundId, 'instructors')
      : collection(db, 'courses', courseId, 'instructors');
    const instSnap = await getDocs(query(instructorsRef, orderBy('createdAt')));
    const instructors = instSnap.docs.map(d => d.data());

    if (instructors.length === 0) {
      container.innerHTML = '<div class="no-data" style="margin:0.5rem 0;">등록된 강사가 없습니다.</div>';
      return;
    }

    container.innerHTML = instructors.map((inst, i) => {
      const qNum = 17 + i;
      const nameLabel = inst.education ? `${escapeHtml(inst.education)} · ${escapeHtml(inst.name)}` : escapeHtml(inst.name);
      const ratingHtml = [1,2,3,4,5].map((v, vi) => {
        const labels = ['매우 불만족','불만족','보통','만족','매우 만족'];
        return `<label class="rating-label"><input type="radio" name="pq${qNum}" value="${v}"><span class="rating-btn">${v}<br><small>${labels[vi]}</small></span></label>`;
      }).join('');
      return `<div class="q-card">
        <div class="q-num">Q${qNum}</div>
        <div class="q-txt">
          <div style="font-size:.8rem;color:#888;margin-bottom:.3rem;">강사 만족도 · ${nameLabel}</div>
          강사의 전반적인 강의 만족도는?
        </div>
        <div class="rating-group">${ratingHtml}</div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="no-data">강사 정보를 불러오지 못했습니다.</div>';
  }
}
