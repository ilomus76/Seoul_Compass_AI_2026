/* 관측 데스크 컨트롤러: API 호출, 지도, 시각화, GPS, 음성입력, 타임라인 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  const state = {
    parsed: null, routes: [], selectedRoute: null, startDate: null, tripId: null,
    mapMode: 'geo', gps: { used: false, source: null, accuracy: null },
    watchId: null, scrubTimer: null, voice: null, listening: false,
    density: null, transport: null, alarms: [], chat: [], weather: null,
    sim: { playing:false, progress:0, speed:1, mode:'walking', timer:null, logged:-1 },
    kakaoKey: null, kakaoFailed: false,
    searchCenter: null, routeStart: null, locationFromQuestion: false, locationError: null,
    regions: [], selectedRegion: null, directionalResult: null, planEdited: false, originLocation: null, resumeAfterLocation: false,
    journeyFilter:'all', journeyVisible:true, previewRoute:null, analyzedText:''
  };
  let lastPlaces = [], lastScores = [];
  let reportCache = {};
  let scheduleRevision = 0;
  const networkRoutes = new WeakMap();
  const networkPending = new WeakSet();
  let displayedJourney = null;

  async function post(path, body) {
    const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body) });
    if (!res.ok) {
      const result = await res.json().catch(() => null);
      throw new Error(typeof result?.detail === 'string' ? result.detail : `${path} 오류: ${res.status}`);
    }
    return res.json();
  }
  async function request(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} 오류: ${res.status}`);
    return res.json();
  }
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
  }
  function setGpsStatus(text, kind) {
    const el = $('gpsStatus');
    el.innerHTML = `<span class="gps-pulse"></span>${esc(text)}`;
    el.className = 'gps-status' + (kind ? ' ' + kind : '');
  }

  /* ---------- 지도 ---------- */
  function referenceRoutes(region) {
    return region?.reference_routes || (region?.reference_route ? [region.reference_route] : []);
  }

  function renderCurrentMap({preserveZoom = false, focusRoute = false} = {}) {
    // 입력값이 없으면 분석용 기본값만 사용하고 화면에는 비워둔다.
    const lat = Number($('lat').value) || 37.5665;
    const lng = Number($('lng').value) || 126.9780;
    const references = referenceRoutes(state.selectedRegion);
    const payload = {
      start: { latitude: lat, longitude: lng },
      route_start: state.routeStart,
      radius_km: Number($('radius').value) || 5,
      places: lastPlaces, scores: lastScores, route: state.selectedRoute || state.previewRoute,
      routes: [...state.routes, ...references],
      activities: state.parsed?.activities || [], candidate_groups:state.selectedRegion?.candidate_groups,
      preserveZoom, networkRoutes
    };
    payload.routeColor = SeoulJourney.routeColor(payload.route, state.routes.indexOf(payload.route));
    const journey = SeoulJourney.build(payload);
    displayedJourney = journey;
    $('mapFocusRoute').hidden = !payload.route || !journey.segments.length;
    const filter = $('journeyFilter');
    if (!journey.stops.some(s => String(s.index) === state.journeyFilter)) state.journeyFilter = 'all';
    filter.innerHTML = '<option value="all">전체 동선</option>' + journey.stops.map(s =>
      `<option value="${s.index}">${esc(s.time)} ${esc(s.name)}${s.place ? '' : ' · 장소 없음'}</option>`).join('');
    filter.value = state.journeyFilter;
    $('journeyPanel').hidden = !journey.stops.length;
    $('journeyNote').textContent = payload.route?.reference ? `참고 동선 ${references.length}개 · 빨간 지점의 방문 조건을 확인하세요.` : journey.preview
      ? '후보 동선 · 요청 시각 기준 · 출발 구간 미포함'
      : '선택 일정의 동선 · 시각은 이동 추정 반영';
    $('journeyGuide').textContent = '반경 50m 후보 군집 · 실선: 조회된 길 · 점선: 직선 추정';
    payload.journey = state.journeyVisible ? journey : null;
    payload.journey_filter = state.journeyFilter;
    payload.route_layers = SeoulJourney.routeLayers(payload, payload.route, state.journeyVisible ? state.journeyFilter : 'all');
    if (focusRoute) {
      const segments = payload.route_layers.length ? payload.route_layers : journey.segments;
      payload.focusPoints = segments.flatMap(segment => SeoulJourney.pathsFor(segment).flat());
    }
    renderNetworkStatus(payload.route, journey, payload.route_layers);
    if (state.kakaoKey && state.mapMode === 'geo' && !state.kakaoFailed) {
      SeoulMapHelper.useKakaoMap($('compass'), state.kakaoKey, payload.start, payload, (msg) => {
        state.kakaoFailed = true;
        SeoulCompassMap.renderGeo($('compass'), payload);
        applySimMarker();
        const badge = document.getElementById('mapProviderBadge');
        if (badge) badge.textContent = '카카오 로드 실패 → SVG';
        toast(msg);
      });
    } else {
      SeoulMapHelper.clearKakaoMap();
      if (state.mapMode === 'geo') SeoulCompassMap.renderGeo($('compass'), payload);
      else SeoulCompassMap.render($('compass'), payload);
    }
    applySimMarker();
    $('mapModeGeo').classList.toggle('active', state.mapMode === 'geo');
    $('mapModePolar').classList.toggle('active', state.mapMode === 'polar');
    const name = state.searchCenter ? state.searchCenter.name : $('locationName').value;
    const departure = state.routeStart && state.routeStart.name;
    $('mapCaption').textContent = state.locationError || (name
      ? `${name} 기준 · ${payload.radius_km}km${departure && departure !== name ? ` · 출발 ${departure}` : ''}`
      : '검색 기준점 미설정 · GPS 또는 지도 선택');
  }

  function renderNetworkStatus(route, journey, layers) {
    $('networkLookup').disabled = !route || !journey.segments.length || networkPending.has(route);
    $('networkCredits').hidden = !layers.some(s => s.network?.source === 'osm');
    const applied = journey.segments.filter(s => s.network);
    const result = route && networkRoutes.get(route);
    const status = $('networkStatus');
    if (route && networkPending.has(route)) {
      status.textContent = '실제 경로를 조회하고 있습니다.';
    } else if (result?.status === 'missing_key') {
      status.textContent = '철도·지하철 노선을 조회하려면 서버에 ODsay 키가 필요합니다.';
    } else if (applied.length) {
      const mode = {walking:'도보', cycling:'자전거', driving:'자동차', subway:'지하철', train:'기차'}[result.mode];
      const fullDistance = applied.length === journey.segments.length && applied.every(s => s.network.distance_km != null);
      const totals = fullDistance
        ? ` · ${applied.reduce((n, s) => n + s.network.distance_km, 0).toFixed(2)}km · 약 ${applied.reduce((n, s) => n + s.network.minutes, 0)}분` : '';
      status.textContent = `${mode} 실선 ${applied.length}/${journey.segments.length}구간${totals}`
        + (applied.some(s => s.network.source === 'odsay') ? ' · ODsay 노선 · 역 접근·환승 도보 제외' : '');
    } else if (result?.status === 'unavailable') {
      status.textContent = '조회된 경로가 없어 직선 추정으로 표시합니다.';
    } else if (route?.reference && !journey.segments.length && journey.stops.filter(stop => stop.place).length > 1) {
      status.textContent = '확인된 방문 지점의 지도 좌표가 같습니다. 번호로 방문 순서를 확인하세요.';
    } else {
      status.textContent = '조회 시 선택 구간의 좌표를 경로 서비스에 보냅니다.';
    }
  }

  async function lookupNetwork() {
    const route = state.selectedRoute || state.previewRoute;
    const journey = displayedJourney;
    if (!route || !journey?.segments.length || networkPending.has(route)) return;
    const mode = $('networkMode').value;
    const keys = new Map(journey.segments.map(segment => [segment.index, SeoulJourney.segmentKey(segment)]));
    const legs = journey.segments.map(s => ({
      index:s.index, start:{lat:s.from.lat,lng:s.from.lng}, end:{lat:s.to.lat,lng:s.to.lng}
    }));
    networkPending.add(route);
    $('networkLookup').disabled = true;
    $('networkStatus').textContent = '실제 경로를 조회하고 있습니다.';
    try {
      const result = await post('/api/routes/network', {mode, legs});
      networkRoutes.set(route, {mode, status:result.status, legs:new Map(result.legs.map(leg =>
        [leg.index, {...leg, mode, key:keys.get(leg.index)}]))});
    } catch {
      networkRoutes.set(route, {mode, status:'unavailable', legs:new Map()});
    } finally {
      networkPending.delete(route);
      if (state.routes.includes(route) || referenceRoutes(state.selectedRegion).includes(route)) renderCurrentMap();
    }
  }

  /* ---------- 일정표 ---------- */
  function renderSchedule() {
    SeoulScheduleView.render($('scheduleTable').querySelector('tbody'), $('conflicts'),
      state.selectedRoute && state.selectedRoute.schedule, {
        onSelect: (index) => {
          if (!state.selectedRoute || !state.parsed) return;
          const node = state.selectedRoute.nodes[index];
          SeoulScheduleView.renderDetail($('scheduleDetail'), {
            activity: state.parsed.activities[index], place: node.place, node,
            candidates: state.selectedRegion ? state.selectedRegion.candidate_groups[index].places : lastPlaces
          }, { onPlaceChange: (place) => {
            node.place = place;
            delete node.cluster;
            networkRoutes.delete(state.selectedRoute);
            if (state.routeStart) {
              // 시설을 바꾸면 중심까지의 거리가 아닌 연속 방문 지점 사이의 거리를 다시 구한다.
              let previous = {lat:state.routeStart.latitude, lng:state.routeStart.longitude};
              const mode = inputs().modes[0] || 'walking';
              state.selectedRoute.nodes.forEach(segment => {
                const p = SeoulJourney.nodePoint(segment);
                const distance = SeoulJourney.distance(previous, p) / 1000;
                segment.distance_km = Math.round(distance * 1000) / 1000;
                segment.travel_minutes = distance < .001 ? 0 : Math.max(1, Math.round(distance / ({walking:5,bus:20,subway:30}[mode] || 5) * 60)) + (mode === 'walking' ? 0 : 5);
                previous = p;
              });
              state.selectedRoute.total_distance_km = Number(state.selectedRoute.nodes.reduce((sum, n) => sum + n.distance_km, 0).toFixed(2));
              state.selectedRoute.total_travel_minutes = state.selectedRoute.nodes.reduce((sum, n) => sum + n.travel_minutes, 0);
            }
            revalidate(); renderCurrentMap(); toast(`장소를 ${place.name}(으)로 변경했습니다.`);
          }});
        },
        onTimeChange: (index, value) => {
          if (!state.parsed || !state.parsed.activities[index]) return;
          state.parsed.activities[index].start_time = value;
          state.parsed.activities[index].fixed_time = true;
          state.planEdited = true;
          revalidate(); toast('시간을 수정하고 일정을 다시 검증했습니다.');
        },
        onDurationChange: (index, value) => {
          if (!state.parsed || !state.parsed.activities[index]) return;
          state.parsed.activities[index].duration_minutes = value;
          state.parsed.activities[index].duration_estimated = false;
          state.planEdited = true;
          revalidate(); toast('체류시간을 수정하고 일정을 다시 검증했습니다.');
        }
      });
    renderScrubber();
  }

  async function revalidate() {
    if (!state.selectedRoute) return;
    const route = state.selectedRoute;
    const revision = ++scheduleRevision;
    try {
      const result = await post('/api/schedule/validate', {
        activities: state.parsed.activities, route });
      if (route !== state.selectedRoute || revision !== scheduleRevision) return;
      if (state.selectedRegion) {
        result.timing_feasible_estimate = result.feasible; result.feasible = null;
        result.verified_feasible = false;
        result.note = '사용자 수정과 직선거리 이동 추정 기준입니다. 실제 방문 가능성은 확인이 필요합니다.';
      }
      state.selectedRoute.schedule = result;
      result.timeline.forEach((row, index) => {
        const node = route.nodes[index];
        if (node) node.place = {...node.place, visit_warning:row.visit_warning};
      });
      reportCache = {};
      if (state.selectedRegion) {
        if (!route.reference) state.selectedRegion.status = result.conflicts.length ? 'time_conflict' : 'needs_confirmation';
      }
      renderRecommendations();
      renderSchedule();
      renderCurrentMap();
      SeoulRouteView.renderReport($('reportBody'), reportFor(state.selectedRoute));
      renderCharts(lastPlaces, lastScores);
    } catch (err) { toast(err.message || '일정 검증에 실패했습니다.'); }
  }

  /* ---------- 타임라인 스크러버 ---------- */
  function toMinutes(v) { if (!v) return null; const p = String(v).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function fromMinutes(m) { return `${String(Math.floor(m / 60) % 24).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`; }

  function renderScrubber() {
    const rows = (state.selectedRoute && state.selectedRoute.schedule
      && state.selectedRoute.schedule.timeline) || [];
    if (!rows.length) {
      $('scrubSlider').max = 100; $('scrubSlider').value = 0;
      $('scrubTime').textContent = '09:00';
      $('scrubLabel').textContent = '일정을 분석하면 타임라인이 생성됩니다.';
      return;
    }
    const start = rows.map(r => toMinutes(r.estimated_start)).filter(v => v != null);
    const end = rows.map(r => toMinutes(r.estimated_end)).filter(v => v != null);
    const lo = Math.min(...start), hi = Math.max(...end);
    $('scrubSlider').min = lo; $('scrubSlider').max = Math.max(lo + 1, hi);
    $('scrubSlider').value = lo;
    updateScrub(lo, rows);
  }

  function updateScrub(minute, rows) {
    rows = rows || (state.selectedRoute && state.selectedRoute.schedule
      && state.selectedRoute.schedule.timeline) || [];
    $('scrubTime').textContent = fromMinutes(minute);
    let active = -1;
    rows.forEach((r, i) => {
      const s = toMinutes(r.estimated_start), e = toMinutes(r.estimated_end);
      if (s != null && e != null && minute >= s && minute < e) active = i;
    });
    const current = rows[active];
    $('scrubLabel').textContent = current
      ? `${current.category} · ${current.place || ''} · ${current.estimated_start}~${current.estimated_end}`
      : '이동 또는 대기 구간';
    document.querySelectorAll('#compass .route-node').forEach((n, i) => n.classList.toggle('active', i === active));
    SeoulJourney.highlight($('compass'), minute);
  }

  $('scrubSlider').addEventListener('input', () => updateScrub(Number($('scrubSlider').value)));
  $('scrubPlay').addEventListener('click', () => {
    if (state.scrubTimer) {
      clearInterval(state.scrubTimer); state.scrubTimer = null;
      $('scrubPlay').textContent = '▶ 재생'; return;
    }
    const lo = Number($('scrubSlider').min), hi = Number($('scrubSlider').max);
    if (lo >= hi) { toast('재생할 일정이 없습니다.'); return; }
    $('scrubPlay').textContent = '❚❚ 정지';
    state.scrubTimer = setInterval(() => {
      let v = Number($('scrubSlider').value) + 5;
      if (v > hi) v = lo;
      $('scrubSlider').value = v;
      updateScrub(v);
    }, 120);
  });

  /* ---------- 시각화 ---------- */
  function renderPlaceList(places) {
    const box = $('placeListPanel');
    if (!box) return;
    $('placeCount').textContent = `${places.length}곳`;
    box.innerHTML = places.length
      ? `<table class="place-table"><thead><tr><th>장소</th><th>업종</th><th>거리</th><th>평점</th><th>영업</th><th>요금</th><th>혼잡</th></tr></thead><tbody>
        ${places.map(p => {
          const crowd = p.crowd_by_hour ? Math.round(Object.values(p.crowd_by_hour).reduce((a,b)=>a+b,0) / Object.values(p.crowd_by_hour).length) : '-';
          return `<tr><td><b${p.visit_warning ? ' class="visit-warning"' : ''}>${esc(p.name)}</b><br><small>${esc(p.address || '')}</small>${SeoulRouteView.visitWarning(p.visit_warning)}</td><td>${esc(p.category)}</td>
            <td>${p.distance_km}km (직선)</td><td>${p.rating == null ? '미확인' : '★ ' + p.rating}</td><td>${esc(SeoulRouteView.operatingHours(p))}</td>
            <td>${p.fee_krw == null ? '확인 필요' : p.fee_krw + '원'}</td><td>${crowd === '-' ? '미확인' : crowd + '%'}</td></tr>`;
        }).join('')}</tbody></table>`
      : '<p class="hint">검색 결과가 없습니다.</p>';
  }

  function renderCharts(places, scores) {
    const conflicts = (state.selectedRoute && state.selectedRoute.schedule
      && state.selectedRoute.schedule.conflicts
      && state.selectedRoute.schedule.conflicts.length) || 0;
    SeoulCharts.kpis($('kpiGrid'), { places, routes: state.routes, conflicts, scores,
      regionMode: !!state.selectedRegion, draftCount: state.routes.length });
    renderPlaceList(places);
    SeoulCharts.donut($('categoryDonut'), places);
    SeoulCharts.orbit($('directionOrbit'), scores);
    SeoulCharts.rose($('directionRose'), scores);
    SeoulCharts.bars($('scoreBars'), scores);
    $('directionScores').innerHTML = Object.entries(scores).sort((a,b)=>b[1]-a[1])
      .map(([n,v]) => `<span>${esc(n)} ${v}점</span>`).join('');
    SeoulCharts.routeRadar($('routeRadar'), state.routes.filter(r => r.score != null));
    SeoulCharts.flowRibbon($('flowRibbon'), state.selectedRoute);
    SeoulCharts.routeProfile($('routeProfile'), state.selectedRoute);
    SeoulCharts.horizon($('crowdHorizon'), state.selectedRoute);
    SeoulCharts.heat($('crowdHeat'), state.selectedRoute);
    SeoulCharts.timelineRibbon($('timelineRibbon'), state.selectedRoute && state.selectedRoute.schedule);
    const routeScores = {}; state.routes.forEach((r,i)=>{ if (r.score != null) routeScores[`${i+1}위`] = r.score; });
    SeoulCharts.bars($('routeQuality'), routeScores);
    SeoulCharts.gauge($('scoreGauge'), state.selectedRoute && state.selectedRoute.score);
    if (state.selectedRegion) {
      $('crowdHorizon').textContent = '시간별 혼잡도 정보 미확인';
      $('crowdHeat').innerHTML = '';
      $('scoreGauge').textContent = '실제 방문 가능성 확인 필요';
    }
  }

  function reportFor(route) {
    if (!route) return null;
    const key = route.score + '-' + route.nodes.map(n => n.place.id).join(',');
    if (!reportCache[key]) reportCache[key] = route.report || {
      recommended_direction: route.direction, route_score: route.score,
      interest_satisfaction: route.score, places: route.nodes.map(n => n.place.name),
      timeline: (route.schedule || {}).timeline || [], total_travel_minutes: route.total_travel_minutes,
      total_activity_minutes: 0, estimated_transport_cost_krw: null,
      estimated_facility_cost_krw: route.estimated_cost_krw, reasons: [],
      conflicts: (route.schedule || {}).conflicts || [], data_confidence: route.data_confidence,
      verification_status: route.verification_status,
      cautions: route.cautions || ['직선거리 기반 추정입니다. 실제 경로는 확인이 필요합니다.'], alternatives: []
    };
    return reportCache[key];
  }

  /* ---------- 전문가용 플랜 패널 ---------- */
  function renderParsedPlan() {
    const box = $('parsedPlan');
    const p = state.parsed;
    if (!p) { box.innerHTML = '<p class="hint">분석 후 구조화 결과가 표시됩니다.</p>'; return; }
    const item = (label, value) => `<div><b>${esc(label)}</b><span>${esc(value || '-')}</span></div>`;
    const planRows = (p.activities || []).map((a, i) => {
      const start = a.start_time || a.earliest_start || a.preferred_time || '-';
      let end = a.end_time || '-';
      if (start !== '-' && !a.end_time && a.duration_minutes != null) {
        const [h, m] = start.split(':').map(Number);
        const total = h * 60 + m + a.duration_minutes;
        end = `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
      }
      return `<tr><td>${i + 1}</td><td>${esc(a.keyword || a.category)}</td>
        <td>${esc(p.travel_date || '-')}</td><td>${esc(start)} ~ ${esc(end)}</td>
        <td>${esc(a.location || a.place || '-')}</td><td>${esc(a.category)}</td>
        <td>${esc((p.special_notes || []).join(' · ') || '-')}</td>
        <td>${a.fixed_time ? '고정' : '추정'}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="detail-grid">
      ${item('분석 방식', p.analysis_method === 'context' ? '문맥 분석' : '기존 규칙 분석')}
      ${item('방문 지역', p.region_scope)}
      ${item('날짜', p.travel_date || '미지정')}
      ${item('예산', p.budget_krw ? `${p.budget_krw}원` : '미지정')}
      ${item('목적', (p.purpose || []).join(' · '))}
      ${item('특이사항', (p.special_notes || []).join(' · '))}
      ${item('검색 기준점', p.search_center && p.search_center.name)}
      ${item('중심 선택 이유', p.location_context && p.location_context.reason)}
      ${item('좌표 출처', p.search_center && p.search_center.source)}
      ${item('경로 출발지', p.start_location && p.start_location.name)}
      ${item('검색 반경', `${p.radius_km}km`)}
      ${item('출발 시각', p.departure_time)}
    </div>
    <div class="chunk-title">플랜 구조 데이터 <span>${(p.activities || []).length}개 항목</span></div>
    <div class="table-wrap"><table class="plan-table"><thead><tr><th>#</th><th>활동</th><th>날짜</th><th>시간</th><th>장소</th><th>목적</th><th>특이사항</th><th>구분</th></tr></thead>
      <tbody>${planRows}</tbody></table></div>
    <div class="chunk-title">입력 청크 <span>${(p.chunks || []).length}개 · 클릭하여 편집</span></div>
    <div class="chunk-row">${(p.chunks || []).map((c, i) => `<button class="chunk chunk-${esc(c.type)} chunk-edit" type="button" data-chunk="${i}" title="${esc(c.type)}">
      <b>${esc(c.type)}</b>${esc(c.text)}<i>→ ${esc(c.value)}</i></button>`).join('') || '<span class="hint">청크 없음</span>'}</div>
    <div class="chunk-editor" hidden>
      <div class="grid-form">
        <div><label>타입</label><select class="ce-type"><option value="date">date</option><option value="time">time</option><option value="place">place</option><option value="activity">activity</option><option value="note">note</option></select></div>
        <div><label>원문</label><input class="ce-text" /></div>
        <div><label>정규값</label><input class="ce-value" /></div>
      </div>
      <div class="detail-actions"><button class="primary ce-apply" type="button">적용</button>
        <button class="danger ce-delete" type="button">삭제</button><button class="ghost ce-close" type="button">닫기</button></div>
    </div>
    <div class="detail-actions"><button class="ghost chunk-add" type="button">+ 청크 추가</button>
      <button class="ghost json-toggle" type="button">원본 JSON 보기</button></div>
    <pre class="json-view" hidden>${esc(JSON.stringify(p, null, 2))}</pre>`;
    const btn = box.querySelector('.json-toggle');
    const view = box.querySelector('.json-view');
    btn.addEventListener('click', () => {
      view.hidden = !view.hidden;
      btn.textContent = view.hidden ? '원본 JSON 보기' : '원본 JSON 숨기기';
    });

    // 청크 편집기
    const editor = box.querySelector('.chunk-editor');
    const typeSel = box.querySelector('.ce-type');
    const textInput = box.querySelector('.ce-text');
    const valueInput = box.querySelector('.ce-value');
    let editing = null;

    function openChunk(i) {
      editing = i;
      const chunk = (p.chunks || [])[i];
      if (!chunk) return;
      typeSel.value = chunk.type; textInput.value = chunk.text; valueInput.value = chunk.value;
      editor.hidden = false;
    }
    box.querySelectorAll('.chunk-edit').forEach(chip => chip.addEventListener('click', () => openChunk(Number(chip.dataset.chunk))));
    box.querySelector('.ce-close').addEventListener('click', () => { editor.hidden = true; editing = null; });
    box.querySelector('.chunk-add').addEventListener('click', () => {
      p.chunks = p.chunks || [];
      p.chunks.push({ type:'note', start:9999, text:'새 청크', value:'확인 필요' });
      renderParsedPlan();
      toast('청크를 추가했습니다. 내용을 편집해 주세요.');
    });
    box.querySelector('.ce-delete').addEventListener('click', () => {
      if (editing == null) return;
      p.chunks.splice(editing, 1);
      editor.hidden = true; editing = null;
      renderParsedPlan(); toast('청크를 삭제했습니다.');
    });
    box.querySelector('.ce-apply').addEventListener('click', () => {
      if (editing == null) return;
      const chunk = p.chunks[editing];
      const oldValue = chunk.value, oldType = chunk.type;
      chunk.type = typeSel.value; chunk.text = textInput.value.trim(); chunk.value = valueInput.value.trim();
      applyChunkToPlan(p, chunk, oldType, oldValue);
      editor.hidden = true; editing = null;
      renderParsedPlan();
      if (state.selectedRoute) revalidate();
      toast('청크를 반영했습니다.');
    });
  }

  // 편집된 청크 값을 플랜 구조 데이터에 반영한다.
  function applyChunkToPlan(plan, chunk, oldType, oldValue) {
    if (oldType === 'date') plan.travel_date = chunk.value;
    if (oldType === 'time') {
      (plan.activities || []).forEach(a => {
        ['start_time', 'earliest_start', 'preferred_time'].forEach(k => {
          if (a[k] === oldValue) a[k] = chunk.value;
        });
      });
    }
    if (oldType === 'place') {
      (plan.activities || []).forEach(a => { if (a.place === oldValue) a.place = chunk.value; });
    }
    if (oldType === 'note') {
      plan.special_notes = (plan.special_notes || []).map(n => n === oldValue ? chunk.value : n);
      if (!plan.special_notes.includes(chunk.value)) plan.special_notes.push(chunk.value);
    }
    if (oldType === 'activity') {
      (plan.activities || []).forEach(a => {
        if (a.keyword === oldValue || a.category === oldValue) a.keyword = chunk.value;
      });
    }
    state.startDate = plan.travel_date || state.startDate;
  }

  function renderDensity(data) {
    state.density = data;
    const box = $('densityList');
    const sectors = (data && data.sectors) || [];
    if (!sectors.length) { box.innerHTML = '<p class="hint">분석 후 밀집도가 표시됩니다.</p>'; return; }
    box.innerHTML = sectors.map((s, i) => {
      const top = (s.clusters || [])[0];
      const width = top ? Math.min(100, top.count / Math.max(1, s.total_places) * 100) : 0;
      return `<article class="route-card" data-density="${i}" style="--card-accent:${['#b8914e','#2f8f83','#b45f54'][i%3]}">
        <h3>${esc(s.time || '시간 미정')} · ${esc(s.category || '')}</h3>
        <p>총 ${s.total_places}곳 · 최밀집 ${esc(top ? top.direction : '-')} ${top ? top.count : 0}곳 (평균 ${top ? top.avg_score : 0}점)</p>
        <div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(0)}%;--bar-color:#b8914e"></div></div>
        <p>${(s.top_places || []).slice(0,3).map(p => esc(p.name)).join(' · ')}</p>
        <button class="ghost select-density" type="button">이 구역 경로 분석</button>
      </article>`;
    }).join('');
    box.querySelectorAll('.select-density').forEach(btn => btn.addEventListener('click', async () => {
      const i = Number(btn.closest('[data-density]').dataset.density);
      await analyzeTransport(sectors[i]);
      toast('선택한 밀집 구역의 이동 경로를 분석했습니다.');
    }));
  }

  async function analyzeTransport(sector) {
    const cfg = inputs();
    const activities = (state.parsed && state.parsed.activities) || [];
    try {
      const data = await post('/api/routes/options', {
        latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius,
        start_location: state.routeStart,
        transport_modes: cfg.modes, activities });
      state.transport = data;
      const box = $('transportList');
      box.innerHTML = (data.options || []).map(o => `<article class="route-card">
        <h3>${o.order}순서 · ${esc(o.place)} · ${o.distance_km}km</h3>
        ${o.modes.map(m => `<div class="bar-row"><span>${esc(m.mode)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,m.score).toFixed(0)}%;--bar-color:#2f8f83"></div></div>
          <span>${m.minutes}분 · ${m.fare_krw}원 · 혼잡 ${m.crowd}%</span></div>`).join('')}
      </article>`).join('');
    } catch (err) { toast(err.message || '이동수단 분석 실패'); }
  }

  async function renderWeather() {
    const cfg = inputs();
    const targetDate = state.startDate || cfg.date;
    try {
      const w = await request(`/api/weather?latitude=${cfg.lat}&longitude=${cfg.lng}${targetDate ? '&date='+targetDate : ''}`);
      state.weather = w;
      $('weatherBox').innerHTML = `<div class="detail-grid">
        <div><b>기온</b><span>${w.temperature}°C</span></div>
        <div><b>상태</b><span>${esc(w.condition)}</span></div>
        <div><b>출처</b><span>${esc(w.source)}</span></div>
        <div><b>권장</b><span>${w.indoor_recommended ? '실내 중심' : '실외 가능'}</span></div>
      </div><p class="hint">${w.indoor_recommended ? '실내 장소를 우선 적용했습니다.' : '야외 일정 유지가 가능합니다.'}</p>
      <ul>${(w.advice || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>`;
    } catch (err) { $('weatherBox').textContent = err.message; }
  }

  function renderAlarms() {
    const rows = (state.selectedRoute && state.selectedRoute.schedule && state.selectedRoute.schedule.timeline) || [];
    const box = $('alarmList');
    if (!rows.length) { box.innerHTML = '<p class="hint">일정 분석 후 알람이 생성됩니다.</p>'; return; }
    state.alarms = rows.map(r => ({ ...r, remaining: (r.duration_minutes || 60) * 60, running: false, timer: null, warned: false }));
    box.innerHTML = state.alarms.map((a, i) => `<article class="route-card" data-alarm="${i}">
      <h3>${esc(a.category)} · ${esc(a.place)}</h3>
      <p>${esc(a.estimated_start)} ~ ${esc(a.estimated_end)} · ${a.duration_minutes}분</p>
      <div class="bar-track"><div class="bar-fill alarm-bar" style="width:100%;--bar-color:#b8914e"></div></div>
      <p class="alarm-time">남은 시간 ${Math.floor(a.remaining/60)}분</p>
      <div class="detail-actions"><button class="primary alarm-start" type="button">시작</button>
      <button class="ghost alarm-return" type="button">복귀/완료</button></div>
    </article>`).join('');
    box.querySelectorAll('.alarm-start').forEach(btn => btn.addEventListener('click', () => {
      const i = Number(btn.closest('[data-alarm]').dataset.alarm);
      startAlarm(i);
    }));
    box.querySelectorAll('.alarm-return').forEach(btn => btn.addEventListener('click', () => {
      const i = Number(btn.closest('[data-alarm]').dataset.alarm);
      stopAlarm(i);
    }));
  }

  function startAlarm(i) {
    const a = state.alarms[i];
    if (!a || a.running) return;
    a.running = true; a.warned = false;
    toast(`${a.place} 알람을 시작했습니다.`);
    a.timer = setInterval(() => {
      a.remaining -= 1;
      const half = (a.duration_minutes || 60) * 30;
      if (!a.warned && a.remaining <= half) {
        a.warned = true;
        toast(`⏰ ${a.place} 왕복 시간의 절반이 지났습니다. 원위치로 복귀하세요.`);
        beep();
      }
      const card = document.querySelector(`[data-alarm="${i}"]`);
      if (card) {
        const pct = Math.max(0, a.remaining / ((a.duration_minutes || 60) * 60) * 100);
        card.querySelector('.alarm-bar').style.width = pct + '%';
        card.querySelector('.alarm-time').textContent = `남은 시간 ${Math.floor(a.remaining/60)}분`;
      }
      if (a.remaining <= 0) { stopAlarm(i); toast(`${a.place} 일정이 종료되었습니다.`); }
    }, 1000);
  }
  function stopAlarm(i) {
    const a = state.alarms[i];
    if (!a) return;
    clearInterval(a.timer); a.timer = null; a.running = false;
    const card = document.querySelector(`[data-alarm="${i}"]`);
    if (card) card.querySelector('.alarm-time').textContent = '알람 완료';
  }
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = .08;
      osc.start(); osc.stop(ctx.currentTime + .3);
    } catch (_) { /* 소리 미지원 시 무시 */ }
  }

  async function renderSafety() {
    const cfg = inputs();
    try {
      const [guide, help, risks] = await Promise.all([
        request('/api/safety/guide?category=hiking'),
        post('/api/safety/help', { latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius }),
        request(`/api/safety/riskzones?latitude=${cfg.lat}&longitude=${cfg.lng}&radius_km=${cfg.radius}`)
      ]);
      const places = [...(help.police || []), ...(help.fire || [])];
      $('safetyBox').innerHTML = `<div class="detail-grid"><div><b>지침</b><span>${esc(guide.title)}</span></div>
        <div><b>긴급번호</b><span>${esc(guide.emergency)}</span></div></div>
        <ul>${(guide.items || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="detail-actions">
          <a class="danger" href="tel:112">경찰 112</a><a class="danger" href="tel:119">소방 119</a>
        </div>
        <p class="hint">주변 도움 지점: ${places.slice(0,3).map(p=>esc(p.name)).join(' · ') || '데이터 없음'}</p>
        <p class="caption">위험구역 ${risks.count}곳 (목업 데이터)</p>
        <ul>${(risks.zones || []).map(z => `<li><b>${esc(z.name)}</b> · ${esc(z.level)} · ${z.distance_km}km · ${esc(z.note)}</li>`).join('') || '<li>주변 위험구역 없음</li>'}</ul>`;
    } catch (err) { $('safetyBox').textContent = err.message; }
  }

  /* ---------- AI 챗봇 ---------- */
  function chatReply(text) {
    const q = text.toLowerCase();
    if (/날씨|weather/.test(q)) return state.weather ? `기온 ${state.weather.temperature}°C, ${state.weather.condition}. ${state.weather.indoor_recommended ? '실내 중심을 권장합니다.' : '야외 일정이 가능합니다.'}` : '분석 후 날씨 정보를 확인해 드릴게요.';
    if (/혼잡|crowd/.test(q)) return state.density ? `시간별 밀집도 ${state.density.sectors.length}개 구역을 분석했습니다.` : '플랜을 분석하면 밀집도를 알려드릴게요.';
    if (/알람|alarm/.test(q)) return '플랜 패널의 시간 알람에서 시작 버튼을 누르면 왕복 절반 시점에 알립니다.';
    if (/안전|신고|safety/.test(q)) return '안전 지침과 경찰(112)·소방(119) 연결, 주변 도움 지점을 제공합니다.';
    if (/이동|교통|transport/.test(q)) return '추천 이동수단 패널에서 교통비·혼잡도·시간을 비교해 선택할 수 있습니다.';
    return '질문을 이해했습니다. 날씨·혼잡도·알람·안전·이동 중 원하는 주제를 말씀해 주세요.';
  }
  function renderChat() {
    const log = $('chatLog'); if (!log) return;
    log.innerHTML = (state.chat.length ? state.chat : [{ role:'bot', text:'여행 플랜에 대해 무엇이든 물어보세요. 여러 언어를 지원합니다.' }])
      .map(m => `<div class="chat-row ${m.role}"><div class="avatar">${m.role==='bot'?'✦':'🙂'}</div><div class="bubble">${esc(m.text)}</div></div>`).join('');
    log.scrollTop = log.scrollHeight;
  }
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim(); if (!text) return;
    $('chatInput').value = '';
    state.chat.push({ role:'user', text });
    state.chat.push({ role:'bot', text: chatReply(text) });
    renderChat();
  });

  /* ---------- 경로 시뮬레이션 ---------- */
  function simNodes() { return (state.selectedRoute && state.selectedRoute.nodes) || []; }

  function simPosition() {
    const nodes = simNodes();
    if (!nodes.length) return null;
    const cfg = inputs();
    const start = { latitude: cfg.lat, longitude: cfg.lng };
    const seg = Math.min(nodes.length - 1, Math.floor(state.sim.progress * (nodes.length - 1)));
    const frac = state.sim.progress * (nodes.length - 1) - seg;
    const a = SeoulCompassMap.projectForSim(SeoulJourney.nodePoint(nodes[seg]), start, cfg.radius);
    const b = nodes[seg + 1]
      ? SeoulCompassMap.projectForSim(SeoulJourney.nodePoint(nodes[seg + 1]), start, cfg.radius) : a;
    return { seg, frac, x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  function simLog(message) {
    const box = $('simLog'); if (!box) return;
    const time = new Date().toTimeString().slice(0, 8);
    box.insertAdjacentHTML('afterbegin', `<div>[${time}] ${esc(message)}</div>`);
    while (box.children.length > 12) box.lastElementChild.remove();
  }

  function applySimMarker() {
    const marker = document.querySelector('#compass #simMarker');
    const pos = simPosition();
    if (!marker || !pos) return;
    marker.hidden = false;
    marker.setAttribute('cx', pos.x.toFixed(1));
    marker.setAttribute('cy', pos.y.toFixed(1));
  }

  function updateSimUI() {
    const nodes = simNodes();
    if (!nodes.length) return;
    const pos = simPosition();
    const from = nodes[pos.seg].place.name;
    const to = nodes[pos.seg + 1] ? nodes[pos.seg + 1].place.name : from;
    const remaining = nodes.slice(pos.seg).reduce((s, n) => s + (n.distance_km || 0), 0) * (1 - pos.frac);
    const mins = Math.max(1, Math.round(remaining / ({walking:5,bus:20,subway:30})[state.sim.mode] * 60));
    const crowd = nodes[pos.seg].place.crowd_by_hour
      ? Math.round(Object.values(nodes[pos.seg].place.crowd_by_hour).reduce((a,b)=>a+b,0) / Object.values(nodes[pos.seg].place.crowd_by_hour).length)
      : 0;
    $('simStatus').innerHTML = `${state.sim.playing ? '▶ 이동 중' : '❚❚ 일시정지'} · ${esc(from)} → ${esc(to)}<br>
      남은 거리 ${remaining.toFixed(1)}km · 예상 ${mins}분 · 혼잡 ${crowd}% · ${esc(state.sim.mode)}`;
    $('simProgress').style.width = (state.sim.progress * 100).toFixed(1) + '%';
    $('simBadge').textContent = state.sim.playing ? '재생 중' : (state.sim.progress > 0 ? '일시정지' : '대기');
    if (pos.seg !== state.sim.logged) {
      state.sim.logged = pos.seg;
      simLog(`도착 예정: ${from}`);
      if (pos.seg > 0) toast(`${from}에 도착했습니다.`);
    }
    applySimMarker();
  }

  function simTick() {
    state.sim.progress = Math.min(1, state.sim.progress + 0.012 * state.sim.speed);
    if (state.sim.progress >= 1) { simPause(); simLog('전체 경로 주행 완료'); toast('시뮬레이션이 완료되었습니다.'); }
    updateSimUI();
  }
  function simPlay() {
    if (!simNodes().length) { toast('먼저 경로를 분석해 주세요.'); return; }
    if (state.sim.timer) return;
    state.sim.playing = true;
    state.sim.timer = setInterval(simTick, 100);
    $('simPlay').textContent = '❚❚ 정지';
    simLog('시뮬레이션 시작');
    updateSimUI();
  }
  function simPause() {
    clearInterval(state.sim.timer); state.sim.timer = null;
    state.sim.playing = false;
    $('simPlay').textContent = '▶ 재생';
    updateSimUI();
  }
  function simReset() {
    simPause(); state.sim.progress = 0; state.sim.logged = -1;
    $('simLog').innerHTML = '';
    updateSimUI();
  }
  $('simPlay').addEventListener('click', () => { state.sim.timer ? simPause() : simPlay(); });
  $('simReset').addEventListener('click', simReset);
  $('simPrev').addEventListener('click', () => {
    const n = Math.max(1, simNodes().length);
    state.sim.progress = Math.max(0, Math.floor(state.sim.progress * (n - 1)) - 1) / Math.max(1, n - 1);
    updateSimUI();
  });
  $('simNext').addEventListener('click', () => {
    const n = Math.max(1, simNodes().length);
    state.sim.progress = Math.min(1, (Math.floor(state.sim.progress * (n - 1)) + 1) / Math.max(1, n - 1));
    updateSimUI();
  });
  $('simSpeed').addEventListener('change', () => { state.sim.speed = Number($('simSpeed').value); });
  $('simMode').addEventListener('change', () => { state.sim.mode = $('simMode').value; updateSimUI(); });

  /* ---------- 분석 ---------- */
  const activityNames = { hiking:'등산', swimming:'수영', restaurant:'식사', shower:'샤워', bowling:'볼링',
    history_museum:'역사 박물관', palace:'고궁', market_food:'시장 먹거리', baseball_game:'야구 경기 관람',
    baseball_event:'야구 행사 관람', return_to_current:'현재 위치 복귀' };

  function renderRecommendations() {
    const panel = $('recommendationPanel');
    panel.hidden = (!state.directionalResult && !!state.selectedRegion) || !state.routes.length;
    if (!panel.hidden) {
      const scan = state.directionalResult;
      $('recommendationCoverage').textContent = `활동 후보 충족 100% · 반경 ${state.parsed.radius_km}km`
        + (scan ? ` · ${scan.scanned_headings}방향 비교 · 중복 제외 ${scan.direction_candidate_count}개 코스` : '');
      $('recommendationList').innerHTML = SeoulRouteView.recommendationList(
        state.routes, state.selectedRoute || state.previewRoute, -1, state.routeStart, state.analyzedText);
    }
    if (state.selectedRegion) renderRegions();
    SeoulRouteView.render($('routeList'), state.routes, selectGlobalRecommendation);
  }

  function storeAdditionalCourses(result) {
    const link = $('additionalCoursesLink');
    link.hidden = true;
    try {
      const key = 'seoul-compass-additional-courses';
      sessionStorage.removeItem(key);
      if (!result) return;
      const regions = result.regions || [];
      const activeRoutes = [...(result.recommendations || []), ...regions.flatMap(referenceRoutes)];
      const viewing = activeRoutes.flatMap(route => route.nodes.map(node => node.place.id));
      const included = new Set(viewing);
      const publicPlace = place => ({
        name: place.name, industry: place.merchant?.industry || place.provider_category,
        url: place.place_url, visit_warning: place.visit_warning
      });
      const otherPlaces = new Map();
      for (const region of regions) {
        for (const group of region.candidate_groups || []) {
          const activity = state.parsed.activities.find(item => item.id === group.activity_id);
          const label = activity?.request_term || activityNames[group.category] || group.category;
          const groupPlaces = otherPlaces.get(label) || new Map();
          for (const place of group.places) {
            if (place.source !== 'user' && !included.has(place.id)) groupPlaces.set(place.id, publicPlace(place));
          }
          if (groupPlaces.size) otherPlaces.set(label, groupPlaces);
        }
      }
      const routes = (result.alternative_routes || []).map(route => ({
        rank: route.rank, corridor: route.corridor, distance: route.total_distance_km, minutes: route.total_travel_minutes,
        stops: route.nodes.map((node, i) => ({
          name: node.place.source === 'user' ? '복귀 지점' : node.place.name,
          term: node.place.source === 'user' ? null : node.request_term,
          time: route.schedule?.timeline?.[i]?.estimated_start
        }))
      }));
      const places = [...otherPlaces].map(([label, items]) => ({label, items:[...items.values()]}));
      const directions = regions.flatMap(region => {
        const reviews = region.direction_reviews || [];
        const hasReferences = reviews.some(review => review.kind === 'reference');
        return reviews.filter(review => !hasReferences || review.kind === 'reference' || region.routes?.length)
          .map(review => ({...review, region:region.name, radius:region.radius_km}));
      });
      if (routes.length || places.length || directions.length) {
        sessionStorage.setItem(key, JSON.stringify({routes, places, directions}));
        link.hidden = false;
      }
    } catch {
      // 브라우저가 세션 저장을 막으면 이전 분석의 링크를 노출하지 않는다.
    }
  }

  function selectGlobalRecommendation(route) {
    const regionIndex = route?.region_id && state.regions.findIndex(region => region.id === route.region_id);
    if (Number.isInteger(regionIndex) && regionIndex >= 0 && state.regions[regionIndex] !== state.selectedRegion) {
      selectRegion(regionIndex, state.regions[regionIndex].routes.indexOf(route), {preserveZoom:true});
    } else selectRecommendation(route);
  }

  function selectRecommendation(route) {
    if (!route) return;
    state.previewRoute = route.preview ? route : null;
    state.selectedRoute = route.preview ? null : route;
    state.journeyFilter = 'all';
    $('scheduleDetail').hidden = true;
    renderCurrentMap({preserveZoom:true}); renderSchedule(); renderCharts(lastPlaces, lastScores);
    $('scrubLabel').textContent = route.preview ? '후보 동선 · 출발 위치 적용 후 일정 계산' : '선택한 일정의 이동 추정';
    renderRecommendations();
    SeoulRouteView.renderReport($('reportBody'), reportFor(state.selectedRoute));
    simReset(); renderAlarms();
    if (state.planEdited && state.selectedRoute) revalidate();
  }

  function renderRegions() {
    const panel = $('regionPanel'); panel.hidden = false;
    $('regionList').innerHTML = state.regions.map((region, i) => {
      const status = { reference_available:'참고 동선 · 방문 조건 확인 필요', missing_places:'필수 장소 부족', no_corridor:'방향·시간 조건에 맞는 경로 없음',
        time_conflict:'시간 충돌 있음', needs_origin:'현재 위치 적용 필요', needs_confirmation:'방문 조건 확인 필요' }[region.status];
      const routes = region.routes || (region.draft_route ? [region.draft_route] : []);
      const selected = state.selectedRegion === region ? state.selectedRoute || state.previewRoute : null;
      const timeline = (selected || region.draft_route)?.schedule?.timeline || [];
      const markets = (selected || region.draft_route)?.nodes.map(node => node.place)
        .filter(place => place.food_options?.length) || [];
      const warned = region.places.filter(place => place.visit_warning);
      return `<article class="route-card" style="--card-accent:${state.selectedRegion === region ? '#2f8f83' : '#b8914e'}">
        <h3>${i + 1}. ${esc(region.name)} 주변 · ${esc(status)}</h3>
        <p>활동 후보 충족 ${region.coverage_percent}% · 반경 ${region.radius_km}km</p>
        ${state.directionalResult ? SeoulRouteView.venueDetails(selected || region.draft_route)
          : SeoulRouteView.recommendationList(routes, selected, i, region.start_location, state.analyzedText)}
        ${referenceRoutes(region).map((route, index) => SeoulRouteView.referenceCourse(route, selected, i, region.start_location, index)).join('')}
        ${warned.length ? `<ul class="visit-warning-list">${warned.map(place => `<li>
          ${SeoulRouteView.visitPlaceLink(place)}${SeoulRouteView.venuePhone(place.phone)}${SeoulRouteView.visitWarning(place.visit_warning)}</li>`).join('')}</ul>` : ''}
        ${markets.map(market => `<div class="market-food-options">
          <strong>${esc(market.name)} 주변 먹거리</strong>
          <ul>${market.food_options.map(food => `<li>${/^https?:\/\//i.test(food.place_url || '')
            ? `<a href="${esc(food.place_url)}" target="_blank" rel="noopener noreferrer">${esc(food.name)}</a>`
            : esc(food.name)}${food.menus?.length ? ` · ${esc(food.menus.join(' / '))} (${esc(food.menu_source)})`
              : food.menu_hint ? ` · 상호의 단서 ${esc(food.menu_hint)}` : ''}${SeoulRouteView.venuePhone(food.phone)}</li>`).join('')}</ul>
          <p>메뉴와 방문일 영업시간 확인 필요</p>
        </div>`).join('')}
        <p>${region.candidate_groups.map(g => `${esc(activityNames[g.category] || g.category)} ${g.places.length}곳`).join(' · ')}</p>
        ${region.first_leg && region.first_leg.status === 'needs_origin' ? '<p>현재 위치를 적용하면 출발·복귀 시간을 계산할 수 있습니다.</p>' : ''}
        ${region.first_leg && region.first_leg.planned_departure ? `<p>${esc(region.first_leg.planned_departure)} 출발${region.first_leg.estimated_arrival ? ` → ${esc(region.first_leg.estimated_arrival)} 목적지 도착 추정` : ' · 도착 시각은 출발 위치 적용 후 계산'}</p>` : ''}
        ${region.missing_activities.length ? `<p>찾지 못한 조건: ${esc(region.missing_activities.join(', '))}</p>` : ''}
        ${timeline.length ? `<p>${timeline.map(t => `${t.estimated_start}~${t.estimated_end} ${esc(activityNames[t.category] || t.category)}`).join(' → ')}</p>` : ''}
        ${(selected || region.draft_route)?.schedule?.conflicts?.length ? `<p>${(selected || region.draft_route).schedule.conflicts.map(c => c.kind === 'visit_unavailable' ? esc(c.reason) : `${esc(c.reason)} ${c.shortage_minutes}분`).join(' · ')}</p>` : ''}
        <details><summary>방문 전 확인할 사항</summary><ul>${(selected?.cautions || region.checks_needed).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
          ${region.candidate_groups.map(g => g.places.map(p => p.place_url ? `<p><a href="${esc(p.place_url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)} 장소 정보</a>${p.phone ? ' · ' + esc(p.phone) : ''}</p>` : '').join('')).join('')}</details>
        <button class="ghost select-region" type="button" data-region="${i}">이 지역 지도·일정 보기</button>
      </article>`;
    }).join('') || '<p>지역 후보를 찾지 못했습니다. 안내에 따라 조건이나 위치를 확인해 주세요.</p>';
    panel.querySelectorAll('.select-region').forEach(button => button.addEventListener('click', () =>
      selectRegion(Number(button.dataset.region), 0, {preserveZoom:true})));
    panel.querySelectorAll('.select-reference').forEach(button => button.addEventListener('click', () =>
      selectRegion(Number(button.dataset.region), 0, {preserveZoom:true, referenceIndex:Number(button.dataset.route)})));
  }

  function selectRegion(index, routeIndex = 0, mapOptions) {
    const region = state.regions[index]; if (!region) return;
    const initialSelection = !state.selectedRegion;
    state.selectedRegion = region; state.searchCenter = region.search_center; state.routeStart = region.start_location;
    state.locationFromQuestion = true; state.locationError = null;
    state.parsed.search_center = region.search_center; state.parsed.start_location = region.start_location;
    (region.evaluated_activities || []).forEach((activity, i) => {
      const current = state.parsed.activities[i];
      if (current && current.duration_estimated && activity.duration_source === '출발 후 이동 추정을 제외한 산행 가능 시간창') {
        Object.assign(current, activity);
      }
    });
    $('originNotice').hidden = !(region.first_leg && region.first_leg.status === 'needs_origin');
    state.parsed.location_context.reason = '활동 조합을 비교한 지역 후보 · 실제 방문 확인 필요';
    const regionRoutes = region.routes || (region.draft_route ? [region.draft_route] : []);
    state.routes = state.directionalResult?.recommendations || regionRoutes;
    const references = referenceRoutes(region);
    const route = Number.isInteger(mapOptions?.referenceIndex) ? references[mapOptions.referenceIndex]
      : regionRoutes[routeIndex] || references[0];
    state.selectedRoute = route && !route.preview ? route : null;
    state.previewRoute = route?.preview ? route : null;
    state.journeyFilter = 'all';
    $('scheduleDetail').hidden = true;
    reportCache = {};
    lastPlaces = region.places; lastScores = {};
    $('lat').value = region.search_center.latitude; $('lng').value = region.search_center.longitude;
    if (initialSelection) $('radius').value = region.radius_km;
    $('locationName').value = region.name;
    setGpsStatus(`${region.name} · 지역 후보 · 방문 조건 확인 필요`, 'warn');
    renderCurrentMap({...mapOptions, focusRoute:initialSelection && !!route?.reference});
    renderSchedule(); renderCharts(lastPlaces, lastScores); renderParsedPlan();
    renderRecommendations();
    SeoulRouteView.renderReport($('reportBody'), reportFor(state.selectedRoute));
    $('simLog').innerHTML = ''; simReset(); renderAlarms();
    const needsOrigin = region.first_leg && region.first_leg.status === 'needs_origin';
    $('scrubLabel').textContent = route?.reference ? '참고 동선 · 빨간 지점의 방문 조건을 확인해 주세요.'
      : state.selectedRoute ? '검토용 일정 · 방문 시간과 실제 이동 확인 필요'
      : needsOrigin ? '주변 시설 검색 완료 · 출발 위치 적용 후 이동·일정 계산'
      : region.status === 'missing_places' ? '필수 활동의 장소를 모두 찾지 못했습니다.' : '이 지역에 표시할 추천 일정이 없습니다.';
    if (needsOrigin && !region.draft_route) {
      $('scheduleTable').querySelector('tbody').innerHTML = '<tr><td colspan="6">현재 위치를 적용하면 출발·복귀 이동시간을 계산합니다. 주변 시설은 후보 목록에서 확인할 수 있습니다.</td></tr>';
    }
    if (state.planEdited && state.selectedRoute) revalidate();
  }

  function inputs() {
    return {
      text: $('question').value.trim(),
      lat: Number($('lat').value) || 37.5665, lng: Number($('lng').value) || 126.9780,
      radius: Number($('radius').value) || 5, date: $('date').value || null,
      modes: Array.from(document.querySelectorAll('.mode:checked')).map(x => x.value),
      weights: { M:+$('wM').value, D:+$('wD').value, Q:+$('wQ').value, V:+$('wV').value }
    };
  }

  async function analyze() {
    const cfg = inputs();
    if (!cfg.text) { toast('질문을 입력하거나 음성으로 말해 주세요.'); return; }
    if ($('analyzeBtn').disabled) return;
    $('analyzeBtn').disabled = true;
    const buttonLabel = $('analyzeBtn').textContent;
    $('analyzeBtn').textContent = '분석 중…';
    SeoulRouteView.renderEventNotice($('eventNotice'), null);
    try {
      // 질문에서 얻은 지난 검색 중심을 새 질문의 수동 위치로 재사용하지 않는다.
      const hasCoordinates = $('lat').value.trim() !== '' && $('lng').value.trim() !== '';
      const fallback = state.originLocation || (state.locationFromQuestion ? null : {
        type: state.gps.used && state.gps.source === 'gps' ? 'current_location' : state.gps.source === 'ip' ? 'ip_estimate' : 'custom',
        name: $('locationName').value.trim() || null,
        latitude: hasCoordinates ? Number($('lat').value) : null,
        longitude: hasCoordinates ? Number($('lng').value) : null
      });
      state.parsed = await post('/api/parse', { text: cfg.text, fallback_location: fallback,
        fallback_radius_km: cfg.radius });
      state.analyzedText = cfg.text;
      // 문장에서 인식한 날짜가 UI 날짜보다 우선한다.
      state.startDate = state.parsed.travel_date || cfg.date;
      $('parseWarnings').textContent = [state.parsed.analysis_method === 'legacy' ? '문맥 분석 미활성 · 기존 분석 모드' : '',
        ...(state.parsed.warnings || [])].filter(Boolean).join(' · ');
      SeoulRouteView.renderEventNotice($('eventNotice'), state.parsed);
      renderParsedPlan();
      const context = state.parsed.location_context || {};
      state.regions = []; state.selectedRegion = null; state.directionalResult = null;
      storeAdditionalCourses(null);
      state.planEdited = false; $('regionPanel').hidden = true;
      state.previewRoute = null;
      $('recommendationPanel').hidden = true;
      state.journeyFilter = 'all';
      $('originNotice').hidden = !context.needs_current_location;
      if (state.parsed.reference_plan_available || state.parsed.planning_mode === 'region_discovery'
          || (state.parsed.live_place_plan && !context.needs_confirmation)) {
        $('regionPanel').hidden = false;
        $('regionNote').textContent = '목적지와 선택 반경 내 활동 시설을 검색하고 있습니다…';
        $('regionList').innerHTML = '';
        state.routes = []; state.selectedRoute = null; lastPlaces = []; lastScores = {};
        renderCurrentMap();
        renderSchedule(); renderCharts([], {});
        const result = await post('/api/regions/recommend', {
          region_scope: state.parsed.region_scope, travel_date: state.startDate,
          search_center: state.parsed.search_center,
          start_location: state.parsed.start_location,
          return_location: state.parsed.return_location,
          destination_name: context.mountain_name || (state.parsed.search_center && state.parsed.search_center.name),
          current_location_requested: state.parsed.current_location_requested || false,
          contextual: state.parsed.analysis_method === 'context',
          requested_bearing: state.parsed.requested_bearing,
          route_goal: state.parsed.route_goal,
          departure_time: state.parsed.departure_time,
          activities: state.parsed.activities, radius_km: state.parsed.radius_km,
          transport_modes: cfg.modes
        });
        state.regions = result.regions || [];
        storeAdditionalCourses(result);
        if (result.recommendations) {
          // JSON에서 지역별·전체 목록은 별도 객체이므로 지도와 선택 목록은 같은 객체를 참조한다.
          state.directionalResult = result;
          const recommendationsByRank = new Map(result.recommendations.map(route => [route.rank, route]));
          state.regions.forEach(region => {
            region.routes = region.routes.map(route => recommendationsByRank.get(route.rank));
            if (region.draft_route) region.draft_route = recommendationsByRank.get(region.draft_route.rank);
          });
        }
        const sourceStatus = {matched:'상권 업종 데이터 포함', unconfigured:'상권정보 키 미설정 · 카카오 장소 사용',
          unconfirmed:'공개 상권 업종 미확인'}[result.merchant_lookup];
        $('regionNote').textContent = [result.note, sourceStatus, ...(result.warnings || [])].filter(Boolean).join(' ');
        if (state.regions.length) selectRegion(0);
        else {
          state.locationError = (result.warnings || []).join(' ') || '지역 후보를 찾지 못했습니다.';
          renderCurrentMap(); renderRecommendations();
        }
        toast(`지역 후보 ${state.regions.length}곳을 비교했습니다. 방문 전 확인사항을 확인해 주세요.`);
        return;
      }
      if (context.needs_confirmation || !state.parsed.search_center) {
        state.locationError = context.error || '검색 기준점을 지정해 주세요.';
        state.routes = []; state.selectedRoute = null; state.searchCenter = null; state.routeStart = null;
        lastPlaces = []; lastScores = {}; reportCache = {};
        renderCurrentMap(); renderSchedule(); renderCharts([], {});
        SeoulRouteView.render($('routeList'), [], () => {});
        SeoulRouteView.renderReport($('reportBody'), null);
        toast(state.locationError); return;
      }
      state.locationError = null;
      state.searchCenter = state.parsed.search_center;
      state.routeStart = state.parsed.start_location;
      state.locationFromQuestion = !!context.center_name;
      cfg.lat = state.searchCenter.latitude; cfg.lng = state.searchCenter.longitude;
      cfg.radius = state.parsed.radius_km;
      $('lat').value = cfg.lat; $('lng').value = cfg.lng;
      $('radius').value = cfg.radius;
      $('locationName').value = state.searchCenter.name || '지정한 위치';
      setGpsStatus(`${state.searchCenter.name || '지정한 위치'} · ${context.reason || '사용자 지정'} · ${cfg.radius}km`, 'ok');
      const activities = state.parsed.activities;
      const interests = [];
      activities.forEach(a => { (a.keywords || []).forEach(k => interests.push(k)); if (a.keyword) interests.push(a.keyword); });
      const startLocation = state.routeStart;
      const direction = await post('/api/directions/analyze', {
        latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius,
        weights: cfg.weights, interests });
      const search = await post('/api/places/search', {
        latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius, limit: 30 });
      const result = await post('/api/routes/recommend', {
        start_location: startLocation, search_center: state.searchCenter, activities, radius_km: cfg.radius,
        transport_modes: cfg.modes, weights: cfg.weights });
      state.routes = result.routes || [];
      state.selectedRoute = state.routes[0] || null;
      lastPlaces = search.places; lastScores = direction.scores;
      renderCurrentMap(); renderSchedule(); renderCharts(search.places, direction.scores);
      renderRecommendations();
      renderParsedPlan();
      try {
        const densityData = await post('/api/density/analyze', {
          latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius, activities });
        renderDensity(densityData);
      } catch (err) { $('densityList').textContent = err.message; }
      await renderWeather();
      document.body.classList.toggle('sim-rain', !!(state.weather && state.weather.rainy));
      simReset();
      renderAlarms();
      await renderSafety();
      await analyzeTransport(null);
      SeoulRouteView.renderReport($('reportBody'), reportFor(state.selectedRoute));
      toast(`경로 ${state.routes.length}개를 추천했습니다.`);
    } catch (err) {
      const message = err.message || '분석 중 오류가 발생했습니다.';
      $('parseWarnings').textContent = message;
      SeoulRouteView.renderEventNotice($('eventNotice'), null, message);
      toast(message);
    }
    finally { $('analyzeBtn').disabled = false; $('analyzeBtn').textContent = buttonLabel; }
  }

  /* ---------- GPS ---------- */
  function applyPosition(pos, fromWatch) {
    state.originLocation = pos.source === 'ip' ? null : {
      type: pos.source === 'gps' ? 'current_location' : 'custom', source: pos.source,
      name: pos.source === 'gps' ? '현재 GPS 위치' : '지도에서 선택한 출발 위치',
      latitude: pos.latitude, longitude: pos.longitude
    };
    state.locationFromQuestion = false; state.searchCenter = null; state.routeStart = null; state.locationError = null;
    $('lat').value = Number(pos.latitude).toFixed(4);
    $('lng').value = Number(pos.longitude).toFixed(4);
    state.gps = { used: true, source: pos.source, accuracy: pos.accuracy };
    $('locationName').value = pos.city ? `${pos.city} (현재 위치)` : '현재 위치';
    const accuracy = pos.accuracy ? ` · 오차 약 ${pos.accuracy}m` : '';
    setGpsStatus(`${pos.source === 'gps' ? 'GPS' : 'IP 추정'} 위치 ${Number(pos.latitude).toFixed(4)}, ${Number(pos.longitude).toFixed(4)}${accuracy}`, pos.source === 'gps' ? 'ok' : 'warn');
    renderCurrentMap();
    if (!fromWatch) toast('현재 위치를 출발지로 적용했습니다.');
    if (state.resumeAfterLocation && !fromWatch) {
      state.resumeAfterLocation = false;
      if (pos.source === 'gps') analyze();
      else toast('현재 GPS 위치를 확인하지 못했습니다. 출발 좌표를 직접 입력하고 다시 분석해 주세요.');
    }
  }

  $('geoBtn').addEventListener('click', () => {
    SeoulMapHelper.useCurrentLocation(
      pos => applyPosition(pos, false),
      msg => { setGpsStatus(msg, 'warn'); toast(msg); },
      (text, kind) => setGpsStatus(text, kind)
    );
  });
  $('planGeoBtn').addEventListener('click', () => {
    state.resumeAfterLocation = true;
    $('geoBtn').click();
  });
  $('gpsWatchBtn').addEventListener('click', () => {
    if (state.watchId != null) {
      SeoulMapHelper.stopWatch(state.watchId); state.watchId = null;
      $('gpsWatchBtn').textContent = '실시간 추적 시작';
      toast('실시간 위치 추적을 종료했습니다.'); return;
    }
    state.watchId = SeoulMapHelper.watchPosition(
      pos => applyPosition(pos, true),
      msg => { setGpsStatus(msg, 'warn'); toast(msg); }
    );
    if (state.watchId != null) {
      $('gpsWatchBtn').textContent = '실시간 추적 중지';
      setGpsStatus('실시간 GPS 추적 중…', 'ok');
    }
  });
  $('compass').addEventListener('click', (e) => {
    // 카카오 SDK 내부 SVG는 자체 좌표계이므로 도표용 클릭 변환에서 제외한다.
    if (state.kakaoKey && state.mapMode === 'geo' && !state.kakaoFailed) return;
    const svg = $('compass').querySelector('svg'); if (!svg) return;
    const point = svg.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    const cfg = inputs();
    const extent = state.mapMode === 'geo' ? 275 : 245;
    const p = { latitude: cfg.lat + (300 - local.y) / extent * cfg.radius / 111,
      longitude: cfg.lng + (local.x - 300) / extent * cfg.radius / (111 * Math.cos(cfg.lat * Math.PI / 180)),
      source: 'map', city: '' };
    applyPosition(p, false);
    toast('지도에서 출발지를 선택했습니다.');
  });

  /* ---------- 음성 입력 ---------- */
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('micBtn').disabled = true; $('micBtn').title = '이 브라우저는 음성 인식을 지원하지 않습니다.'; return; }
    const rec = new SR();
    const speechLocale = (lang) => ({ ko:'ko-KR', en:'en-US', ja:'ja-JP', zh:'zh-CN' })[lang] || 'ko-KR';
    rec.lang = speechLocale(SeoulI18n.lang);
    rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const text = event.results[0][0].transcript;
      $('question').value = text;
      toast('음성 인식 완료: ' + text);
      analyze();
    };
    rec.onerror = (e) => toast('음성 인식 오류: ' + e.error);
    rec.onend = () => { state.listening = false; $('micBtn').textContent = '🎤 음성'; };
    state.voice = rec;
  }
  $('micBtn').addEventListener('click', () => {
    if (!state.voice) { toast('음성 인식을 지원하지 않는 브라우저입니다.'); return; }
    if (state.listening) { state.voice.stop(); return; }
    state.listening = true;
    $('micBtn').textContent = '🔴 듣는 중';
    try { state.voice.start(); } catch (e) { toast('음성 인식을 시작할 수 없습니다.'); state.listening = false; }
  });

  /* ---------- 여행 기록 ---------- */
  async function saveTrip() {
    if (state.selectedRoute?.reference || state.previewRoute?.reference) {
      toast('참고 동선의 방문 조건을 확인한 뒤 추천 일정을 선택해 주세요.'); return;
    }
    if (!state.parsed || !state.routes.length) { toast('먼저 분석을 실행해 주세요.'); return; }
    const cfg = inputs();
    const payload = {
      date: state.startDate || new Date().toISOString().slice(0,10), user_id: 'local_user',
      start_location: state.routeStart || { type: state.gps.used ? 'current_location' : 'custom',
        latitude: cfg.lat, longitude: cfg.lng, name: $('locationName').value },
      activities: state.parsed.activities, routes: state.routes };
    if (state.tripId) payload.trip_id = state.tripId;
    const saved = await post('/api/trips', payload);
    state.tripId = saved.trip_id;
    toast(`일정 ${saved.trip_id}이(가) 저장되었습니다.`);
    await refreshTrips();
  }

  async function refreshTrips() {
    const data = await request('/api/trips');
    SeoulHistoryView.render($('tripList'), data.trips, {
      onReuse: (trip) => {
        state.locationFromQuestion = false; state.searchCenter = null; state.routeStart = null; state.locationError = null;
        $('question').value = (trip.activities || []).map(a=>a.keyword||a.category).join(' ');
        const start = trip.start_location || {};
        if (start.latitude) $('lat').value = start.latitude;
        if (start.longitude) $('lng').value = start.longitude;
        state.tripId = trip.trip_id;
        toast('이전 일정을 불러왔습니다. 분석을 다시 눌러 주세요.');
      },
      onView: async (tripId) => {
        const places = state.selectedRoute ? state.selectedRoute.nodes.map(n=>n.place.name) : [];
        const show = async () => {
          const d = await request(`/api/trips/${tripId}/visits`);
          SeoulHistoryView.renderVisits($('visitPanel'), tripId, d.visits, {
            places,
            onAdd: async (v) => { await post(`/api/trips/${tripId}/visits`, v); toast('방문 기록을 추가했습니다.'); await show(); },
            onRemove: async (id) => { await fetch(`/api/trips/${tripId}/visits/${id}`, {method:'DELETE'}); await show(); }
          });
        };
        await show(); $('visitPanel').scrollIntoView({behavior:'smooth', block:'center'});
      },
      onVisit: async (tripId) => {
        const places = state.selectedRoute ? state.selectedRoute.nodes.map(n=>n.place.name) : [];
        if (!places.length) { toast('선택된 경로가 없습니다.'); return; }
        for (const name of places) await post(`/api/trips/${tripId}/visits`, {
          place_name: name, status:'visited', actual_start:new Date().toTimeString().slice(0,5) });
        toast('방문 기록을 저장했습니다.'); await refreshTrips();
      },
      onDelete: async (tripId) => { await fetch(`/api/trips/${tripId}`, {method:'DELETE'}); await refreshTrips(); }
    });
  }

  /* ---------- 이벤트 ---------- */
  $('quickForm').addEventListener('submit', (e) => { e.preventDefault(); analyze(); });
  $('networkLookup').addEventListener('click', lookupNetwork);
  ['regionList', 'recommendationList'].forEach(id => $(id).addEventListener('click', event => {
    const button = event.target.closest('.select-recommendation');
    if (!button) return;
    const region = Number(button.dataset.region), index = Number(button.dataset.route);
    if (region < 0 || state.regions[region] === state.selectedRegion) selectGlobalRecommendation(state.routes[index]);
    else selectRegion(region, index, {preserveZoom:true});
  }));
  $('mapModeGeo').addEventListener('click', () => { state.mapMode = 'geo'; renderCurrentMap(); });
  $('mapModePolar').addEventListener('click', () => { state.mapMode = 'polar'; renderCurrentMap(); });
  $('journeyFilter').addEventListener('change', () => {
    state.journeyFilter = $('journeyFilter').value; renderCurrentMap();
  });
  $('journeyToggle').addEventListener('change', () => {
    state.journeyVisible = $('journeyToggle').checked; renderCurrentMap();
  });
  $('mapZoomIn').addEventListener('click', () => {
    if (!SeoulMapHelper.changeZoom(-1)) SeoulCompassMap.zoom($('compass'), .8);
  });
  $('mapZoomOut').addEventListener('click', () => {
    if (!SeoulMapHelper.changeZoom(1)) SeoulCompassMap.zoom($('compass'), 1.25);
  });
  $('mapZoomReset').addEventListener('click', () => {
    if (!SeoulMapHelper.resetZoom()) SeoulCompassMap.zoom($('compass'), 0);
  });
  $('mapFocusRoute').addEventListener('click', () => {
    state.journeyFilter = 'all';
    state.journeyVisible = $('journeyToggle').checked = true;
    renderCurrentMap({preserveZoom:true, focusRoute:true});
  });
  $('radius').addEventListener('change', renderCurrentMap);
  ['lat', 'lng', 'locationName'].forEach(id => $(id).addEventListener('change', () => {
    state.locationFromQuestion = false; state.searchCenter = null; state.routeStart = null; state.locationError = null;
    state.originLocation = $('lat').value.trim() && $('lng').value.trim() ? {
      type:'custom', name:'사용자가 지정한 출발 위치', latitude:Number($('lat').value), longitude:Number($('lng').value)
    } : null;
    renderCurrentMap();
  }));
  $('sim3dBtn').addEventListener('click', () => {
    const on = document.body.classList.toggle('sim3d');
    $('sim3dBtn').classList.toggle('active', on);
    toast(on ? '3D 경로 시뮬레이션을 시작했습니다.' : '3D 시뮬레이션을 종료했습니다.');
  });
  document.querySelectorAll('.rail-nav button').forEach(btn => btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.rail-nav button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view-panel').forEach(p => { p.hidden = p.dataset.panel !== view; });
    $('insightTitle').textContent = { console:'시각화', planner:'플랜 분석', plan:'일정 · 경로', archive:'기록', settings:'설정' }[view];
  }));
  const savedTheme = localStorage.getItem('sc-theme') || 'light';
  document.body.dataset.theme = savedTheme;
  $('themeBtn').textContent = savedTheme === 'dark' ? '◐ 다크' : '☀ 라이트';
  $('themeBtn').addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next; localStorage.setItem('sc-theme', next);
    $('themeBtn').textContent = next === 'dark' ? '◐ 다크' : '☀ 라이트';
  });
  [['wM','swM'],['wD','swD'],['wQ','swQ'],['wV','swV']].forEach(([a,b]) => {
    $(a).addEventListener('input', () => { $(b).value = $(a).value; });
    $(b).addEventListener('input', () => { $(a).value = $(b).value; });
  });
  async function loadStatus() {
    try {
      const cfg = await request('/api/config');
      // 카카오 JavaScript 키는 허용 도메인 제한 하의 공개 키다.
      state.kakaoKey = cfg.kakao_javascript_key || null;
      renderCurrentMap();
      const h = await request('/api/health');
      $('apiStatus').innerHTML = `<span>서버 상태 <b>${esc(h.status)}</b></span>
        <span>샘플 장소 <b>${h.places}곳</b></span><span>포트 <b>${h.port}</b></span>
        <span>음성 인식 <b>${state.voice ? 'Web Speech API' : '미지원'}</b></span>
        <span>GPS <b>${navigator.geolocation ? '사용 가능' : '미지원'}</b></span>
        <span>지도 제공 <b>${state.kakaoKey ? '카카오맵' : 'SVG (폴백)'}</b></span>
        <span>문맥 분석 <b>${cfg.context_analysis ? '활성' : '미활성'}</b></span>
        <span>상권 업종 조회 <b>${cfg.merchant_lookup_configured ? '활성' : '키 미설정'}</b></span>
        <span>공개 메뉴 조회 <b>${cfg.verified_menu_lookup ? '활성' : '미활성'}</b></span>`;
    } catch (err) { $('apiStatus').innerHTML = `<span>서버 오류: ${esc(err.message)}</span>`; }
  }
  $('saveTripBtn').addEventListener('click', saveTrip);
  $('refreshTripsBtn').addEventListener('click', refreshTrips);

  // 화면 언어 전환 (전체 텍스트 자동 번역)
  $('uiLang').value = SeoulI18n.lang;
  SeoulI18n.apply();
  $('uiLang').addEventListener('change', () => {
    const lang = $('uiLang').value;
    SeoulI18n.setLang(lang);
    if (state.voice) state.voice.lang = ({ ko:'ko-KR', en:'en-US', ja:'ja-JP', zh:'zh-CN' })[lang] || 'ko-KR';
    toast('화면 언어가 변경되었습니다.');
  });

  // 실시간 시계만 표시하고, 입력값은 사용자가 넣을 때까지 비워둔다.
  function updateClock() {
    const n = new Date();
    $('liveClock').textContent = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')} ${n.toTimeString().slice(0,8)}`;
  }
  updateClock(); setInterval(updateClock, 1000);
  // 날씨는 5분마다 자동 갱신 ( analys 상태가 없으면 무시 )
  setInterval(() => { if (state.parsed) renderWeather(); }, 5 * 60 * 1000);

  initVoice();
  loadStatus();
  refreshTrips().catch(() => {});
  renderScrubber();
  renderChat();
  renderCurrentMap();
})();
