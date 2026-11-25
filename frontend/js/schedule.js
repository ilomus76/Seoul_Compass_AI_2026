/* 시간대별 일정표 렌더링 */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '-' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function render(tableBody, conflictBox, schedule) {
    if (!tableBody) return;
    const rows = (schedule && schedule.timeline) || [];
    tableBody.innerHTML = rows.length
      ? rows.map((r) => `<tr><td>${esc(r.category)}</td><td>${esc(r.place)}</td>
          <td>${esc(r.planned_start)}</td><td>${esc(r.estimated_start)}</td>
          <td>${esc(r.estimated_end)}</td><td>${r.fixed_time ? '고정' : '추정'}</td></tr>`).join('')
      : '<tr><td colspan="6">분석 결과가 없습니다.</td></tr>';

    if (conflictBox) {
      const conflicts = (schedule && schedule.conflicts) || [];
      conflictBox.textContent = conflicts.length
        ? `일정 충돌 ${conflicts.length}건: ` + conflicts.map((c) =>
            `${c.activity_id}번 활동 ${c.shortage_minutes}분 초과`).join(', ')
        : (schedule && schedule.note) || '';
    }
  }

  global.SeoulScheduleView = { render };
})(window);
