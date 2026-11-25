/* 360도 컴패스 뷰: 8개 방향 부채꼴과 장소 마커를 그린다. */
(function (global) {
  'use strict';
  const NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function point(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  }

  function render(container, data) {
    if (!container) return;
    const { start, places = [], scores = {}, route = null } = data;
    const cx = 300, cy = 300, maxR = 250;
    const radius = Math.max(1, Number(data.radius_km || 5));

    // 부채꼴: 점수가 높을수록 진한 색
    const sectors = NAMES.map((name, i) => {
      const a0 = i * 45 - 22.5, a1 = a0 + 45;
      const [x0, y0] = point(cx, cy, maxR, a0);
      const [x1, y1] = point(cx, cy, maxR, a1);
      const score = Number(scores[name] || 0);
      const opacity = Math.min(0.75, score / 140);
      return `<path class="sector" d="M${cx} ${cy} L${x0.toFixed(1)} ${y0.toFixed(1)} A${maxR} ${maxR} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z"
        fill="#4fe0c4" opacity="${opacity.toFixed(2)}"><title>${name}: ${score}점</title></path>`;
    }).join('');

    const rings = [0.25, 0.5, 0.75, 1].map((k) =>
      `<circle class="grid-ring" cx="${cx}" cy="${cy}" r="${(maxR * k).toFixed(0)}" />
       <text x="${cx + 4}" y="${cy - maxR * k - 4}" fill="#95a4bc" font-size="9">${(radius * k).toFixed(1)}km</text>`).join('');

    const labels = NAMES.map((name, i) => {
      const [x, y] = point(cx, cy, maxR + 14, i * 45);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="#95a4bc" font-size="10">${name}</text>`;
    }).join('');

    const markers = places.map((p) => {
      const r = Math.min(maxR, (p.distance_km / radius) * maxR);
      const [x, y] = point(cx, cy, r, p.bearing || 0);
      return `<g class="marker" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle r="5" fill="#ff9a7b" /><text x="8" y="-7" fill="#eaf1ff" font-size="9">${esc(p.name)}</text>
        <title>${esc(p.name)} · ${p.direction} · ${p.distance_km}km · ${p.score || 0}점</title></g>`;
    }).join('');

    const routeNodes = route && route.nodes ? route.nodes : [];
    const routePoints = routeNodes.map((n) => {
      const r = Math.min(maxR, (n.distance_km / radius) * maxR);
      return point(cx, cy, r, n.place.bearing || 0);
    });
    const routePath = routePoints.length > 1
      ? `<polyline class="route-line" points="${routePoints.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" />` : '';

    container.innerHTML = `<svg viewBox="0 0 600 600" role="img" aria-label="360도 방향 분석 지도">
      ${sectors}${rings}${labels}
      <line x1="${cx}" y1="24" x2="${cx}" y2="576" stroke="#28364f" />
      <line x1="24" y1="${cy}" x2="576" y2="${cy}" stroke="#28364f" />
      ${routePath}${markers}
      <circle cx="${cx}" cy="${cy}" r="8" fill="#4fe0c4" />
      <text x="${cx + 12}" y="${cy + 4}" fill="#eaf1ff" font-size="10">출발지</text>
    </svg>`;
  }

  global.SeoulCompassMap = { render };
})(window);
