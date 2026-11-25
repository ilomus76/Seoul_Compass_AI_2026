/* 나의 여행 기록 화면 */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function render(container, trips, handlers) {
    if (!container) return;
    if (!trips.length) { container.innerHTML = '<p>저장된 여행 기록이 없습니다.</p>'; return; }
    container.innerHTML = trips.map((t) => `<article class="trip-card" data-id="${esc(t.trip_id)}">
      <h3>${esc(t.date)} · ${esc(t.trip_id)}</h3>
      <p>${(t.activities || []).map((a) => esc(a.category)).join(' → ') || '활동 없음'}</p>
      <button type="button" class="reuse">이 일정 다시 사용</button>
      <button type="button" class="visit">방문 완료 기록</button>
      <button type="button" class="danger delete">삭제</button>
    </article>`).join('');

    container.querySelectorAll('.reuse').forEach((b) => b.addEventListener('click', () => {
      const trip = trips.find((t) => t.trip_id === b.parentElement.dataset.id);
      handlers.onReuse(trip);
    }));
    container.querySelectorAll('.visit').forEach((b) => b.addEventListener('click', () => {
      handlers.onVisit(b.parentElement.dataset.id);
    }));
    container.querySelectorAll('.delete').forEach((b) => b.addEventListener('click', () => {
      handlers.onDelete(b.parentElement.dataset.id);
    }));
  }

  global.SeoulHistoryView = { render };
})(window);
