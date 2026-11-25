/* 추천 경로 TOP 3 렌더링 */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function render(container, routes, onSelect) {
    if (!container) return;
    if (!routes || !routes.length) {
      container.innerHTML = '<p>추천 경로가 없습니다. 질문에 장소 조건을 포함해 주세요.</p>';
      return;
    }
    const accents = ['#4fe0c4', '#ffc857', '#ff8fb1'];
    container.innerHTML = routes.map((r, i) => {
      const names = r.nodes.map((n) => n.place.name).join(' → ');
      const conflict = r.schedule && r.schedule.conflicts && r.schedule.conflicts.length;
      return `<article class="route-card" data-index="${i}" style="--card-accent:${accents[i % accents.length]}">
        <h3><span class="rank">${i + 1}</span>위 · ${esc(r.direction)} 방향 · ${r.score}점</h3>
        <p>${esc(names)}</p>
        <p>거리 ${r.total_distance_km}km · 이동 ${r.total_travel_minutes}분 · 비용 ${r.estimated_cost_krw}원</p>
        <p>신뢰도 ${Math.round((r.data_confidence || 0) * 100)}% ${conflict ? '· 일정 충돌 있음' : ''}</p>
        <button type="button" class="ghost select-route">이 경로 선택</button>
      </article>`;
    }).join('');
    container.querySelectorAll('.select-route').forEach((btn) => {
      btn.addEventListener('click', () => onSelect(routes[Number(btn.parentElement.dataset.index)]));
    });
  }

  function renderReport(container, data) {
    if (!container) return;
    if (!data) { container.innerHTML = '<p>리포트가 없습니다.</p>'; return; }
    const list = (title, items) => `<h3>${title}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>없음</li>'}</ul>`;
    container.innerHTML = `
      <p>추천 방향: <b>${esc(data.recommended_direction)}</b> · 경로 점수 <b>${data.route_score}</b> · 관심사 충족 <b>${data.interest_satisfaction}%</b></p>
      ${list('추천 이유', data.reasons || [])}
      ${list('주의사항', data.cautions || [])}
      ${list('대체 장소', data.alternatives || [])}
      <p>데이터 신뢰도: ${Math.round((data.data_confidence || 0) * 100)}%</p>`;
  }

  global.SeoulRouteView = { render, renderReport };
})(window);
