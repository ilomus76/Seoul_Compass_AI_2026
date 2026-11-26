/* 활동별 후보를 공간적으로 묶고 일정 순서에 맞는 지도 동선을 구성한다. */
(function (global) {
  'use strict';
  const COLORS = ['#b7791f', '#21877c', '#526ac0', '#a65885', '#547c52'];
  const ROUTE_COLORS = ['#1665c1', '#ba4536', '#138064', '#7c459e', '#ae690d'];
  const REFERENCE_COLOR = '#b71931';
  const REFERENCE_ROUTE_COLORS = [REFERENCE_COLOR, '#176c8a', '#7352a8', '#9a6508', '#397044'];
  const NAMES = { hiking:'등산', swimming:'수영', restaurant:'식사', shower:'샤워', bowling:'볼링', karaoke:'노래방',
    meeting:'약속', cafe:'카페', shopping:'쇼핑', pub:'술자리', subway_station:'지하철', return_home:'귀가',
    history_museum:'역사 박물관', palace:'고궁', market_food:'시장 먹거리', baseball_game:'야구 경기 관람',
    baseball_event:'야구 행사 관람', return_to_current:'현재 위치 복귀' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
  const valid = p => p && p.lat != null && p.lng != null && Number.isFinite(Number(p.lat))
    && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180;
  const minutes = s => /^\d{2}:\d{2}$/.test(s || '') ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null;

  function distance(a, b) {
    const r = Math.PI / 180, dlat = (b.lat - a.lat) * r, dlng = (b.lng - a.lng) * r;
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  // 서버 경로가 없을 때도 반경 50m의 후보를 묶어 미리 보기를 제공한다.
  function cluster(places, threshold = 50) {
    const unique = new Map();
    (places || []).filter(valid).forEach(p => unique.set(p.id || `${p.lat},${p.lng},${p.name}`, p));
    const pending = [...unique.values()], groups = [];
    while (pending.length) {
      const neighborhoods = pending.map(p => pending.filter(q => distance(p, q) <= threshold));
      const index = neighborhoods.reduce((best, group, i) => group.length > neighborhoods[best].length ? i : best, 0);
      const members = neighborhoods[index];
      groups.push({members, representative:pending[index], center:pending[index], radius:threshold, size:members.length});
      for (let i = pending.length - 1; i >= 0; i--) {
        if (members.includes(pending[i])) pending.splice(i, 1);
      }
    }
    return groups.sort((a, b) => b.members.length - a.members.length);
  }

  function nodePoint(node) { return node?.cluster?.center || node?.place; }

  function routeClusters(data, index) {
    const groups = new Map();
    for (const route of [...(data.routes || []), data.route]) {
      const node = route?.nodes?.[index];
      const group = node?.cluster;
      if (!group || !valid(group.center)) continue;
      groups.set(group.place_ids.join(','), {
        center:group.center, radius:group.radius_m, size:group.size, representative:node.place
      });
    }
    return [...groups.values()];
  }

  // 시간표가 있으면 선택 경로를 쓰고, 없으면 요청 시각만 가진 후보 동선을 만든다. 시간표는 임의 생성하지 않는다.
  function build(data) {
    const activities = data.activities || [], route = data.route, rows = route?.schedule?.timeline || [];
    const start = route?.start_location || data.route_start;
    const origin = start && {lat:start.latitude, lng:start.longitude};
    let previous = valid(origin) ? origin : {lat:data.start?.latitude, lng:data.start?.longitude};
    const stops = activities.map((activity, i) => {
      const row = rows.find(t => t.activity_id === activity.id) || rows[i];
      const node = route?.nodes?.[i];
      const chosen = node?.place;
      const supplied = (data.candidate_groups || []).find(g => g.activity_id === activity.id);
      const candidates = supplied ? supplied.places : (data.places || []).filter(p => p.category === activity.category);
      const clusterOptions = routeClusters(data, i);
      const clusters = clusterOptions.length ? clusterOptions : cluster([...(candidates || []), ...(valid(chosen) ? [chosen] : [])]);
      let place = valid(chosen) ? chosen : null;
      if (!place && !route && clusters.length) {
        // 대안 모두를 방문점으로 잇지 않고 각 활동의 군집 대표 한 곳을 연결한다.
        const representatives = clusters.map(g => g.representative);
        place = valid(previous) ? representatives.reduce((a, b) => distance(previous, a) <= distance(previous, b) ? a : b) : representatives[0];
      }
      const point = valid(chosen) ? nodePoint(node) : place;
      if (point) previous = point;
      const start = row?.estimated_start || activity.start_time || activity.earliest_start || activity.preferred_time;
      const end = row?.estimated_end || activity.end_time || activity.latest_end;
      const time = start ? `${start}${!row && activity.earliest_start && !activity.start_time ? ' 이후' : ''}` : end ? `~${end}` : '시각 미정';
      let startMinute = minutes(start), endMinute = minutes(end);
      if (startMinute != null && endMinute != null && endMinute < startMinute) endMinute += 1440;
      return {index:i, activityId:activity.id, name:NAMES[activity.category] || activity.category,
        place, point, clusters, color:data.routeColor || COLORS[i % COLORS.length], time, startMinute, endMinute,
        warning: row?.visit_warning || place?.visit_warning,
        conflict:(route?.schedule?.conflicts || []).some(c => c.activity_id === activity.id)};
    });
    // 자정 이후에도 방문 순서를 유지한다. 충돌이 있어도 요청 순서를 임의로 정렬하지 않는다.
    let day = 0, last = null;
    stops.forEach(s => {
      if (s.startMinute != null) {
        if (last != null && s.startMinute + day < last - 720) day += 1440;
        s.startMinute += day;
        if (s.endMinute != null) s.endMinute += day;
        last = s.startMinute;
      }
    });
    const segments = [];
    stops.forEach((to, i) => {
      const from = stops[i - 1];
      if (from?.point && to.point && distance(from.point, to.point) > 1) {
        segments.push({from:from.point, to:to.point, index:i, color:to.color,
          startMinute:from.endMinute ?? from.startMinute, endMinute:to.startMinute});
      }
    });
    if (route && !route.preview && valid(origin) && stops[0]?.point && distance(origin, stops[0].point) > 1) {
      segments.unshift({from:origin, to:stops[0].point, index:0, color:stops[0].color,
        startMinute:minutes(route.departure_time), endMinute:stops[0].startMinute});
    }
    const network = data.networkRoutes?.get(route);
    if (network) {
      segments.forEach(segment => {
        const match = network.legs.get(segment.index);
        if (match?.key === segmentKey(segment)) segment.network = match;
      });
    }
    return {stops, segments, preview:!route || !!route.preview};
  }

  function visible(index, filter) { return filter === 'all' || index === Number(filter); }

  function segmentKey(segment) {
    return [segment.from, segment.to]
      .map(p => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`).join('|');
  }

  function pathsFor(segment) { return segment.network?.paths || [[segment.from, segment.to]]; }

  function arrowSegment(segment) {
    const path = pathsFor(segment)[0];
    const mid = Math.floor((path.length - 1) / 2);
    return [path[mid], path[mid + 1]];
  }

  function routeColor(route, index) {
    return route?.reference ? REFERENCE_ROUTE_COLORS[(route.reference_rank || 1) - 1] : ROUTE_COLORS[index];
  }

  // 겹치는 구간은 넓은 선부터 포개 두어 여러 추천의 색이 모두 보이게 한다.
  function routeLayers(data, selected, filter) {
    const groups = new Map();
    (data.routes || []).forEach((route, index) => {
      if (filter !== 'all' && route !== selected) return;
      const color = routeColor(route, index);
      const segments = build({...data, route, routeColor:color}).segments;
      segments.filter(s => visible(s.index, filter)).forEach(segment => {
        const key = segment.network
          ? `${segment.network.mode}:${segmentKey(segment)}`
          : segmentKey(segment).split('|').sort().join('|');
        if (!groups.has(key)) groups.set(key, new Map());
        groups.get(key).set(index, {...segment, color, opacity:route === selected ? .98 : .82});
      });
    });
    return [...groups.values()].flatMap(group => [...group.values()]
      .map((segment, i) => ({...segment, width:3 + i * 3})).reverse());
  }

  function svgLine(path, project, color, width, opacity, solid) {
    const d = path.map((p, i) => {
      const pos = project(p);
      return `${i ? 'L' : 'M'}${pos.x} ${pos.y}`;
    }).join(' ');
    return `<path class="recommendation-line${solid ? ' network-line' : ''}" d="${d}" fill="none"
      stroke="${color}" stroke-width="${width}" opacity="${opacity}" ${solid ? '' : 'stroke-dasharray="7 5"'}/>`;
  }

  function renderRouteLayers(layers, project) {
    return (layers || []).flatMap(s => pathsFor(s).map(path =>
      svgLine(path, project, s.color, s.width, s.opacity, !!s.network))).join('');
  }

  // SVG 보기와 카카오맵이 같은 방문 번호·색상·시간 필터를 사용한다.
  function renderSvg(model, project, filter = 'all', layered = false) {
    if (!model) return '';
    const lines = model.segments.filter(s => visible(s.index, filter)).map(s => {
      const [a, b] = arrowSegment(s).map(project), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      return `<g class="journey-segment" data-start="${s.startMinute ?? ''}" data-end="${s.endMinute ?? ''}">
        ${layered ? '' : pathsFor(s).map(path => svgLine(path, project, s.color, 3, 1, !!s.network)).join('')}
        <path d="M-5 -4 L1 0 L-5 4" fill="none" stroke="${s.color}" stroke-width="2.5" transform="translate(${x},${y}) rotate(${angle})"/></g>`;
    }).join('');
    const points = model.stops.filter(s => visible(s.index, filter) && s.place).map(s => {
      const p = project(s.point);
      const left = s.index % 3 === 2, below = s.index % 3 === 1;
      const groups = s.clusters.filter(g => g.size > 1).map(g => {
        const center = project(g.center);
        const edge = project({lat:Number(g.center.lat) + g.radius / 111000, lng:g.center.lng});
        return `<circle cx="${center.x}" cy="${center.y}" r="${Math.abs(edge.y - center.y)}" fill="${s.color}" fill-opacity=".06" stroke="${s.color}" stroke-opacity=".3"><title>${esc(s.time)} ${esc(s.name)} 후보 ${g.size}곳</title></circle>`;
      }).join('');
      return `${groups}<g class="journey-stop" data-start="${s.startMinute ?? ''}" data-end="${s.endMinute ?? ''}" style="--journey-color:${s.color}">
        <title>${s.index + 1}. ${esc(s.time)} ${esc(s.name)} · ${esc(s.place.name)}${s.warning ? ` · ${esc(s.warning.reason)}` : s.conflict ? ' · 시간 충돌' : ''}</title>
        <circle class="journey-number" cx="${p.x}" cy="${p.y}" r="8" fill="white" stroke="${s.color}" stroke-width="2"/>
        <text x="${p.x}" y="${p.y + 3}" text-anchor="middle" fill="${s.color}" font-size="9" font-weight="700">${s.index + 1}</text>
        <text class="journey-svg-time" x="${p.x + (left ? -11 : 11)}" y="${p.y + (below ? 18 : -10)}" text-anchor="${left ? 'end' : 'start'}" fill="${s.color}">${esc(s.time)}${s.conflict ? ' !' : ''}</text></g>`;
    }).join('');
    return lines + points;
  }

  function highlight(container, minute) {
    container.querySelectorAll('.journey-stop,.journey-segment').forEach(el => {
      const start = el.dataset.start === '' ? null : Number(el.dataset.start);
      const end = el.dataset.end === '' ? null : Number(el.dataset.end);
      el.classList.toggle('active', start != null && minute >= start && minute < (end ?? start + 1));
    });
  }

  global.SeoulJourney = {build, cluster, distance, visible, renderSvg, highlight, esc,
    ROUTE_COLORS, REFERENCE_COLOR, routeColor, routeLayers, renderRouteLayers, nodePoint, segmentKey, pathsFor, arrowSegment};
})(window);
