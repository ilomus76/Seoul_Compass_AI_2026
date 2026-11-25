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
    density: null, transport: null, alarms: [], chat: [], weather: null
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
      places: lastPlaces, scores: lastScores, route: state.selectedRoute, routes: state.routes
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

  /* ---------- 전문가용 플랜 패널 ---------- */
  function renderParsedPlan() {
    const box = $('parsedPlan');
    const p = state.parsed;
    if (!p) { box.innerHTML = '<p class="hint">분석 후 구조화 결과가 표시됩니다.</p>'; return; }
    const item = (label, value) => `<div><b>${esc(label)}</b><span>${esc(value || '-')}</span></div>`;
    box.innerHTML = `<div class="detail-grid">
      ${item('날짜', p.travel_date || '미지정')}
      ${item('시간', (p.activities || []).map(a => a.start_time || a.preferred_time || a.earliest_start).filter(Boolean).join(' · '))}
      ${item('장소', (p.activities || []).map(a => a.location || a.keyword).filter(Boolean).join(' · '))}
      ${item('목적', (p.purpose || []).join(' · '))}
      ${item('특이사항', (p.special_notes || []).join(' · '))}
      ${item('신뢰도', (p.warnings || []).length ? '확인 필요' : '높음')}
    </div>`;
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
    try {
      const w = await request(`/api/weather?latitude=${cfg.lat}&longitude=${cfg.lng}${cfg.date ? '&date='+cfg.date : ''}`);
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
      renderParsedPlan();
      try {
        const densityData = await post('/api/density/analyze', {
          latitude: cfg.lat, longitude: cfg.lng, radius_km: cfg.radius, activities });
        renderDensity(densityData);
      } catch (err) { $('densityList').textContent = err.message; }
      await renderWeather();
      renderAlarms();
      await renderSafety();
      await analyzeTransport(null);
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

  // 화면 언어 전환 (전체 텍스트 자동 번역)
  $('uiLang').value = SeoulI18n.lang;
  SeoulI18n.apply();
  $('uiLang').addEventListener('change', () => {
    SeoulI18n.setLang($('uiLang').value);
    toast('화면 언어가 변경되었습니다.');
  });

  initVoice();
  loadStatus();
  refreshTrips().catch(() => {});
  renderScrubber();
  renderChat();
})();
