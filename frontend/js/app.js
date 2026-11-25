/* 화면 컨트롤러: API 호출과 화면 렌더링을 연결한다. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    parsed: null,
    routes: [],
    selectedRoute: null,
    startDate: null,
    tripId: null,
    mapMode: 'geo'
  };
  let lastPlaces = [], lastScores = [];
  let lastDirection = null;

  // 지도/컴패스 전환을 포함한 지도 렌더링
  function renderCurrentMap() {
    const payload = {
      start: { latitude: Number($('lat').value), longitude: Number($('lng').value) },
      radius_km: Number($('radius').value),
      places: lastPlaces,
      scores: lastScores,
      route: state.selectedRoute
    };
    if (state.mapMode === 'geo') SeoulCompassMap.renderGeo($('compass'), payload);
    else SeoulCompassMap.render($('compass'), payload);
    $('mapModeGeo').classList.toggle('active', state.mapMode === 'geo');
    $('mapModePolar').classList.toggle('active', state.mapMode === 'polar');
  }

  // 일정표와 상세 패널을 함께 갱신한다.
  function renderSchedule() {
    SeoulScheduleView.render($('scheduleTable').querySelector('tbody'), $('conflicts'),
      state.selectedRoute && state.selectedRoute.schedule, {
        onSelect: (index) => {
          if (!state.selectedRoute || !state.parsed) return;
          const node = state.selectedRoute.nodes[index];
          SeoulScheduleView.renderDetail($('scheduleDetail'), {
            activity: state.parsed.activities[index],
            place: node.place,
            node,
            candidates: lastPlaces
          }, {
            onPlaceChange: (place) => {
              node.place = place;
              node.distance_km = place.distance_km;
              node.travel_minutes = place.distance_km ? Math.max(1, Math.round(place.distance_km / 5 * 60)) : 0;
              revalidate();
              renderCurrentMap();
              toast(`장소를 ${place.name}(으)로 변경했습니다.`);
            }
          });
        },
        onTimeChange: (index, value) => {
          if (!state.parsed || !state.parsed.activities[index]) return;
          state.parsed.activities[index].start_time = value;
          state.parsed.activities[index].fixed_time = true;
          revalidate();
          toast('시간을 수정하고 일정을 다시 검증했습니다.');
        }
      });
  }

  // 서버에 일정 충돌을 다시 검증하고 화면을 갱신한다.
  async function revalidate() {
    if (!state.selectedRoute) return;
    try {
      const result = await post('/api/schedule/validate', {
        activities: state.parsed.activities, route: state.selectedRoute
      });
      state.selectedRoute.schedule = result;
      renderSchedule();
      SeoulRouteView.renderReport($('reportBody'), awaitReport(state.selectedRoute));
      renderCharts(lastPlaces, lastScores);
    } catch (err) {
      toast(err.message || '일정 검증에 실패했습니다.');
    }
  }

  function renderCharts(places, scores) {
    const conflicts = (state.selectedRoute && state.selectedRoute.schedule
      && state.selectedRoute.schedule.conflicts
      && state.selectedRoute.schedule.conflicts.length) || 0;
    SeoulCharts.kpis($('kpiGrid'), { places, routes: state.routes, conflicts, scores });
    SeoulCharts.donut($('categoryDonut'), places);
    SeoulCharts.bars($('scoreBars'), scores);
    SeoulCharts.heat($('crowdHeat'), state.selectedRoute);
    const routeScores = {};
    state.routes.forEach((r, i) => { routeScores[`${i + 1}위`] = r.score; });
    SeoulCharts.bars($('routeQuality'), routeScores);
    SeoulCharts.rose($('directionRose'), scores);
    SeoulCharts.routeProfile($('routeProfile'), state.selectedRoute);
    SeoulCharts.timelineRibbon($('timelineRibbon'), state.selectedRoute && state.selectedRoute.schedule);
    SeoulCharts.gauge($('scoreGauge'), state.selectedRoute && state.selectedRoute.score);
  }

  async function post(path, body) {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${path} 오류: ${res.status}`);
    return res.json();
  }

  async function request(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} 오류: ${res.status}`);
    return res.json();
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    // 3초 후 자동 숨김 (테스트용으로 짧게 유지)
    setTimeout(() => { el.hidden = true; }, 3000);
  }

  function inputs() {
    return {
      text: $('question').value.trim(),
      lat: Number($('lat').value) || 37.5665,
      lng: Number($('lng').value) || 126.9780,
      radius: Number($('radius').value) || 5,
      date: $('date').value || null,
      modes: Array.from(document.querySelectorAll('.mode:checked')).map((x) => x.value),
      weights: {
        M: Number($('wM').value), D: Number($('wD').value),
        Q: Number($('wQ').value), V: Number($('wV').value)
      }
    };
  }

  async function analyze() {
    const cfg = inputs();
    if (!cfg.text) { toast('질문을 입력해 주세요.'); return; }
    try {
      state.parsed = await post('/api/parse', { text: cfg.text });
      state.startDate = cfg.date || state.parsed.travel_date;
      $('parseWarnings').textContent = (state.parsed.warnings || []).join(' ');

      const activities = state.parsed.activities;
      const interests = [];
      activities.forEach((a) => {
        (a.keywords || []).forEach((k) => interests.push(k));
        if (a.keyword) interests.push(a.keyword);
      });

      const startLocation = {
        type: state.parsed.start_location.type,
        latitude: cfg.lat, longitude: cfg.lng
      };

      const direction = await post('/api/directions/analyze', {
        latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius,
        weights: cfg.weights, interests
      });
      const search = await post('/api/places/search', {
        latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius, limit: 30
      });
      const result = await post('/api/routes/recommend', {
        start_location: startLocation, activities, radius_km: cfg.radius,
        transport_modes: cfg.modes, weights: cfg.weights
      });

      state.routes = result.routes || [];
      state.selectedRoute = state.routes[0] || null;
      lastPlaces = search.places;
      lastScores = direction.scores;

      renderCurrentMap();
      $('directionScores').innerHTML = Object.entries(direction.scores)
        .sort((a, b) => b[1] - a[1])
        .map(([name, score]) => `<span>${name} ${score}점</span>`).join('');

      renderSchedule();
      renderCharts(search.places, direction.scores);
      SeoulRouteView.render($('routeList'), state.routes, (route) => {
        state.selectedRoute = route;
        $('scheduleDetail').hidden = true;
        renderSchedule();
        renderCharts(lastPlaces, lastScores);
        const report = awaitReport(route);
        SeoulRouteView.renderReport($('reportBody'), report);
        toast('경로를 선택했습니다.');
      });
      SeoulRouteView.renderReport($('reportBody'), awaitReport(state.selectedRoute));
      toast(`경로 ${state.routes.length}개를 추천했습니다.`);
    } catch (err) {
      toast(err.message || '분석 중 오류가 발생했습니다.');
    }
  }

  // 선택 즉시 리포트를 갱신하기 위한 동기 래퍼 (서버 호출은 analyze에서 미리 수행)
  let reportCache = new Map();
  function awaitReport(route) {
    if (!route) return null;
    const key = route.score + '-' + route.nodes.map((n) => n.place.id).join(',');
    if (!reportCache.has(key)) {
      // 분석 단계에서 미리 만든 리포트가 있으면 사용, 없으면 기본 정보
      reportCache.set(key, route.report || {
        recommended_direction: route.direction, route_score: route.score,
        interest_satisfaction: route.score, places: route.nodes.map((n) => n.place.name),
        timeline: (route.schedule || {}).timeline || [],
        total_travel_minutes: route.total_travel_minutes,
        total_activity_minutes: 0,
        estimated_transport_cost_krw: null,
        estimated_facility_cost_krw: route.estimated_cost_krw,
        reasons: [], conflicts: (route.schedule || {}).conflicts || [],
        data_confidence: route.data_confidence,
        cautions: ['직선거리 기반 추정입니다. 실제 경로는 확인이 필요합니다.'],
        alternatives: []
      });
    }
    return reportCache.get(key);
  }

  async function saveTrip() {
    if (!state.parsed || !state.routes.length) { toast('먼저 분석을 실행해 주세요.'); return; }
    const cfg = inputs();
    const payload = {
      date: state.startDate || new Date().toISOString().slice(0, 10),
      user_id: 'local_user',
      start_location: { type: 'custom', latitude: cfg.lat, longitude: cfg.lng, name: $('locationName').value },
      activities: state.parsed.activities,
      routes: state.routes
    };
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
        $('question').value = (trip.activities || []).map((a) => a.keyword || a.category).join(' ');
        const start = trip.start_location || {};
        if (start.latitude) $('lat').value = start.latitude;
        if (start.longitude) $('lng').value = start.longitude;
        state.tripId = trip.trip_id;
        toast('이전 일정을 불러왔습니다. 분석을 다시 눌러 주세요.');
      },
      onView: async (tripId) => {
        const places = state.selectedRoute ? state.selectedRoute.nodes.map((n) => n.place.name) : [];
        const showVisits = async () => {
          const data = await request(`/api/trips/${tripId}/visits`);
          SeoulHistoryView.renderVisits($('visitPanel'), tripId, data.visits, {
            places,
            onAdd: async (visit) => {
              await post(`/api/trips/${tripId}/visits`, visit);
              toast('방문 기록을 추가했습니다.');
              await showVisits();
            },
            onRemove: async (visitId) => {
              await fetch(`/api/trips/${tripId}/visits/${visitId}`, { method: 'DELETE' });
              toast('방문 기록을 삭제했습니다.');
              await showVisits();
            }
          });
        };
        await showVisits();
        $('visitPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      onVisit: async (tripId) => {
        const places = state.selectedRoute ? state.selectedRoute.nodes.map((n) => n.place.name) : [];
        if (!places.length) { toast('선택된 경로가 없습니다.'); return; }
        for (const name of places) {
          await post(`/api/trips/${tripId}/visits`, {
            place_name: name, status: 'visited', actual_start: new Date().toTimeString().slice(0, 5)
          });
        }
        toast('방문 기록을 저장했습니다.');
        await refreshTrips();
      },
      onDelete: async (tripId) => {
        await fetch(`/api/trips/${tripId}`, { method: 'DELETE' });
        toast('일정을 삭제했습니다.');
        await refreshTrips();
      }
    });
  }

  $('analyzeBtn').addEventListener('click', analyze);
  $('geoBtn').addEventListener('click', () => SeoulMapHelper.useCurrentLocation(
    (lat, lng) => { $('lat').value = lat.toFixed(4); $('lng').value = lng.toFixed(4); toast('현재 위치를 적용했습니다.'); },
    (msg) => toast(msg)
  ));
  $('compass').addEventListener('click', (e) => {
    const svg = $('compass').querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 600;
    const y = ((e.clientY - rect.top) / rect.height) * 600;
    const cfg = inputs();
    const p = SeoulMapHelper.screenToLatLng(x, y, 600, cfg.lat, cfg.lng, cfg.radius);
    $('lat').value = p.latitude.toFixed(4);
    $('lng').value = p.longitude.toFixed(4);
    toast('출발지를 지도에서 선택했습니다. 다시 분석해 주세요.');
  });
  $('saveTripBtn').addEventListener('click', saveTrip);
  $('refreshTripsBtn').addEventListener('click', refreshTrips);

  // 지도 / 컴패스 보기 전환
  $('mapModeGeo').addEventListener('click', () => { state.mapMode = 'geo'; renderCurrentMap(); });
  $('mapModePolar').addEventListener('click', () => { state.mapMode = 'polar'; renderCurrentMap(); });

  // 테마 전환 (라이트/다크)
  const savedTheme = localStorage.getItem('sc-theme') || 'light';
  document.body.dataset.theme = savedTheme;
  $('themeBtn').textContent = savedTheme === 'dark' ? '◐ 다크' : '☀ 라이트';
  $('themeBtn').addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    localStorage.setItem('sc-theme', next);
    $('themeBtn').textContent = next === 'dark' ? '◐ 다크' : '☀ 라이트';
  });

  // 상단 탭: 우측 결과 영역을 전환한다.
  document.querySelectorAll('.view-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.body.dataset.view = view;
      document.querySelectorAll('.view-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view-panel').forEach((p) => { p.hidden = p.dataset.panel !== view; });
    });
  });

  // 입력 화면과 설정 화면의 가중치 slider 연동
  const weightPairs = [['wM','swM'], ['wD','swD'], ['wQ','swQ'], ['wV','swV']];
  weightPairs.forEach(([a, b]) => {
    $(a).addEventListener('input', () => { $(b).value = $(a).value; });
    $(b).addEventListener('input', () => { $(a).value = $(b).value; });
  });

  // 연동 상태 표시 (외부 API 키가 없으면 샘플 데이터 모드)
  async function loadStatus() {
    try {
      const health = await request('/api/health');
      $('apiStatus').innerHTML = `
        <span>서버 상태 <b>${esc(health.status)}</b></span>
        <span>샘플 장소 <b>${health.places}곳</b></span>
        <span>포트 <b>${health.port}</b></span>
        <span>외부 지도/경로 API <b>미연동 (추정 경로)</b></span>
        <span>데이터 출처 <b>예시 JSON</b></span>`;
    } catch (err) {
      $('apiStatus').innerHTML = `<span>서버 상태 <b>오류: ${esc(err.message)}</b></span>`;
    }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }
  loadStatus();
  refreshTrips().catch(() => {});
})();
