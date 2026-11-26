/* 시간대별 일정표 렌더링 + 행 선택/시간 수정 */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '-' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function render(tableBody, conflictBox, schedule, handlers) {
    if (!tableBody) return;
    const rows = (schedule && schedule.timeline) || [];
    const colors = (global.SeoulCharts && global.SeoulCharts.COLORS) || {};
    const names = {...global.SeoulCharts?.NAMES_KO, baseball_game:'야구 경기 관람',
      baseball_event:'야구 행사 관람', return_to_current:'현재 위치 복귀'};
    handlers = handlers || {};

    tableBody.innerHTML = rows.length
      ? rows.map((r, i) => `<tr data-index="${i}" class="schedule-row">
          <td><span class="activity-chip" style="background:${colors[r.category] || '#4fe0c4'}">${esc(names[r.category] || r.category)}</span></td>
          <td><span${r.visit_warning ? ' class="visit-warning"' : ''}>${esc(r.place)}</span>${global.SeoulRouteView.visitWarning(r.visit_warning)}</td>
          <td><input class="time-edit" type="time" data-index="${i}" value="${esc(r.planned_start || r.estimated_start)}"${r.official_event_time ? ' disabled' : ''} /></td>
          <td>${esc(r.estimated_start)}</td><td>${esc(r.estimated_end)}</td>
          <td>${r.official_event_time ? '공식 시작 시각' : r.fixed_time ? '고정 시각' : '유연 시각'}${r.duration_estimated ? ' · 체류 추정' : ''}<br>
          ${r.opening_wait_minutes ? `<span>개장·영업 대기 ${r.opening_wait_minutes}분</span><br>` : ''}
          ${r.buffer_minutes || r.travel_minutes ? `<span>${r.travel_source ? '길찾기' : '이동 추정'} ${r.travel_minutes}분${r.buffer_minutes ? ` + 여유 ${r.buffer_minutes}분` : ''}</span><br>` : ''}
          ${r.availability_checked ? '<span>공개 운영시간 적용</span><br>' :
            !r.official_event_time && !r.visit_warning && !['return_to_start','return_to_current','destination'].includes(r.category)
              ? '<span>운영시간 확인 필요</span><br>' : ''}
          <input class="duration-edit" aria-label="${i + 1}번 활동 체류시간(분)" type="number" min="${['return_to_start','return_to_current','destination'].includes(r.category) ? 0 : 1}" max="1440" data-index="${i}" value="${r.duration_minutes}" style="width:64px">분</td></tr>`).join('')
      : '<tr><td colspan="6">분석 결과가 없습니다.</td></tr>';

    tableBody.querySelectorAll('.schedule-row').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.matches('.time-edit,.duration-edit')) return;
        if (handlers.onSelect) handlers.onSelect(Number(tr.dataset.index));
      });
    });
    tableBody.querySelectorAll('.time-edit').forEach((input) => {
      input.addEventListener('change', () => {
        if (handlers.onTimeChange) handlers.onTimeChange(Number(input.dataset.index), input.value);
      });
    });
    tableBody.querySelectorAll('.duration-edit').forEach(input => input.addEventListener('change', () => {
      const value = Number(input.value);
      if (input.checkValidity() && Number.isInteger(value) && handlers.onDurationChange) {
        handlers.onDurationChange(Number(input.dataset.index), value);
      }
    }));

    if (conflictBox) {
      const conflicts = (schedule && schedule.conflicts) || [];
      conflictBox.textContent = conflicts.length
        ? `일정 충돌 ${conflicts.length}건: ` + conflicts.map((c) =>
            `${c.activity_id}번 활동 ${c.reason}${c.shortage_minutes ? ` (${c.shortage_minutes}분 초과)` : ''}`).join(' · ')
        : (schedule && schedule.note) || '';
    }
  }

  function renderDetail(container, data, handlers) {
    if (!container) return;
    if (!data) { container.hidden = true; return; }
    container.hidden = false;
    const { activity, place, node, timing, candidates } = data;
    const options = (candidates || []).map((p) =>
      `<option value="${esc(p.id)}" ${p.id === place.id ? 'selected' : ''}>${esc(p.name)} · ${p.distance_km}km · ${p.score || 0}점</option>`).join('');
    container.innerHTML = `<h3>${esc(activity.category)} · ${esc(place.name)}</h3>
      <div class="detail-grid">
        <div><b>운영시간</b>${esc(global.SeoulRouteView.operatingHours(place))}${global.SeoulRouteView.visitWarning(place.visit_warning)}</div>
        ${place.menu_model || place.menu_evidence?.length ? `<div><b>메뉴</b>${global.SeoulRouteView.menuEvidence(place)}</div>` : ''}
        <div><b>이동시간</b>${timing?.travel_source ? '길찾기' : '이동 추정'} ${esc(timing?.travel_minutes ?? node.travel_minutes ?? 0)}분${timing?.buffer_minutes ? ` + 여유 ${timing.buffer_minutes}분` : ''}${timing?.arrival_time ? ` · ${esc(timing.arrival_time)} 도착` : ''}</div>
        <div><b>예상 비용</b>${place.fee_krw == null ? '확인 필요' : place.fee_krw + '원'}</div>
        <div><b>확인 상태</b>${place.source === 'kakao' ? '장소명·위치 조회 · 실제 방문 미검증' : (place.score || 0) + '점 · 데모 정보 확인 필요'}</div>
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
