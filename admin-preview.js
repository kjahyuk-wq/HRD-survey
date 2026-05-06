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
      };
    });
    courses.sort((a, b) => (a.active === b.active) ? 0 : (a.active ? -1 : 1));
    const sel = document.getElementById('preview-course-select');
    const current = sel.value;
    sel.innerHTML = '<option value="">-- 교육과정을 선택하세요 --</option>' +
      courses.map(({ id, name, startDate, endDate, active }) => {
        const label = buildCourseLabel(name, startDate, endDate, active);
        return `<option value="${escapeAttr(id)}" data-name="${escapeAttr(name)}"${id === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
    if (current) loadPreviewInstructors();
  } catch (e) {}
}

export async function loadPreviewInstructors() {
  const sel = document.getElementById('preview-course-select');
  const courseId = sel?.value;
  const opt = sel?.options?.[sel.selectedIndex];
  const courseLabel = opt?.textContent || '';
  const badge = document.getElementById('preview-course-badge');
  const container = document.getElementById('preview-instructor-questions');

  badge.textContent = courseLabel || '교육과정을 선택하세요';

  if (!courseId) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="loading" style="text-align:center;padding:1rem;">강사 정보 불러오는 중...</div>';
  try {
    const instSnap = await getDocs(query(collection(db, 'courses', courseId, 'instructors'), orderBy('createdAt')));
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
