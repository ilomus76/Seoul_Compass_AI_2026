/* 시간대별 일정표 렌더링 + 행 선택/시간 수정 */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '-' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function render(tableBody, conflictBox, schedule, handlers) {
    if (!tableBody) return;
    const rows = (schedule && schedule.timeline) || [];
    const colors = (global.SeoulCharts && global.SeoulCharts.COLORS) || {};
    const names = (global.SeoulCharts && global.SeoulCharts.NAMES_KO) || {};
    handlers = handlers || {};

    tableBody.innerHTML = rows.length
      ? rows.map((r, i) => `<tr data-index="${i}" class="schedule-row">
          <td><span class="activity-chip" style="background:${colors[r.category] || '#4fe0c4'}">${esc(names[r.category] || r.category)}</span></td>
          <td>${esc(r.place)}</td>
          <td><input class="time-edit" type="time" data-index="${i}" value="${esc(r.planned_start || r.estimated_start)}" /></td>
          <td>${esc(r.estimated_start)}</td><td>${esc(r.estimated_end)}</td>
          <td>${r.fixed_time ? '고정' : '추정'}</td></tr>`).join('')
      : '<tr><td colspan="6">분석 결과가 없습니다.</td></tr>';

    tableBody.querySelectorAll('.schedule-row').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.classList.contains('time-edit')) return;
        if (handlers.onSelect) handlers.onSelect(Number(tr.dataset.index));
      });
    });
    tableBody.querySelectorAll('.time-edit').forEach((input) => {
      input.addEventListener('change', () => {
        if (handlers.onTimeChange) handlers.onTimeChange(Number(input.dataset.index), input.value);
      });
    });

    if (conflictBox) {
      const conflicts = (schedule && schedule.conflicts) || [];
      conflictBox.textContent = conflicts.length
        ? `일정 충돌 ${conflicts.length}건: ` + conflicts.map((c) =>
            `${c.activity_id}번 활동 ${c.shortage_minutes}분 초과`).join(', ')
        : (schedule && schedule.note) || '';
    }
  }

  function renderDetail(container, data, handlers) {
    if (!container) return;
    if (!data) { container.hidden = true; return; }
    container.hidden = false;
    const { activity, place, node, candidates } = data;
    const options = (candidates || []).map((p) =>
      `<option value="${esc(p.id)}" ${p.id === place.id ? 'selected' : ''}>${esc(p.name)} · ${p.distance_km}km · ${p.score || 0}점</option>`).join('');
    container.innerHTML = `<h3>${esc(activity.category)} · ${esc(place.name)}</h3>
      <div class="detail-grid">
        <div><b>운영시간</b>${esc(place.hours || '확인 필요')}</div>
        <div><b>이동방법</b>${esc(node.travel_minutes || 0)}분 · ${esc(node.distance_km || 0)}km 추정</div>
        <div><b>예상 비용</b>${place.fee_krw || 0}원</div>
        <div><b>추천 점수</b>${place.score || 0}점 · 신뢰도 ${Math.round((place.confidence || 0) * 100)}%</div>
        <div><b>교통</b>${esc(place.address || '')}</div>
        <div><b>안내</b>${esc(place.description || '')}</div>
      </div>
      <div class="detail-actions">
        <label style="margin:0;flex:1;min-width:180px">장소 변경
          <select class="place-select">${options}</select></label>
        <button type="button" class="ghost apply-place">장소 적용</button>
        <button type="button" class="ghost close-detail">닫기</button>
      </div>`;
    container.querySelector('.apply-place').addEventListener('click', () => {
      const id = container.querySelector('.place-select').value;
      const chosen = candidates.find((p) => p.id === id);
      if (chosen && handlers.onPlaceChange) handlers.onPlaceChange(chosen);
    });
    container.querySelector('.close-detail').addEventListener('click', () => { container.hidden = true; });
  }

  global.SeoulScheduleView = { render, renderDetail };
})(window);
