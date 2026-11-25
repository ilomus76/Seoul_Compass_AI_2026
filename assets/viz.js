/* Seoul Compass AI 2026 — 시각화 모듈 (외부 라이브러리 없음)
 * 모든 지표는 데모용 결정론적 시뮬레이션 값입니다.
 */
(function (global) {
  'use strict';

  const CENTER = { lat: 37.5665, lng: 126.9780 }; // 서울시청
  const COLORS = {
    heritage: '#f2b866', culture: '#a98cff', nature: '#4fe0c4',
    night: '#ff8a7a', food: '#ffd166', shopping: '#6aa8ff'
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }

  function distanceKm(a, b) {
    const R = 6371, rad = (d) => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* 중심(시청) 기준 방위각: 북=0°, 시계방향 */
  function bearing(spot) {
    const dLng = (spot.lng - CENTER.lng) * Math.PI / 180;
    const lat1 = CENTER.lat * Math.PI / 180, lat2 = spot.lat * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /* 방위각 + 거리를 극좌표로 변환 */
  function polar(spot) {
    const deg = bearing(spot);
    const radius = 46 + Math.min(distanceKm(CENTER, spot), 13) * 15;
    const rad = deg * Math.PI / 180;
    return { x: 300 + radius * Math.sin(rad), y: 300 - radius * Math.cos(rad), deg, km: distanceKm(CENTER, spot) };
  }

  function compassGrid(el) {
    if (!el) return;
    const rings = [80, 140, 200, 258];
    const labels = ['2 km', '5 km', '9 km', '13 km'];
    el.innerHTML = rings.map((r, i) => `
      <circle cx="300" cy="300" r="${r}" class="grid-ring" />
      <text x="304" y="${300 - r + 12}" class="grid-ring-label">${labels[i]}</text>`).join('') + `
      <line x1="300" y1="24" x2="300" y2="576" class="grid-axis" />
      <line x1="24" y1="300" x2="576" y2="300" class="grid-axis" />
      <line x1="108" y1="108" x2="492" y2="492" class="grid-axis faint" />
      <line x1="492" y1="108" x2="108" y2="492" class="grid-axis faint" />
      <text x="300" y="18" class="compass-dir">N</text>
      <text x="582" y="305" class="compass-dir">E</text>
      <text x="300" y="592" class="compass-dir">S</text>
      <text x="14" y="305" class="compass-dir">W</text>`;
  }

  function needle(el, spot) {
    if (!el) return;
    if (!spot) { el.innerHTML = ''; return; }
    const deg = bearing(spot);
    el.innerHTML = `<g transform="rotate(${deg.toFixed(1)} 300 300)">
      <line x1="300" y1="300" x2="300" y2="72" class="needle-line" />
      <path d="M300 60 l-6 16 l6 -4 l6 4 z" class="needle-tip" />
    </g>`;
  }

  function donut(el, spots, categories, lang) {
    if (!el) return;
    const counts = categories.filter((c) => c.key !== 'all').map((c) => ({
      key: c.key,
      label: lang === 'en' ? c.en : c.ko,
      color: COLORS[c.key],
      value: spots.filter((s) => s.category === c.key).length
    }));
    const total = spots.length || 1;
    const R = 52, C = 2 * Math.PI * R;
    let offset = 0;
    const arcs = counts.map((c) => {
      const frac = c.value / total;
      const dash = `${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}`;
      const arc = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${c.color}" stroke-width="16"
        stroke-dasharray="${dash}" stroke-dashoffset="${(-offset * C).toFixed(2)}"
        transform="rotate(-90 70 70)" opacity="${c.value ? '.95' : '.12'}" />`;
      offset += frac;
      return arc;
    }).join('');
    el.innerHTML = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="16" />${arcs}`;
    const totalEl = document.getElementById('donutTotal');
    if (totalEl) totalEl.textContent = spots.length;
    const legend = document.getElementById('catLegend');
    if (legend) legend.innerHTML = counts.map((c) => `<span class="legend-item"><i style="background:${c.color}"></i>${esc(c.label)} <b>${c.value}</b></span>`).join('');
  }

  function profile(spot) {
    const subway = spot.transit && /지하철|subway|station/i.test(spot.transit) ? 0.92 : 0.58;
    return [
      spot.rating / 5,
      subway,
      spot.indoor ? 0.95 : 0.42,
      Math.min(spot.tags.length / 8, 1),
      (hash(spot.id) % 100) / 100
    ];
  }

  function radar(el, spot, lang) {
    if (!el) return;
    const labels = lang === 'en'
      ? ['Rating', 'Access', 'Indoor', 'Tags', 'Room']
      : ['평점', '접근', '실내', '태그', '여유'];
    const vals = spot ? profile(spot) : [0, 0, 0, 0, 0];
    const cx = 90, cy = 90, maxR = 62;
    const pt = (i, r) => {
      const a = (-90 + i * 72) * Math.PI / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const rings = [0.25, 0.5, 0.75, 1].map((k) =>
      `<polygon points="${[0, 1, 2, 3, 4].map((i) => pt(i, maxR * k).map((v) => v.toFixed(1)).join(',')).join(' ')}" class="radar-ring" />`).join('');
    const axes = [0, 1, 2, 3, 4].map((i) => {
      const [x, y] = pt(i, maxR);
      const [lx, ly] = pt(i, maxR + 16);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="radar-axis" />
              <text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" class="radar-label">${labels[i]}</text>`;
    }).join('');
    const poly = vals.map((v, i) => pt(i, maxR * v).map((n) => n.toFixed(1)).join(',')).join(' ');
    el.innerHTML = `${rings}${axes}<polygon points="${poly}" class="radar-shape" />
      ${vals.map((v, i) => { const [x, y] = pt(i, maxR * v); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" class="radar-dot" />`; }).join('')}`;
    const meta = document.getElementById('radarMeta');
    if (meta) meta.innerHTML = spot
      ? `<span class="legend-item">${esc(lang === 'en' ? spot.nameEn : spot.name)}</span><span class="legend-item">★ ${spot.rating.toFixed(1)}</span>`
      : `<span class="legend-item">${lang === 'en' ? 'Select a place' : '명소를 선택하세요'}</span>`;
  }

  function spark(el, temps) {
    if (!el) return;
    const w = 220, h = 64, pad = 8;
    const min = Math.min(...temps) - 2, max = Math.max(...temps) + 2;
    const pts = temps.map((t, i) => ({
      x: pad + (i * (w - pad * 2)) / (temps.length - 1),
      y: h - pad - ((t - min) / (max - min)) * (h - pad * 2)
    }));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1].x},${h} L${pts[0].x},${h} Z`;
    el.innerHTML = `<defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#sparkFill)" /><path d="${line}" class="spark-line" />
      ${pts.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" class="spark-dot" ><title>D+${i + 1}: ${temps[i]}°</title></circle>`).join('')}`;
  }

  function weeklyTemps() {
    const m = new Date().getMonth() + 1;
    const base = (m >= 6 && m <= 8) ? 29 : (m === 4 || m === 5 || m === 9 || m === 10) ? 21 : (m === 11 || m === 12) ? 8 : 0;
    return [0, 1, 2, 3, 4, 5, 6].map((i) => base + ((hash('temp' + i) % 5) - 2));
  }

  function heat(el, spot, lang) {
    if (!el) return;
    const key = spot ? spot.id : 'default';
    const hours = ['08', '10', '12', '14', '16', '18'];
    let html = `<div class="heat-corner"></div>${hours.map((h) => `<div class="heat-hour">${h}</div>`).join('')}`;
    for (let d = 0; d < 3; d++) {
      html += `<div class="heat-day">${lang === 'en' ? 'D+' + (d + 1) : 'D+' + (d + 1)}</div>`;
      for (let h = 0; h < hours.length; h++) {
        const v = hash(key + d + h) % 100;
        html += `<div class="heat-cell" style="--v:${v}" title="${hours[h]}:00 · ${v}%"></div>`;
      }
    }
    el.innerHTML = html;
  }

  global.SeoulViz = { CENTER, COLORS, bearing, distanceKm, polar, compassGrid, needle, donut, radar, spark, weeklyTemps, heat };
})(window);
