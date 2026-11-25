/* 관측 데스크 컨트롤러: API 호출, 지도, 시각화, GPS, 음성입력, 타임라인 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  const state = {
    parsed: null, routes: [], selectedRoute: null, startDate: null, tripId: null,
    mapMode: 'geo', gps: { used: false, source: null, accuracy: null },
    watchId: null, scrubTimer: null, voice: null, listening: false
  };
  let lastPlaces = [], lastScores = [];
  let reportCache = {};

  async function post(path, body) {
    const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path} 오류: ${res.status}`);
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
  function renderCurrentMap() {
    const payload = {
      start: { latitude: Number($('lat').value), longitude: Number($('lng').value) },
      radius_km: Number($('radius').value) || 5,
      places: lastPlaces, scores: lastScores, route: state.selectedRoute
    };
    if (state.mapMode === 'geo') SeoulCompassMap.renderGeo($('compass'), payload);
    else SeoulCompassMap.render($('compass'), payload);
    $('mapModeGeo').classList.toggle('active', state.mapMode === 'geo');
    $('mapModePolar').classList.toggle('active', state.mapMode === 'polar');
    const name = $('locationName').value || '서울 시청';
    $('mapCaption').textContent = `${name} 기준 · 360도 스캔${state.gps.used ? ' · GPS' : ''}`;
  }

  /* ---------- 일정표 ---------- */
  function renderSchedule() {
    SeoulScheduleView.render($('scheduleTable').querySelector('tbody'), $('conflicts'),
      state.selectedRoute && state.selectedRoute.schedule, {
        onSelect: (index) => {
          if (!state.selectedRoute || !state.parsed) return;
          const node = state.selectedRoute.nodes[index];
          SeoulScheduleView.renderDetail($('scheduleDetail'), {
            activity: state.parsed.activities[index], place: node.place, node, candidates: lastPlaces
          }, { onPlaceChange: (place) => {
            node.place = place; node.distance_km = place.distance_km;
            node.travel_minutes = place.distance_km ? Math.max(1, Math.round(place.distance_km / 5 * 60)) : 0;
            revalidate(); renderCurrentMap(); toast(`장소를 ${place.name}(으)로 변경했습니다.`);
          }});
        },
        onTimeChange: (index, value) => {
          if (!state.parsed || !state.parsed.activities[index]) return;
          state.parsed.activities[index].start_time = value;
          state.parsed.activities[index].fixed_time = true;
          revalidate(); toast('시간을 수정하고 일정을 다시 검증했습니다.');
        }
      });
    renderScrubber();
  }

  async function revalidate() {
    if (!state.selectedRoute) return;
    try {
      const result = await post('/api/schedule/validate', {
        activities: state.parsed.activities, route: state.selectedRoute });
      state.selectedRoute.schedule = result;
      renderSchedule();
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
  function renderCharts(places, scores) {
    const conflicts = (state.selectedRoute && state.selectedRoute.schedule
      && state.selectedRoute.schedule.conflicts
      && state.selectedRoute.schedule.conflicts.length) || 0;
    SeoulCharts.kpis($('kpiGrid'), { places, routes: state.routes, conflicts, scores });
    SeoulCharts.donut($('categoryDonut'), places);
    SeoulCharts.orbit($('directionOrbit'), scores);
    SeoulCharts.rose($('directionRose'), scores);
    SeoulCharts.bars($('scoreBars'), scores);
    $('directionScores').innerHTML = Object.entries(scores).sort((a,b)=>b[1]-a[1])
      .map(([n,v]) => `<span>${esc(n)} ${v}점</span>`).join('');
    SeoulCharts.routeRadar($('routeRadar'), state.routes);
    SeoulCharts.flowRibbon($('flowRibbon'), state.selectedRoute);
    SeoulCharts.routeProfile($('routeProfile'), state.selectedRoute);
    SeoulCharts.horizon($('crowdHorizon'), state.selectedRoute);
    SeoulCharts.heat($('crowdHeat'), state.selectedRoute);
    SeoulCharts.timelineRibbon($('timelineRibbon'), state.selectedRoute && state.selectedRoute.schedule);
    const routeScores = {}; state.routes.forEach((r,i)=>{ routeScores[`${i+1}위`] = r.score; });
    SeoulCharts.bars($('routeQuality'), routeScores);
    SeoulCharts.gauge($('scoreGauge'), state.selectedRoute && state.selectedRoute.score);
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
      cautions: ['직선거리 기반 추정입니다. 실제 경로는 확인이 필요합니다.'], alternatives: []
    };
    return reportCache[key];
  }

  /* ---------- 분석 ---------- */
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
    try {
      state.parsed = await post('/api/parse', { text: cfg.text });
      state.startDate = cfg.date || state.parsed.travel_date;
      $('parseWarnings').textContent = (state.parsed.warnings || []).join(' ');
      const activities = state.parsed.activities;
      const interests = [];
      activities.forEach(a => { (a.keywords || []).forEach(k => interests.push(k)); if (a.keyword) interests.push(a.keyword); });
      const startLocation = { type: state.gps.used ? 'current_location' : state.parsed.start_location.type,
        latitude: cfg.lat, longitude: cfg.lng };
      const direction = await post('/api/directions/analyze', {
        latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius,
        weights: cfg.weights, interests });
      const search = await post('/api/places/search', {
        latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius, limit: 30 });
      const result = await post('/api/routes/recommend', {
        start_location: startLocation, activities, radius_km: cfg.radius,
        transport_modes: cfg.modes, weights: cfg.weights });
      state.routes = result.routes || [];
      state.selectedRoute = state.routes[0] || null;
      lastPlaces = search.places; lastScores = direction.scores;
      renderCurrentMap(); renderSchedule(); renderCharts(search.places, direction.scores);
      SeoulRouteView.render($('routeList'), state.routes, (route) => {
        state.selectedRoute = route;
        $('scheduleDetail').hidden = true;
        renderSchedule(); renderCharts(lastPlaces, lastScores);
        SeoulRouteView.renderReport($('reportBody'), reportFor(route));
        toast('경로를 선택했습니다.');
      });
      SeoulRouteView.renderReport($('reportBody'), reportFor(state.selectedRoute));
      toast(`경로 ${state.routes.length}개를 추천했습니다.`);
    } catch (err) { toast(err.message || '분석 중 오류가 발생했습니다.'); }
  }

  /* ---------- GPS ---------- */
  function applyPosition(pos, fromWatch) {
    $('lat').value = Number(pos.latitude).toFixed(4);
    $('lng').value = Number(pos.longitude).toFixed(4);
    state.gps = { used: true, source: pos.source, accuracy: pos.accuracy };
    $('locationName').value = pos.city ? `${pos.city} (현재 위치)` : '현재 위치';
    const accuracy = pos.accuracy ? ` · 오차 약 ${pos.accuracy}m` : '';
    setGpsStatus(`${pos.source === 'gps' ? 'GPS' : 'IP 추정'} 위치 ${Number(pos.latitude).toFixed(4)}, ${Number(pos.longitude).toFixed(4)}${accuracy}`, pos.source === 'gps' ? 'ok' : 'warn');
    renderCurrentMap();
    if (!fromWatch) toast('현재 위치를 출발지로 적용했습니다.');
  }

  $('geoBtn').addEventListener('click', () => {
    SeoulMapHelper.useCurrentLocation(
      pos => applyPosition(pos, false),
      msg => { setGpsStatus(msg, 'warn'); toast(msg); },
      (text, kind) => setGpsStatus(text, kind)
    );
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
    const svg = $('compass').querySelector('svg'); if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 600;
    const y = ((e.clientY - rect.top) / rect.height) * 600;
    const cfg = inputs();
    const p = SeoulMapHelper.screenToLatLng(x, y, 600, cfg.lat, cfg.lng, cfg.radius);
    applyPosition(p, false);
    toast('지도에서 출발지를 선택했습니다.');
  });

  /* ---------- 음성 입력 ---------- */
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('micBtn').disabled = true; $('micBtn').title = '이 브라우저는 음성 인식을 지원하지 않습니다.'; return; }
    const rec = new SR();
    rec.lang = $('voiceLang').value || 'ko-KR';
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
  $('voiceLang').addEventListener('change', () => { if (state.voice) state.voice.lang = $('voiceLang').value; });
  $('micBtn').addEventListener('click', () => {
    if (!state.voice) { toast('음성 인식을 지원하지 않는 브라우저입니다.'); return; }
    if (state.listening) { state.voice.stop(); return; }
    state.listening = true;
    $('micBtn').textContent = '🔴 듣는 중';
    try { state.voice.start(); } catch (e) { toast('음성 인식을 시작할 수 없습니다.'); state.listening = false; }
  });

  /* ---------- 여행 기록 ---------- */
  async function saveTrip() {
    if (!state.parsed || !state.routes.length) { toast('먼저 분석을 실행해 주세요.'); return; }
    const cfg = inputs();
    const payload = {
      date: state.startDate || new Date().toISOString().slice(0,10), user_id: 'local_user',
      start_location: { type: state.gps.used ? 'current_location' : 'custom',
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
  $('mapModeGeo').addEventListener('click', () => { state.mapMode = 'geo'; renderCurrentMap(); });
  $('mapModePolar').addEventListener('click', () => { state.mapMode = 'polar'; renderCurrentMap(); });
  document.querySelectorAll('.rail-nav button').forEach(btn => btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.rail-nav button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view-panel').forEach(p => { p.hidden = p.dataset.panel !== view; });
    $('insightTitle').textContent = { console:'시각화', plan:'일정 · 경로', archive:'기록', settings:'설정' }[view];
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
      const h = await request('/api/health');
      $('apiStatus').innerHTML = `<span>서버 상태 <b>${esc(h.status)}</b></span>
        <span>샘플 장소 <b>${h.places}곳</b></span><span>포트 <b>${h.port}</b></span>
        <span>음성 인식 <b>${state.voice ? 'Web Speech API' : '미지원'}</b></span>
        <span>GPS <b>${navigator.geolocation ? '사용 가능' : '미지원'}</b></span>
        <span>외부 API <b>미연동 (추정 경로)</b></span>`;
    } catch (err) { $('apiStatus').innerHTML = `<span>서버 오류: ${esc(err.message)}</span>`; }
  }
  $('saveTripBtn').addEventListener('click', saveTrip);
  $('refreshTripsBtn').addEventListener('click', refreshTrips);

  initVoice();
  loadStatus();
  refreshTrips().catch(() => {});
  renderScrubber();
})();
