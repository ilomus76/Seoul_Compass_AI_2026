/* 360도 컴패스 뷰: 8개 방향 부채꼴(색채 강조) + 업종별 마커 + 경로 애니메이션 */
(function (global) {
  'use strict';
  const NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const C = global.SeoulCharts || { COLORS: {}, SECTOR_COLORS: [] };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function point(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  }

  // 오버레이를 다시 그릴 때 같은 검색의 SVG 확대 범위를 이어받는다.
  function viewport(container, data, mode, radius) {
    const search = `${mode}:${Number(data.start?.latitude)}:${Number(data.start?.longitude)}:${radius}`;
    const svg = container.querySelector(':scope > svg[data-search]');
    const sameMode = svg?.dataset.search.startsWith(mode + ':');
    let viewBox = sameMode && (data.preserveZoom || svg.dataset.search === search)
      ? svg.getAttribute('viewBox') : '0 0 600 600';
    if (data.focusPoints?.length) {
      const center = {lat:Number(data.start.latitude), lng:Number(data.start.longitude)};
      const projected = data.focusPoints.map(p => geoProject(p.lat, p.lng, center, radius, mode === 'geo' ? 275 : 245));
      const xs = projected.map(p => p.x), ys = projected.map(p => p.y);
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      const size = Math.min(600, Math.max(150, (right - left) + 75, (bottom - top) + 75));
      const origin = (min, max) => Math.max(0, Math.min(600 - size, (min + max - size) / 2));
      viewBox = `${origin(left, right)} ${origin(top, bottom)} ${size} ${size}`;
    }
    return `viewBox="${esc(viewBox)}" data-search="${search}"`;
  }

  function render(container, data) {
    if (!container) return;
    const { places = [], scores = {}, route = null } = data;
    const cx = 300, cy = 300, maxR = 245;
    const radius = Math.max(1, Number(data.radius_km || 5));
    const sectorColors = C.SECTOR_COLORS.length ? C.SECTOR_COLORS
      : ['#b45f54','#c08a4a','#b8914e','#6f9b6a','#2f8f83','#5479b0','#6b5ba8','#9b6aa0'];
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
        ${k < 1 ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#94a3c0" font-size="9">${(radius * k).toFixed(1)}km</text>` : ''}`;
    }).join('');

    const labels = NAMES.map((name, i) => {
      const [x, y] = point(cx, cy, maxR + 16, i * 45);
      return `<text translate="no" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="var(--ink)" font-size="10" font-weight="600">${LABELS[i]}</text>`;
    }).join('');

    const markers = places.map((p) => {
      const r = Math.min(maxR, (p.distance_km / radius) * maxR);
      const [x, y] = point(cx, cy, r, p.bearing || 0);
      const color = p.visit_warning ? global.SeoulJourney.REFERENCE_COLOR : categoryColors[p.category] || '#a86a8f';
      return `<g class="marker" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle r="9" fill="${color}" opacity=".16"/><circle r="4.5" fill="${color}" stroke="#f5f2eb" stroke-width="1.2"/>
        <text x="9" y="-7"${p.visit_warning ? ' class="visit-warning"' : ' fill="#eef3ff"'} font-size="9">${esc(p.name)}</text>
        <title>${esc(p.name)} · ${p.visit_warning ? esc(p.visit_warning.reason) : `${esc(p.direction || '')} · ${p.distance_km}km · ${p.score || 0}점`}</title></g>`;
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

    container.innerHTML = `<svg ${viewport(container, data, 'polar', radius)} preserveAspectRatio="xMidYMid meet" role="img" aria-label="360도 방향 분석 지도">
      <defs><linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#b8914e"/><stop offset="0.5" stop-color="#2f8f83"/><stop offset="1" stop-color="#b45f54"/>
      </linearGradient></defs>
      ${sectors}${rings}
      <circle cx="300" cy="300" r="${maxR}" fill="none" stroke="#E53935" stroke-width="3"/>
      <text x="300" y="${cy - maxR + 14}" text-anchor="middle" fill="#E53935" font-size="11" font-weight="600">반경 ${radius}km</text>
      <line x1="${cx}" y1="24" x2="${cx}" y2="576" stroke="rgba(255,255,255,.12)"/>
      <line x1="24" y1="${cy}" x2="576" y2="${cy}" stroke="rgba(255,255,255,.12)"/>
      ${labels}${data.journey || data.route_layers?.length ? '' : routePath + routeNodes}${markers}
      <circle class="start-pulse" cx="${cx}" cy="${cy}" r="10"/>
      <circle cx="${cx}" cy="${cy}" r="9" fill="#b8914e" stroke="#f5f2eb" stroke-width="2"/>
      <text x="${cx + 14}" y="${cy + 4}" fill="#eef3ff" font-size="10">출발지</text>
      ${renderJourney(data, {lat:Number(data.start.latitude), lng:Number(data.start.longitude)}, radius, maxR)}
    </svg>`;
    global.SeoulJourney.highlight(container, Number(document.getElementById('scrubSlider').value));

    const legend = document.getElementById('compassLegend');
    if (legend) {
      legend.innerHTML = LABELS.map((n, i) => `<span translate="no"><i style="background:${sectorColors[i % 8]}"></i>${n}</span>`).join('')
        + `<span><i style="background:#ff6b8a"></i>식사</span><span><i style="background:#ffc857"></i>쇼핑</span>`;
    }
  }

  /* 실제 위경도를 지도 좌표로 투영하고 360도 분석을 겹쳐 표시한다. */
  function geoProject(lat, lng, center, radiusKm, extent) {
    const latSpan = radiusKm / 111;
    const lngSpan = radiusKm / (111 * Math.cos(center.lat * Math.PI / 180));
    const x = 300 + (lng - center.lng) / lngSpan * extent;
    const y = 300 - (lat - center.lat) / latSpan * extent;
    return { x: Math.max(10, Math.min(590, x)), y: Math.max(10, Math.min(590, y)) };
  }

  function renderJourney(data, center, radius, extent) {
    const project = p => geoProject(p.lat, p.lng, center, radius, extent);
    return global.SeoulJourney.renderRouteLayers(data.route_layers, project)
      + global.SeoulJourney.renderSvg(data.journey, project, data.journey_filter, !!data.route_layers?.length);
  }

  function renderGeo(container, data) {
    if (!container) return;
    const raw = data.start || {};
    const center = {
      lat: Number(raw.latitude != null ? raw.latitude : (raw.lat != null ? raw.lat : 37.5665)),
      lng: Number(raw.longitude != null ? raw.longitude : (raw.lng != null ? raw.lng : 126.9780))
    };
    const radius = Math.max(1, Number(data.radius_km || 5));
    const places = data.places || [], scores = data.scores || {};
    const route = data.route || null;
    const extent = 275;
    const sectorColors = C.SECTOR_COLORS.length ? C.SECTOR_COLORS
      : ['#b45f54','#c08a4a','#b8914e','#6f9b6a','#2f8f83','#5479b0','#6b5ba8','#9b6aa0'];

    // 지도 배경: 격자 + 한강 + 자치구 라벨
    const grid = [0.2, 0.4, 0.6, 0.8].map((k) => `
      <line class="map-road" x1="${300 - extent + k * extent * 2}" y1="20" x2="${300 - extent + k * extent * 2}" y2="580"/>
      <line class="map-road" x1="20" y1="${300 - extent + k * extent * 2}" x2="580" y2="${300 - extent + k * extent * 2}"/>`).join('');
    const riverPoints = [[126.85,37.532],[126.92,37.525],[126.98,37.518],[127.04,37.523],[127.10,37.516],[127.16,37.512]];
    const riverPath = riverPoints.map((p, i) => {
      const q = geoProject(p[1], p[0], center, radius, extent);
      return `${i ? 'L' : 'M'}${q.x.toFixed(0)},${q.y.toFixed(0)}`;
    }).join(' ');
    const districts = [
      ['종로구',37.579,126.977],['중구',37.566,126.997],['용산구',37.534,126.994],
      ['마포구',37.556,126.923],['성동구',37.544,127.037],['광진구',37.538,127.085],
      ['영등포구',37.526,126.916],['관악구',37.478,126.951],['서초구',37.514,126.995],
      ['강남구',37.517,127.047],['송파구',37.514,127.102],['노원구',37.654,127.078]
    ];
    const labels = districts.map(([name, lat, lng]) => {
      const p = geoProject(lat, lng, center, radius, extent);
      return `<text class="map-label" x="${p.x.toFixed(0)}" y="${p.y.toFixed(0)}">${esc(name)}</text>`;
    }).join('');

    // 방향 부채꼴과 반경 원 (지도 위에 겹침)
    const sectors = NAMES.map((name, i) => {
      const a0 = i * 45 - 22.5, a1 = a0 + 45;
      const [x0, y0] = point(300, 300, extent, a0);
      const [x1, y1] = point(300, 300, extent, a1);
      const score = Number(scores[name] || 0);
      const opacity = 0.08 + Math.min(0.45, score / 180);
      return `<path class="sector" d="M300 300 L${x0.toFixed(1)} ${y0.toFixed(1)} A${extent} ${extent} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z"
        fill="${sectorColors[i % 8]}" opacity="${opacity.toFixed(2)}" stroke="${sectorColors[i % 8]}" stroke-width="1">
        <title>${name} 방향 · ${score}점</title></path>`;
    }).join('');
    const rings = [0.25, 0.5, 0.75, 1].map((k) => `
      <circle cx="300" cy="300" r="${(extent * k).toFixed(0)}" fill="none" stroke="rgba(255,255,255,.16)" stroke-dasharray="3 7"/>
      ${k < 1 ? `<text class="map-label" x="305" y="${(300 - extent * k - 4).toFixed(0)}">${(radius * k).toFixed(1)}km</text>` : ''}`).join('');
    const dirs = NAMES.map((name, i) => {
      const [x, y] = point(300, 300, extent + 14, i * 45);
      return `<text translate="no" x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle" fill="var(--ink)" font-size="9" font-weight="600">${LABELS[i]}</text>`;
    }).join('');

    const markers = places.map((p) => {
      const q = geoProject(p.lat, p.lng, center, radius, extent);
      const color = p.visit_warning ? global.SeoulJourney.REFERENCE_COLOR : (C.COLORS || {})[p.category] || '#a86a8f';
      return `<g class="marker" transform="translate(${q.x.toFixed(1)},${q.y.toFixed(1)})">
        <circle r="8" fill="${color}" opacity=".16"/><circle r="4" fill="${color}" stroke="#f5f2eb"/>
        <text x="8" y="-7"${p.visit_warning ? ' class="visit-warning"' : ''}>${esc(p.name)}</text><title>${esc(p.name)} · ${p.visit_warning ? esc(p.visit_warning.reason) : `${p.distance_km}km · ${p.score || 0}점`}</title></g>`;
    }).join('');

    const allRoutes = data.route_layers?.length ? [] : (route ? [route] : []);
    const routeColors = ['#b8914e', '#2f8f83', '#b45f54'];
    let routePath = '', routeNodes = '';
    allRoutes.forEach((r, idx) => {
      if (data.journey && (r === data.route || data.journey_filter !== 'all')) return;
      const pts = (r.nodes || []).map((n) => geoProject(n.place.lat, n.place.lng, center, radius, extent));
      if (pts.length < 2) return;
      const pointString = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      routePath += `<polyline class="route-line" style="stroke:${routeColors[idx % 3]};opacity:${data.journey ? .2 : 1}" points="${pointString}"/>`;
      if (idx === 0) {
        routePath += `<circle class="flow-dot" r="3.5" fill="${routeColors[idx % 3]}"><animateMotion dur="3.2s" repeatCount="indefinite"
          path="M${pointString.replace(/ /g, ' L')}"/></circle>`;
        routeNodes = pts.map((p, i) => `<circle class="route-node" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9"/>
          <text class="route-num" x="${p.x.toFixed(1)}" y="${(p.y + 3).toFixed(1)}">${i + 1}</text>`).join('');
      }
    });

    container.innerHTML = `<svg ${viewport(container, data, 'geo', radius)} preserveAspectRatio="xMidYMid meet" role="img" aria-label="지도에 매핑된 360도 방향 분석">
      <defs><linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#b8914e"/><stop offset="0.5" stop-color="#2f8f83"/><stop offset="1" stop-color="#b45f54"/>
      </linearGradient></defs>
      <rect x="0" y="0" width="600" height="600" rx="18" style="fill:var(--panel)" opacity=".9"/>
      ${grid}${sectors}${rings}
      <circle cx="300" cy="300" r="${extent}" fill="none" stroke="#E53935" stroke-width="3"/>
      <text x="300" y="${300 - extent + 14}" text-anchor="middle" fill="#E53935" font-size="11" font-weight="600">반경 ${radius}km</text>
      <path class="map-river" d="${riverPath}"/><text class="map-water-label" x="330" y="300">한강</text>
      ${labels}${dirs}${routePath}${routeNodes}${markers}
      <circle class="start-pulse" cx="300" cy="300" r="10"/>
      <circle cx="300" cy="300" r="9" fill="#b8914e" stroke="#f5f2eb" stroke-width="2"/>
      <text class="map-label" x="314" y="304">출발지</text>
      <circle id="simMarker" class="sim-marker" cx="300" cy="300" r="7" hidden/>
      ${renderJourney(data, center, radius, extent)}
    </svg>`;
    global.SeoulJourney.highlight(container, Number(document.getElementById('scrubSlider').value));

    const legend = document.getElementById('compassLegend');
    if (legend) legend.innerHTML = LABELS.map((n, i) => `<span translate="no"><i style="background:${sectorColors[i % 8]}"></i>${n}</span>`).join('')
      + '<span><i style="background:#3aa8c8"></i>한강</span>';
  }

  // 시뮬레이션 마커용 좌표 계산 (renderGeo와 동일한 투영)
  function projectForSim(place, start, radiusKm) {
    const raw = start || {};
    const center = {
      lat: Number(raw.latitude != null ? raw.latitude : (raw.lat != null ? raw.lat : 37.5665)),
      lng: Number(raw.longitude != null ? raw.longitude : (raw.lng != null ? raw.lng : 126.9780))
    };
    return geoProject(place.lat, place.lng, center, Number(radiusKm) || 5, 275);
  }

  // 외부 지도 SDK를 사용할 수 없는 도표 보기에서도 같은 확대·축소 버튼을 쓴다.
  function zoom(container, factor) {
    const svg = container && container.querySelector('svg');
    if (!svg) return;
    const width = factor === 0 ? 600 : Math.max(150, Math.min(900, svg.viewBox.baseVal.width * factor));
    svg.setAttribute('viewBox', `${300 - width / 2} ${300 - width / 2} ${width} ${width}`);
  }

  global.SeoulCompassMap = { render, renderGeo, projectForSim, zoom };
})(window);
