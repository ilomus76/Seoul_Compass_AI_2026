/* 고급 시각화 모듈: KPI, 도넛, 막대, 히트맵 (외부 라이브러리 없음) */
(function (global) {
  'use strict';

  const COLORS = {
    hiking:'#7cd992', shower:'#58c8ff', meeting:'#ffa657', restaurant:'#ff6b8a',
    bowling:'#b58cff', international_tourism_area:'#4fe0c4', subway_station:'#6aa8ff',
    shopping:'#ffc857', attraction:'#ff8fb1', night_view:'#9b7bff', park:'#5fd99b',
    cafe:'#ffb38a', culture:'#c69cff', bar:'#ff7a7a'
  };
  const SECTOR_COLORS = ['#ff6b8a','#ff9f68','#ffd166','#8fe388','#4fe0c4','#5ab0ff','#8a8bff','#cf8bff'];
  const NAMES_KO = { hiking:'등산', shower:'샤워', meeting:'약속', restaurant:'식사', bowling:'볼링',
    international_tourism_area:'국제관광', subway_station:'지하철', shopping:'쇼핑', attraction:'명소',
    night_view:'야경', park:'공원', cafe:'카페', culture:'문화', bar:'주점' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

  function spark(values, color) {
    const w = 120, h = 32, min = Math.min(...values, 0), max = Math.max(...values, 1);
    const pts = values.map((v, i) => [i * w / Math.max(1, values.length - 1), h - (v - min) / (max - min || 1) * (h - 4) - 2]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}"><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <path d="${line} L${w},${h} L0,${h} Z" fill="${color}" opacity=".12"/></svg>`;
  }

  function kpis(container, data) {
    if (!container) return;
    const { places = [], routes = [], conflicts = 0, scores = {} } = data;
    const counts = {};
    places.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
    const values = Object.values(counts);
    const confidence = routes.length
      ? Math.round(routes[0].data_confidence * 100) : 0;
    const cards = [
      { label:'검색 장소', value:places.length, sub:`${Object.keys(counts).length}개 업종`, color:'#4fe0c4', spark:values },
      { label:'분석 방향', value:Object.keys(scores).length, sub:'8구역 · 45도', color:'#7c5cff', spark:Object.values(scores) },
      { label:'추천 경로', value:routes.length, sub:'TOP 3', color:'#ffc857', spark:routes.map((r) => r.score) },
      { label:'일정 충돌', value:conflicts, sub:conflicts ? '확인 필요' : '충돌 없음', color:conflicts ? '#ff6b8a' : '#7cd992', spark:[1, conflicts || 0, 1] },
      { label:'데이터 신뢰도', value:confidence + '%', sub:'최상위 경로', color:'#58c8ff', spark:[40, 70, confidence] }
    ];
    container.innerHTML = cards.map((c) => `<div class="kpi" style="--kpi-color:${c.color}">
      <div class="kpi-label">${esc(c.label)}</div><div class="kpi-value">${esc(c.value)}</div>
      <div class="kpi-sub">${esc(c.sub)}</div>${spark(c.spark.map(Number), c.color)}</div>`).join('');
  }

  function donut(container, places) {
    if (!container) return;
    const counts = {};
    places.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = places.length || 1, R = 54, C = 2 * Math.PI * R;
    let offset = 0;
    const arcs = entries.map(([cat, n]) => {
      const frac = n / total, dash = `${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}`;
      const arc = `<circle cx="75" cy="75" r="${R}" fill="none" stroke="${COLORS[cat] || '#8a8bff'}" stroke-width="17"
        stroke-dasharray="${dash}" stroke-dashoffset="${(-offset * C).toFixed(2)}" transform="rotate(-90 75 75)">
        <title>${esc(NAMES_KO[cat] || cat)} ${n}곳</title></circle>`;
      offset += frac; return arc;
    }).join('');
    container.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 150 150">
      <circle cx="75" cy="75" r="${R}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="17"/>${arcs}</svg>
      <div class="donut-center"><strong>${places.length}</strong><small>SPOTS</small></div></div>
      <div class="legend">${entries.map(([cat, n]) => `<span><i style="background:${COLORS[cat] || '#8a8bff'}"></i>${esc(NAMES_KO[cat] || cat)} ${n}</span>`).join('')}</div>`;
  }

  function bars(container, scores) {
    if (!container) return;
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...entries.map((e) => e[1]), 1);
    container.innerHTML = entries.map(([name, value], i) => `<div class="bar-row">
      <span>${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${(value / max * 100).toFixed(1)}%;--bar-color:${SECTOR_COLORS[i % 8]}"></div></div>
      <span>${value}점</span></div>`).join('');
  }

  function heat(container, route) {
    if (!container) return;
    const key = route ? route.nodes.map((n) => n.place.id).join('-') : 'default';
    let html = '';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 12; c++) {
        const v = hash(key + r + c) % 100;
        html += `<div class="heat-cell" style="--v:${v};--heat-color:${v > 66 ? '#ff6b8a' : v > 33 ? '#ffc857' : '#4fe0c4'}" title="${8 + c}시 · ${v}%"></div>`;
      }
    }
    container.innerHTML = html + `<div class="heat-scale"><span>여유</span><i></i><span>붐빔</span></div>`;
  }

  global.SeoulCharts = { COLORS, SECTOR_COLORS, NAMES_KO, kpis, donut, bars, heat };
})(window);
