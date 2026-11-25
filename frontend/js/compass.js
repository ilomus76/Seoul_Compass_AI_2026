/* 360도 컴패스 뷰: 8개 방향 부채꼴(색채 강조) + 업종별 마커 + 경로 애니메이션 */
(function (global) {
  'use strict';
  const NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const C = global.SeoulCharts || { COLORS: {}, SECTOR_COLORS: [] };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function point(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  }

  function render(container, data) {
    if (!container) return;
    const { places = [], scores = {}, route = null } = data;
    const cx = 300, cy = 300, maxR = 245;
    const radius = Math.max(1, Number(data.radius_km || 5));
    const sectorColors = C.SECTOR_COLORS.length ? C.SECTOR_COLORS
      : ['#ff6b8a','#ff9f68','#ffd166','#8fe388','#4fe0c4','#5ab0ff','#8a8bff','#cf8bff'];
    const categoryColors = C.COLORS || {};

    const sectors = NAMES.map((name, i) => {
      const a0 = i * 45 - 22.5, a1 = a0 + 45;
      const [x0, y0] = point(cx, cy, maxR, a0);
      const [x1, y1] = point(cx, cy, maxR, a1);
      const score = Number(scores[name] || 0);
      const opacity = 0.12 + Math.min(0.68, score / 130);
      return `<path class="sector" d="M${cx} ${cy} L${x0.toFixed(1)} ${y0.toFixed(1)} A${maxR} ${maxR} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z"
        fill="${sectorColors[i % 8]}" opacity="${opacity.toFixed(2)}" stroke="${sectorColors[i % 8]}" stroke-width="1">
        <title>${name} 방향 · ${score}점</title></path>`;
    }).join('');

    const rings = [0.25, 0.5, 0.75, 1].map((k) => {
      const r = maxR * k;
      const [lx, ly] = point(cx, cy, r + 10, 22.5);
      return `<circle class="grid-ring" cx="${cx}" cy="${cy}" r="${r.toFixed(0)}"/>
        <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#94a3c0" font-size="9">${(radius * k).toFixed(1)}km</text>`;
    }).join('');

    const labels = NAMES.map((name, i) => {
      const [x, y] = point(cx, cy, maxR + 16, i * 45);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="${sectorColors[i % 8]}" font-size="11" font-weight="700">${name}</text>`;
    }).join('');

    const markers = places.map((p) => {
      const r = Math.min(maxR, (p.distance_km / radius) * maxR);
      const [x, y] = point(cx, cy, r, p.bearing || 0);
      const color = categoryColors[p.category] || '#ff8fb1';
      return `<g class="marker" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle r="9" fill="${color}" opacity=".16"/><circle r="4.5" fill="${color}" stroke="#070b16" stroke-width="1.2"/>
        <text x="9" y="-7" fill="#eef3ff" font-size="9">${esc(p.name)}</text>
        <title>${esc(p.name)} · ${esc(p.direction || '')} · ${p.distance_km}km · ${p.score || 0}점</title></g>`;
    }).join('');

    const nodes = route && route.nodes ? route.nodes : [];
    const pts = nodes.map((n) => {
      const r = Math.min(maxR, (n.distance_km / radius) * maxR);
      return point(cx, cy, r, n.place.bearing || 0);
    });
    const routePath = pts.length > 1
      ? `<polyline class="route-line" points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>` : '';
    const routeNodes = pts.map((p, i) => `<circle class="route-node" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="9"/>
      <text class="route-num" x="${p[0].toFixed(1)}" y="${(p[1] + 3).toFixed(1)}">${i + 1}</text>`).join('');

    container.innerHTML = `<svg viewBox="0 0 600 600" role="img" aria-label="360도 방향 분석 지도">
      <defs><linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4fe0c4"/><stop offset="0.5" stop-color="#ffc857"/><stop offset="1" stop-color="#ff6b8a"/>
      </linearGradient></defs>
      ${sectors}${rings}
      <line x1="${cx}" y1="24" x2="${cx}" y2="576" stroke="rgba(255,255,255,.12)"/>
      <line x1="24" y1="${cy}" x2="576" y2="${cy}" stroke="rgba(255,255,255,.12)"/>
      ${labels}${routePath}${routeNodes}${markers}
      <circle class="start-pulse" cx="${cx}" cy="${cy}" r="10"/>
      <circle cx="${cx}" cy="${cy}" r="9" fill="#4fe0c4" stroke="#070b16" stroke-width="2"/>
      <text x="${cx + 14}" y="${cy + 4}" fill="#eef3ff" font-size="10">출발지</text>
    </svg>`;

    const legend = document.getElementById('compassLegend');
    if (legend) {
      legend.innerHTML = NAMES.map((n, i) => `<span><i style="background:${sectorColors[i % 8]}"></i>${n}</span>`).join('')
        + `<span><i style="background:#ff6b8a"></i>식사</span><span><i style="background:#ffc857"></i>쇼핑</span>`;
    }
  }

  global.SeoulCompassMap = { render };
})(window);
