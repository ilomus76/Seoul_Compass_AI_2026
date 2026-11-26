/* 고급 시각화 모듈: KPI, 도넛, 막대, 히트맵 (외부 라이브러리 없음) */
(function (global) {
  'use strict';

  // 절제된 라이트 톤: 골드·네이비·세이지 기반의 고급 팔레트
  const COLORS = {
    hiking:'#4f9d69', swimming:'#268bb5', shower:'#4a8fb8', meeting:'#c07a3c', restaurant:'#b45f54',
    bowling:'#7d6bb5', international_tourism_area:'#2f8f83', subway_station:'#5479b0',
    shopping:'#b8914e', attraction:'#a86a8f', night_view:'#6b5ba8', park:'#5d9b6f',
    cafe:'#b8805e', culture:'#8a76ad', bar:'#a85a55', history_museum:'#6767a4',
    palace:'#a85a55', market_food:'#b8805e'
  };
  const SECTOR_COLORS = ['#b45f54','#c08a4a','#b8914e','#6f9b6a','#2f8f83','#5479b0','#6b5ba8','#9b6aa0'];
  const NAMES_KO = { hiking:'등산', swimming:'수영', shower:'샤워', meeting:'약속', restaurant:'식사', bowling:'볼링',
    international_tourism_area:'국제관광', subway_station:'지하철', shopping:'쇼핑', attraction:'명소',
    night_view:'야경', park:'공원', cafe:'카페', culture:'문화', bar:'주점',
    history_museum:'역사 박물관', palace:'고궁', market_food:'시장 먹거리' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

  function spark(values, color) {
    if (!values || !values.length) return '';
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
      { label:data.regionMode ? '후보 동선' : '추천 경로', value:data.regionMode ? data.draftCount : routes.length, sub:data.regionMode ? '실제 방문 미검증' : '최대 5개', color:'#ffc857', spark:routes.map((r) => r.score) },
      { label:'일정 충돌', value:conflicts, sub:data.regionMode ? '입력 시간·이동 추정 기준' : (conflicts ? '확인 필요' : '충돌 없음'), color:conflicts ? '#ff6b8a' : '#7cd992', spark:[] },
      { label:'데이터 신뢰도', value:data.regionMode ? '확인 필요' : confidence + '%', sub:data.regionMode ? '장소명·위치만 조회' : '최상위 경로', color:'#58c8ff', spark:data.regionMode ? [] : [40, 70, confidence] }
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

  /* 색다른 시각화 3종 */

  // 경로 프로필: 방문 노드별 누적 거리/이동시간을 면적 그래프로 표현
  function routeProfile(container, route) {
    if (!container) return;
    const nodes = (route && route.nodes) || [];
    if (!nodes.length) { container.innerHTML = '<p class="hint">경로를 선택하면 표시됩니다.</p>'; return; }
    const w = 240, h = 96, pad = 8;
    let acc = 0;
    const vals = nodes.map((n) => { acc += n.distance_km || 0; return acc; });
    const max = Math.max(...vals, 1);
    const pts = vals.map((v, i) => [pad + i * (w - pad * 2) / Math.max(1, vals.length - 1),
      h - pad - (v / max) * (h - pad * 2)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto">
      <defs><linearGradient id="profileGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#b8914e" stop-opacity=".42"/><stop offset="1" stop-color="#2f8f83" stop-opacity=".02"/>
      </linearGradient></defs>
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="rgba(22,35,60,.14)"/>
      <path d="${line} L${pts[pts.length - 1][0]},${h - pad} L${pad},${h - pad} Z" fill="url(#profileGrad)"/>
      <path d="${line}" fill="none" stroke="#b8914e" stroke-width="2" stroke-linecap="round"/>
      ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#2f8f83"><title>${i + 1}번지 ${vals[i].toFixed(1)}km</title></circle>`).join('')}
      </svg><div class="legend">${nodes.map((n, i) => `<span>${i + 1} · ${esc(n.place.name)} ${n.distance_km}km</span>`).join('')}</div>`;
  }

  // 시간대 리본: 활동별 소요시간을 색 띠로 표시
  function timelineRibbon(container, schedule) {
    if (!container) return;
    const rows = (schedule && schedule.timeline) || [];
    if (!rows.length) { container.innerHTML = '<p class="hint">일정이 없습니다.</p>'; return; }
    const total = rows.reduce((s, r) => s + (r.duration_minutes || 60), 0) || 1;
    container.innerHTML = rows.map((r) => {
      const pct = Math.max(4, (r.duration_minutes || 60) / total * 100);
      return `<div style="display:flex;align-items:center;gap:6px;margin:5px 0">
        <span style="width:70px;font-size:8px;color:var(--muted)">${esc(r.estimated_start)}–${esc(r.estimated_end)}</span>
        <div style="flex:1;height:14px;background:var(--line);border-radius:7px;overflow:hidden">
          <div style="width:${pct.toFixed(1)}%;height:100%;background:${COLORS[r.category] || '#b8914e'};opacity:.85"></div>
        </div><span style="width:54px;font-size:8px;color:var(--muted)">${esc(r.place || '')}</span></div>`;
    }).join('');
  }

  // 방향 로즈 차트: 부채꼴과 다른 방사형 막대 표현
  function rose(container, scores) {
    if (!container) return;
    const entries = Object.entries(scores || {});
    if (!entries.length) { container.innerHTML = '<p class="hint">분석 후 표시됩니다.</p>'; return; }
    const cx = 80, cy = 80, max = Math.max(...entries.map((e) => e[1]), 1);
    const bars = entries.map(([name, v], i) => {
      const deg = i * 45 * Math.PI / 180;
      const len = 12 + v / max * 52;
      const x2 = cx + Math.sin(deg) * len, y2 = cy - Math.cos(deg) * len;
      return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
        stroke="${SECTOR_COLORS[i % 8]}" stroke-width="9" stroke-linecap="round"><title>${esc(name)} ${v}점</title></line>`;
    }).join('');
    container.innerHTML = `<svg viewBox="0 0 160 160" style="width:100%;max-width:160px;display:block;margin:auto">
      <circle cx="${cx}" cy="${cy}" r="62" fill="none" stroke="var(--line)" stroke-dasharray="2 6"/>
      ${bars}<circle cx="${cx}" cy="${cy}" r="6" fill="var(--navy)"/></svg>`;
  }

  // 경로 점수 게이지 (270도 아크)
  function gauge(container, score) {
    if (!container) return;
    const value = Math.max(0, Math.min(100, Number(score || 0)));
    const r = 42, circ = 2 * Math.PI * r, arc = circ * 0.75;
    const dash = `${(value / 100 * arc).toFixed(2)} ${(arc - value / 100 * arc).toFixed(2)} ${circ - arc}`;
    container.innerHTML = `<svg viewBox="0 0 110 110" style="width:110px;height:110px">
      <circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--line)" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${arc} ${circ - arc}" transform="rotate(135 55 55)"/>
      <circle cx="55" cy="55" r="${r}" fill="none" stroke="url(#gaugeGrad)" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${dash}" transform="rotate(135 55 55)"/>
      <defs><linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#b8914e"/><stop offset="1" stop-color="#2f8f83"/></linearGradient></defs>
      <text x="55" y="58" text-anchor="middle" font-family="ui-monospace,monospace" font-size="22" font-weight="700" fill="var(--navy)">${value.toFixed(1)}</text>
      <text x="55" y="72" text-anchor="middle" font-size="8" fill="var(--muted)">ROUTE SCORE</text>
    </svg>`;
  }

  /* 관측 데스크용 고급 시각화 */

  // 추천 경로를 4개 축으로 겹쳐 비교하는 레이더
  function routeRadar(container, routes) {
    if (!container) return;
    if (!routes || !routes.length) { container.innerHTML = '<p class="hint">분석 후 표시됩니다.</p>'; return; }
    const axes = ['관심사', '시간', '비용', '품질'];
    const cx = 90, cy = 90, R = 58;
    const pt = (i, v) => {
      const a = (-90 + i * 90) * Math.PI / 180;
      return [cx + R * v * Math.cos(a), cy + R * v * Math.sin(a)];
    };
    const rings = [0.25, 0.5, 0.75, 1].map((k) => `<polygon points="${[0,1,2,3].map(i=>pt(i,k).map(n=>n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--line)"/>`).join('');
    const colors = global.SeoulJourney.ROUTE_COLORS;
    const shapes = routes.map((r, idx) => {
      const vals = [
        Math.min(1, r.score / 100),
        Math.max(0.15, 1 - r.total_travel_minutes / 400),
        Math.max(0.15, 1 - r.estimated_cost_krw / 100000),
        Math.min(1, r.data_confidence || 0)
      ];
      return `<polygon points="${vals.map((v,i)=>pt(i,v).map(n=>n.toFixed(1)).join(',')).join(' ')}"
        fill="${colors[idx]}" fill-opacity=".10" stroke="${colors[idx]}" stroke-width="1.6">
        <title>${idx+1}위 경로 ${r.score}점</title></polygon>`;
    }).join('');
    const labels = axes.map((a,i)=>{ const [x,y]=pt(i,1.22); return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle" font-size="8" fill="var(--muted)">${a}</text>`; }).join('');
    container.innerHTML = `<svg viewBox="0 0 180 180" style="width:100%;max-width:180px;display:block;margin:auto">${rings}${shapes}${labels}</svg>
      <div class="legend">${routes.map((r,i)=>`<span><i style="background:${colors[i]}"></i>${i+1}위 ${r.score}점</span>`).join('')}</div>`;
  }

  // 활동 간 이동 흐름도 (단순 새니키 리본)
  function flowRibbon(container, route) {
    if (!container) return;
    const nodes = (route && route.nodes) || [];
    if (nodes.length < 2) { container.innerHTML = '<p class="hint">경로가 없습니다.</p>'; return; }
    const w = 260, h = 110, pad = 8;
    const segs = nodes.slice(1).map((n, i) => {
      const prev = nodes[i];
      const y = pad + i * (h - pad * 2) / Math.max(1, nodes.length - 2);
      const thickness = Math.max(6, Math.min(24, (n.distance_km || 0) * 3));
      return { y, thickness, name: `${prev.place.name} → ${n.place.name}`, km: n.distance_km };
    });
    container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto">
      ${segs.map((s,i)=>`<path d="M${pad} ${s.y} C${w/2} ${s.y - 10} ${w/2} ${s.y + 12} ${w-pad} ${s.y + s.thickness}"
        fill="none" stroke="${SECTOR_COLORS[i % 8]}" stroke-width="${s.thickness}" opacity=".35" stroke-linecap="round">
        <title>${esc(s.name)} · ${s.km}km</title></path>`).join('')}
      </svg><div class="legend">${segs.map(s=>`<span>${esc(s.name)} ${s.km}km</span>`).join('')}</div>`;
  }

  // 시간대 혼잡 호라이즌 차트 (겹친 면적 그래프)
  function horizon(container, route) {
    if (!container) return;
    const key = route ? route.nodes.map(n=>n.place.id).join('-') : 'default';
    const layers = [0, 1, 2].map((layer) => {
      const vals = Array.from({ length: 12 }, (_, i) => (hash(key + layer + i) % 100));
      const pts = vals.map((v, i) => [i * 260 / 11, 70 - (v / 100) * (46 - layer * 10)]);
      const line = pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      return `<path d="${line} L260,70 L0,70 Z" fill="${['#2f8f83','#b8914e','#b45f54'][layer]}" opacity="${0.34 - layer*0.06}"/>`;
    }).join('');
    container.innerHTML = `<svg viewBox="0 0 260 76" style="width:100%;height:auto">
      <line x1="0" y1="70" x2="260" y2="70" stroke="var(--line)"/>${layers}</svg>
      <div class="legend"><span>08시</span><span>13시</span><span>19시</span></div>`;
  }

  // 방향 오빗 링: 회전하는 세그먼트 링
  function orbit(container, scores) {
    if (!container) return;
    const entries = Object.entries(scores || {});
    if (!entries.length) { container.innerHTML = '<p class="hint">분석 후 표시됩니다.</p>'; return; }
    const cx = 80, cy = 80;
    const segs = entries.map(([name, v], i) => {
      const a0 = i * 45 + 2, a1 = a0 + 41;
      const r0 = 36, r1 = r0 + Math.max(4, v / 90 * 32);
      const p = (r,a)=>[cx+r*Math.cos(a*Math.PI/180), cy+r*Math.sin(a*Math.PI/180)];
      const [x0,y0]=p(r0,a0), [x1,y1]=p(r1,a0), [x2,y2]=p(r1,a1), [x3,y3]=p(r0,a1);
      return `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} A${r1},${r1} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} Z"
        fill="${SECTOR_COLORS[i%8]}" opacity=".78"><title>${esc(name)} ${v}점</title></path>`;
    }).join('');
    container.innerHTML = `<svg viewBox="0 0 160 160" style="width:100%;max-width:160px;display:block;margin:auto">
      <circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="var(--line)" stroke-dasharray="2 5"/>
      <g style="transform-origin:80px 80px;animation:spin 26s linear infinite">${segs}</g>
      <circle cx="${cx}" cy="${cy}" r="4" fill="var(--gold)"/>
      <text x="${cx}" y="${cy-38}" text-anchor="middle" font-size="8" fill="var(--muted)">N</text>
      </svg><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
  }

  global.SeoulCharts = { COLORS, SECTOR_COLORS, NAMES_KO, kpis, donut, bars, heat, routeProfile, timelineRibbon, rose, gauge, routeRadar, flowRibbon, horizon, orbit };
})(window);
