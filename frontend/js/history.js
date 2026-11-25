/* 나의 여행 기록 화면: 일정 목록 + 실제 방문 기록 */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function render(container, trips, handlers) {
    if (!container) return;
    if (!trips.length) { container.innerHTML = '<p>저장된 여행 기록이 없습니다.</p>'; return; }
    container.innerHTML = trips.map((t) => `<article class="trip-card" data-id="${esc(t.trip_id)}">
      <h3>${esc(t.date)} · ${esc(t.trip_id)}</h3>
      <p>${(t.activities || []).map((a) => esc(a.category)).join(' → ') || '활동 없음'}</p>
      <div class="detail-actions">
        <button type="button" class="reuse">이 일정 다시 사용</button>
        <button type="button" class="view">방문 기록</button>
        <button type="button" class="visit">방문 완료 기록</button>
        <button type="button" class="danger delete">삭제</button>
      </div>
    </article>`).join('');

    const idOf = (btn) => btn.parentElement.parentElement.dataset.id;
    container.querySelectorAll('.reuse').forEach((b) => b.addEventListener('click', () => {
      const trip = trips.find((t) => t.trip_id === idOf(b));
      handlers.onReuse(trip);
    }));
    container.querySelectorAll('.view').forEach((b) => b.addEventListener('click', () => handlers.onView(idOf(b))));
    container.querySelectorAll('.visit').forEach((b) => b.addEventListener('click', () => handlers.onVisit(idOf(b))));
    container.querySelectorAll('.delete').forEach((b) => b.addEventListener('click', () => handlers.onDelete(idOf(b))));
  }

  function renderVisits(container, tripId, visits, handlers) {
    if (!container) return;
    container.hidden = false;
    const rows = visits.length
      ? visits.map((v) => `<div class="visit-row" data-id="${v.visit_id}">
          <span>${esc(v.place_name)} · ${esc(v.status)}</span>
          <span>${esc(v.actual_start || '-')}</span>
          <span>${v.actual_cost_krw || 0}원</span>
          <button type="button" class="danger remove-visit">삭제</button>
        </div>`).join('')
      : '<p>아직 방문 기록이 없습니다.</p>';
    const places = (handlers.places || []).map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    container.innerHTML = `<h3>${esc(tripId)} · 실제 방문 기록</h3>${rows}
      <div class="visit-row">
        <select id="visitPlace">${places}</select>
        <input id="visitCost" type="number" placeholder="비용(원)" />
        <input id="visitMemo" type="text" placeholder="메모" />
        <button type="button" class="primary add-visit">기록 추가</button>
      </div>`;
    container.querySelector('.add-visit').addEventListener('click', () => {
      handlers.onAdd({
        place_name: container.querySelector('#visitPlace').value,
        actual_cost_krw: Number(container.querySelector('#visitCost').value) || 0,
        memo: container.querySelector('#visitMemo').value,
        status: 'visited',
        actual_start: new Date().toTimeString().slice(0, 5)
      });
    });
    container.querySelectorAll('.remove-visit').forEach((b) => b.addEventListener('click', () => {
      handlers.onRemove(b.parentElement.dataset.id);
    }));
  }

  global.SeoulHistoryView = { render, renderVisits };
})(window);
