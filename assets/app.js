/* Seoul Compass AI 2026 — Visual Navigator 컨트롤러 (외부 라이브러리 없음) */
(function () {
  'use strict';

  const { SPOTS, CATEGORIES, I18N } = window.SeoulData;
  const V = window.SeoulViz;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const state = {
    lang: localStorage.getItem('sc-lang') || 'ko',
    theme: localStorage.getItem('sc-theme') || 'dark',
    category: 'all',
    query: '',
    indoorOnly: false,
    outdoorOnly: false,
    course: [],
    selected: null,
    timeWindow: null
  };

  const t = (key) => (I18N[state.lang] && I18N[state.lang][key]) || I18N.ko[key] || key;
  const nameOf = (s) => (state.lang === 'en' ? s.nameEn : s.name);
  const descOf = (s) => (state.lang === 'en' ? s.descEn : s.desc);
  const districtOf = (s) => (state.lang === 'en' ? s.districtEn : s.district);
  const catOf = (key) => {
    const c = CATEGORIES.find((x) => x.key === key) || CATEGORIES[0];
    return state.lang === 'en' ? c.en : c.ko;
  };

  function seasonWeather() {
    const m = new Date().getMonth() + 1;
    if (m >= 6 && m <= 8) return { label: '☀ 29°', temp: 29 };
    if ([4, 5, 9, 10].includes(m)) return { label: '🌤 21°', temp: 21 };
    if (m === 11 || m === 12) return { label: '☁ 8°', temp: 8 };
    return { label: '❄ 0°', temp: 0 };
  }
  const weather = seasonWeather();

  /* ---------- 자연어 의도/시간 파싱 (규칙 기반) ---------- */
  function parseTimeWindow(q) {
    const range = q.match(/(\d{1,2})\s*시?\s*(?:부터|~|\-|–|에서)\s*(?:오[전후]|am|pm)?\s*(\d{1,2})\s*시?\s*까지?/)
      || q.match(/(\d{1,2})\s*(?::(\d{2}))?\s*(?:~|\-|–)\s*(\d{1,2})(?::(\d{2}))?/);
    if (!range) return null;
    let start = Number(range[1]);
    let end = Number(range[3] || range[2]);
    const pm = /오후|pm/.test(q), am = /오전|am/.test(q);
    if (pm && start < 12) start += 12;
    if (pm && end < 12) end += 12;
    if (am && start === 12) start = 0;
    if (am && end === 12) end = 0;
    if (end <= start) end += 12;
    if (start > 24 || end > 24) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return { start: start * 60, end: end * 60, label: `${pad(start)}:00–${pad(end)}:00` };
  }

  function detectIntent(text) {
    const q = String(text || '').toLowerCase();
    return {
      q,
      shopping: /쇼핑|백화점|면세|shopping|shops?/.test(q),
      food: /맛집|먹|음식|식당|음료|food|cafe|카페/.test(q),
      night: /야경|전망|night|view/.test(q),
      heritage: /한옥|궁|역사|palace|heritage/.test(q),
      nature: /자연|공원|산책|nature|park|hiking/.test(q),
      indoor: /비\b|우천|실내|rain|indoor|재조정|replan/.test(q),
      course: /코스|추천|짜줘|plan|recommend|course|itinerary|하고\s?싶어|원해|want/.test(q),
      time: parseTimeWindow(q)
    };
  }

  function categoryHint(q) {
    const i = detectIntent(q);
    if (i.shopping) return 'shopping';
    if (i.food) return 'food';
    if (i.night) return 'night';
    if (i.heritage) return 'heritage';
    if (i.nature) return 'nature';
    return null;
  }

  function renderWeather() {
    $('#weatherChip').textContent = weather.label;
    $('#weatherChip').title = state.lang === 'en' ? 'Seasonal estimate (demo)' : '계절 기반 추정(데모)';
  }

  function applyI18n() {
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $('#langBtn').textContent = state.lang === 'ko' ? 'KO' : 'EN';
    document.documentElement.lang = state.lang === 'ko' ? 'ko' : 'en';
    renderWeather();
    renderFilters();
    renderAll();
  }

  /* ---------- 필터 / 카드 ---------- */
  function renderFilters() {
    $('#filters').innerHTML = CATEGORIES.map((c) => {
      const label = state.lang === 'en' ? c.en : c.ko;
      return `<button type="button" class="filter-btn${c.key === state.category ? ' active' : ''}" data-category="${c.key}">${esc(c.emoji)} ${esc(label)}</button>`;
    }).join('');
    $$('#filters button').forEach((btn) => btn.addEventListener('click', () => {
      state.category = btn.dataset.category;
      renderFilters();
      renderAll();
    }));
  }

  function getFiltered() {
    const q = state.query.trim().toLowerCase();
    const hint = q ? categoryHint(q) : null;
    return SPOTS.filter((s) => {
      if (state.category !== 'all' && s.category !== state.category) return false;
      if (state.indoorOnly && !s.indoor) return false;
      if (state.outdoorOnly && s.indoor) return false;
      if (!q) return true;
      if (hint) {
        const koLabel = (CATEGORIES.find((c) => c.key === hint) || {}).ko || '';
        return s.category === hint || s.tags.some((tag) =>
          tag.toLowerCase() === hint || tag === koLabel || (hint === 'shopping' && /쇼핑/i.test(tag)));
      }
      const hay = [s.name, s.nameEn, s.desc, s.descEn, districtOf(s), catOf(s.category), ...s.tags]
        .join(' ').toLowerCase();
      if (hay.includes(q)) return true;
      // 문장 입력 대비: 의미 있는 어절 하나라도 일치하면 통과
      return q.split(/\s+/).some((word) => word.length > 1 && hay.includes(word));
    });
  }

  function spotCard(spot) {
    const added = state.course.includes(spot.id);
    return `<article class="spot-card${state.selected === spot.id ? ' selected' : ''}" data-id="${esc(spot.id)}" tabindex="0">
      <div class="spot-thumb cat-${esc(spot.category)}"><span aria-hidden="true">${esc(spot.emoji)}</span></div>
      <div class="spot-info">
        <div class="spot-title-row"><h3>${esc(nameOf(spot))}</h3><span class="rating">★ ${spot.rating.toFixed(1)}</span></div>
        <p class="spot-sub">${esc(districtOf(spot))} · ${esc(descOf(spot))}</p>
        <div class="tag-row">${spot.tags.slice(0, 3).map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}</div>
        <div class="card-actions">
          <button class="btn outline small" type="button" data-action="add" data-id="${esc(spot.id)}">${esc(t(added ? 'card.added' : 'card.add'))}</button>
          <button class="link-btn" type="button" data-action="detail" data-id="${esc(spot.id)}">${esc(t('card.detail'))} →</button>
        </div>
      </div>
    </article>`;
  }

  function renderSpots() {
    const list = getFiltered();
    $('#resultCount').textContent = state.lang === 'en' ? `${list.length} PLACES` : `${list.length}곳`;
    $('#statSpots').textContent = SPOTS.length;
    $('#statAreas').textContent = new Set(SPOTS.map((s) => s.district)).size;
    $('#metricBars').innerHTML = CATEGORIES.filter((c) => c.key !== 'all').map((c) => {
      const n = SPOTS.filter((s) => s.category === c.key).length;
      return `<i style="height:${Math.max(18, n * 9)}px;background:${V.COLORS[c.key]}" title="${esc(c.key)} ${n}"></i>`;
    }).join('');
    $('#spotList').innerHTML = list.length
      ? list.map(spotCard).join('')
      : `<div class="empty-state"><h3>${esc(t('empty.title'))}</h3><p>${esc(t('empty.desc'))}</p></div>`;
    $$('#spotList [data-action="add"]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleCourse(b.dataset.id); }));
    $$('#spotList [data-action="detail"]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const spot = SPOTS.find((s) => s.id === b.dataset.id);
      if (spot) { selectSpot(spot); openModal(spot); }
    }));
    $$('#spotList .spot-card').forEach((card) => card.addEventListener('click', () => {
      const spot = SPOTS.find((s) => s.id === card.dataset.id);
      if (spot) { selectSpot(spot); openModal(spot); }
    }));
  }

  /* ---------- 컴패스(극좌표) 지도 ---------- */
  function selectSpot(spot) {
    state.selected = spot.id;
    renderSpots();
    renderMap();
    renderViz();
  }

  function renderMap() {
    const list = getFiltered();
    const selected = SPOTS.find((s) => s.id === state.selected);
    V.compassGrid($('#compassGrid'));
    V.needle($('#needleLayer'), selected);

    const courseSpots = state.course.map((id) => SPOTS.find((s) => s.id === id)).filter(Boolean);
    const routePts = courseSpots.map((s) => V.polar(s));
    $('#routeLayer').innerHTML = routePts.length > 1
      ? `<polyline class="route-path" points="${routePts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" />`
        + routePts.map((p, i) => `<circle class="route-node" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" />
            <text class="route-label" x="${p.x.toFixed(1)}" y="${(p.y + 3).toFixed(1)}">${i + 1}</text>`).join('')
      : '';

    $('#mapMarkers').innerHTML = list.map((s) => {
      const p = V.polar(s);
      const color = V.COLORS[s.category];
      return `<g class="marker${state.selected === s.id ? ' selected' : ''}" data-id="${esc(s.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" role="button" tabindex="0" aria-label="${esc(nameOf(s))}">
        <circle class="halo" r="${state.selected === s.id ? 14 : 10}" />
        <circle class="dot" r="${state.selected === s.id ? 6.5 : 4.5}" style="fill:${color}" />
        <text x="9" y="-8">${esc(nameOf(s))}</text></g>`;
    }).join('');
    $$('#mapMarkers .marker').forEach((m) => {
      const open = () => {
        const spot = SPOTS.find((s) => s.id === m.dataset.id);
        if (spot) { selectSpot(spot); openModal(spot); }
      };
      m.addEventListener('click', open);
      m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });

    const callout = $('#mapCallout');
    if (selected) {
      const p = V.polar(selected);
      callout.hidden = false;
      callout.innerHTML = `<strong>${esc(nameOf(selected))}</strong>
        <span>${esc(catOf(selected.category))} · ${Math.round(p.deg)}° · ${p.km.toFixed(1)} km</span>`;
      $('#bearingValue').textContent = `${Math.round(p.deg)}°`;
      $('#distanceValue').textContent = `${p.km.toFixed(1)} km`;
    } else {
      callout.hidden = true;
      $('#bearingValue').textContent = '—';
      $('#distanceValue').textContent = '—';
    }
    $('#routeReadout').textContent = courseSpots.length;
  }

  /* ---------- 시각화 ---------- */
  function renderViz() {
    const selected = SPOTS.find((s) => s.id === state.selected);
    V.donut($('#catDonut'), getFiltered(), CATEGORIES, state.lang);
    V.radar($('#radarChart'), selected, state.lang);
    V.spark($('#tempSpark'), V.weeklyTemps());
    V.heat($('#heatGrid'), selected, state.lang);
    $('#vizSpotName').textContent = selected ? nameOf(selected) : t('viz.profile');
  }

  function renderAll() {
    renderSpots();
    renderMap();
    renderCourse();
    renderViz();
  }

  /* ---------- 코스 ---------- */
  function haversine(a, b) { return V.distanceKm(a, b); }

  function courseStats() {
    const spots = state.course.map((id) => SPOTS.find((s) => s.id === id)).filter(Boolean);
    let km = 0;
    for (let i = 1; i < spots.length; i++) km += haversine(spots[i - 1], spots[i]);
    return { spots, km, mins: spots.length * 60 + Math.round(km * 12) };
  }

  function renderCourse() {
    const { spots, km, mins } = courseStats();
    const list = $('#courseList');
    if (!spots.length) {
      list.innerHTML = `<li class="empty">${esc(t('course.empty'))}</li>`;
      $('#courseSummary').hidden = true;
      return;
    }
    list.innerHTML = spots.map((s, i) => `<li><span class="course-num">${i + 1}</span><span class="course-name">${esc(nameOf(s))}</span>
      <button class="remove-btn" type="button" data-remove="${esc(s.id)}" aria-label="삭제">×</button></li>`).join('');
    $$('#courseList [data-remove]').forEach((b) => b.addEventListener('click', () => toggleCourse(b.dataset.remove)));
    const sum = $('#courseSummary');
    sum.hidden = false;
    const windowMins = state.timeWindow ? state.timeWindow.end - state.timeWindow.start : null;
    const shownMins = windowMins || mins;
    sum.innerHTML = `<div><span>${esc(t('course.summary'))}</span><strong>${Math.floor(shownMins / 60)}h ${shownMins % 60}m</strong></div>
      <div><span>${esc(t('course.walk'))}</span><strong>${km.toFixed(1)} km</strong></div>
      ${state.timeWindow ? `<div><span>${state.lang === 'en' ? 'Window' : '희망 시간'}</span><strong>${state.timeWindow.label}</strong></div>` : ''}`;
  }

  function toggleCourse(id) {
    const i = state.course.indexOf(id);
    if (i >= 0) state.course.splice(i, 1);
    else {
      if (state.course.length >= 8) { pushChat('bot', state.lang === 'en' ? 'Up to 8 places.' : '코스는 최대 8곳까지 담을 수 있어요.'); return; }
      state.course.push(id);
    }
    renderSpots();
    renderMap();
    renderCourse();
  }

  function nearestOrder(seed, spots) {
    const rest = spots.slice(), out = [];
    let cur = seed;
    while (rest.length) {
      rest.sort((a, b) => haversine(cur, a) - haversine(cur, b));
      cur = rest.shift();
      out.push(cur);
    }
    return out;
  }

  function recommendCourse(preference) {
    const text = preference || state.query || '';
    const intent = detectIntent(text);
    let pool = SPOTS.slice();
    if (intent.indoor) pool = pool.filter((s) => s.indoor);
    else if (intent.shopping) pool = pool.filter((s) => s.category === 'shopping' || s.tags.some((tag) => /쇼핑|shopping/i.test(tag)));
    else if (intent.night) pool = pool.filter((s) => s.category === 'night');
    else if (intent.food) pool = pool.filter((s) => s.category === 'food');
    else if (intent.heritage) pool = pool.filter((s) => s.category === 'heritage');
    else if (intent.nature) pool = pool.filter((s) => s.category === 'nature');
    pool.sort((a, b) => b.rating - a.rating);
    let picked = pool.slice(0, 5);
    if (intent.time) {
      const slots = Math.max(1, Math.floor((intent.time.end - intent.time.start) / 60));
      picked = picked.slice(0, Math.min(picked.length, slots));
    }
    if (!picked.length) picked = [SPOTS[0]];
    state.course = nearestOrder(V.CENTER, picked).map((s) => s.id);
    state.timeWindow = intent.time;
    state.category = 'all';
    state.indoorOnly = false;
    state.outdoorOnly = false;
    $('#indoorToggle').checked = false;
    $('#outdoorToggle').checked = false;
    renderFilters();
    renderAll();
    $('#course').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return courseStats();
  }

  /* ---------- 모달 ---------- */
  function openModal(spot) {
    const added = state.course.includes(spot.id);
    $('#modalBody').innerHTML = `
      <div class="modal-hero cat-${esc(spot.category)}"><span aria-hidden="true">${esc(spot.emoji)}</span></div>
      <div class="modal-content">
        <p class="eyebrow"><span class="eyebrow-line"></span>${esc(catOf(spot.category))} · ${esc(districtOf(spot))}</p>
        <h2 id="modalTitle">${esc(nameOf(spot))}<small>${esc(spot.nameEn)}</small></h2>
        <p class="modal-desc">${esc(descOf(spot))}</p>
        <div class="modal-meta">
          <div><b>${state.lang === 'en' ? 'HOURS' : '운영시간'}</b><p>${esc(spot.hours)}</p></div>
          <div><b>${state.lang === 'en' ? 'TRANSIT' : '교통'}</b><p>${esc(spot.transit)}</p></div>
          <div><b>${state.lang === 'en' ? 'POLAR' : '방위·거리'}</b><p>${Math.round(V.bearing(spot))}° · ${V.distanceKm(V.CENTER, spot).toFixed(1)} km</p></div>
        </div>
        <p class="modal-tip">💡 ${esc(state.lang === 'en' ? spot.tipEn : spot.tip)}</p>
        <div class="tag-row">${spot.tags.map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}</div>
        <button class="btn primary full" type="button" id="modalAdd">${esc(t(added ? 'card.added' : 'modal.add'))}</button>
      </div>`;
    $('#modal').hidden = false;
    $('#modalAdd').addEventListener('click', () => {
      if (!state.course.includes(spot.id)) toggleCourse(spot.id);
      $('#modalAdd').textContent = t('card.added');
      $('#modalAdd').classList.add('added');
    });
  }

  function closeModal() { $('#modal').hidden = true; }

  /* ---------- AI 가이드 ---------- */
  let chatHistory = [];
  function pushChat(role, text) { chatHistory.push({ role, text }); renderChat(); }
  function renderChat() {
    const messages = chatHistory.length ? chatHistory : [{ role: 'bot', text: t('chat.welcome') }];
    $('#chatLog').innerHTML = messages.map((m) => `<div class="chat-row ${m.role}"><div class="avatar">${m.role === 'bot' ? '✦' : '🙂'}</div><div class="bubble">${esc(m.text)}</div></div>`).join('');
    $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
  }
  const spotLine = (s) => `• ${nameOf(s)} (${catOf(s.category)})`;

  function answer(message) {
    const en = state.lang === 'en';
    const intent = detectIntent(message);
    const q = intent.q;
    const pad = (n) => String(n).padStart(2, '0');
    const fmtTime = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

    if (/도움말|help/.test(q)) return en
      ? 'Try: shopping 2-4pm / course / rain indoor / night / food / weather'
      : '이렇게 물어보세요: 오후2시부터4시까지 쇼핑 / 코스 짜줘 / 비 와! 실내로 / 야경 / 날씨';

    if (intent.indoor && !intent.shopping) {
      const st = recommendCourse(message);
      const when = intent.time ? `${intent.time.label} · ` : '';
      return en ? `Indoor course ${when}: ${st.spots.map((s) => s.nameEn).join(' → ')}. ${Math.floor(st.mins / 60)}h${st.mins % 60}m.`
                : `비 오는 날 코스를 재조정했어요. ${when}${st.spots.map((s) => s.name).join(' → ')}. 예상 ${Math.floor(st.mins / 60)}시간 ${st.mins % 60}분.`;
    }

    if (intent.shopping || (intent.course && categoryHint(q))) {
      const st = recommendCourse(message);
      const names = st.spots.map((s) => en ? s.nameEn : s.name);
      if (intent.time) {
        const step = Math.max(60, Math.floor((intent.time.end - intent.time.start) / Math.max(1, st.spots.length)));
        const schedule = st.spots.map((s, i) => `${fmtTime(intent.time.start + i * step)} ${en ? s.nameEn : s.name}`).join(' → ');
        return en
          ? `Shopping plan for ${intent.time.label}: ${schedule}. Distance ${st.km.toFixed(1)} km. Check actual opening hours before you go.`
          : `${intent.time.label} 쇼핑 코스를 만들었어요: ${schedule}. 총 이동 ${st.km.toFixed(1)}km. 방문 전 영업시간을 확인해 주세요.`;
      }
      return en ? `Shopping course: ${names.join(' → ')}. ${st.km.toFixed(1)} km.`
                : `쇼핑 코스를 만들었어요: ${names.join(' → ')}. 총 이동 ${st.km.toFixed(1)}km.`;
    }

    if (intent.time && intent.course) {
      const st = recommendCourse(message);
      return en ? `Course for ${intent.time.label}: ${st.spots.map((s) => s.nameEn).join(' → ')}.`
                : `${intent.time.label}에 맞춘 코스: ${st.spots.map((s) => s.name).join(' → ')}.`;
    }

    if (/코스|추천|짜줘|plan|recommend|course|itinerary/.test(q)) {
      const st = recommendCourse(message);
      return en ? `Course ready: ${st.spots.map((s) => s.nameEn).join(' → ')}. ${st.km.toFixed(1)} km, ${Math.floor(st.mins / 60)}h${st.mins % 60}m.`
                : `코스를 만들었어요: ${st.spots.map((s) => s.name).join(' → ')}. 도보 ${st.km.toFixed(1)}km, ${Math.floor(st.mins / 60)}시간 ${st.mins % 60}분.`;
    }
    if (intent.night) return (en ? 'Night views: ' : '야경 명소: ') + SPOTS.filter((s) => s.category === 'night').map(spotLine).join('  ');
    if (intent.food) return (en ? 'Food: ' : '맛집·카페: ') + SPOTS.filter((s) => s.category === 'food').slice(0, 6).map(spotLine).join('  ');
    if (intent.heritage) return (en ? 'Palaces: ' : '궁궐·한옥: ') + SPOTS.filter((s) => s.category === 'heritage').map(spotLine).join('  ');
    if (intent.nature) return (en ? 'Nature: ' : '자연·공원: ') + SPOTS.filter((s) => s.category === 'nature').map(spotLine).join('  ');
    if (/지하철|교통|subway/.test(q)) {
      const s = courseStats().spots[0] || SPOTS[0];
      return en ? `${s.nameEn}: ${s.transit}` : `${s.name} 주변 교통: ${s.transit}`;
    }
    if (/날씨|기온|weather/.test(q)) return en ? `Demo estimate: ${weather.label}. Check official forecasts for real weather.` : `데모 추정 날씨는 ${weather.label}입니다. 정확한 예보는 기상청을 확인해 주세요.`;
    const hint = categoryHint(q);
    const found = hint ? SPOTS.filter((s) => s.category === hint).slice(0, 4)
      : SPOTS.filter((s) => [s.name, s.nameEn, s.desc, s.descEn, ...s.tags].join(' ').toLowerCase().includes(q)).slice(0, 4);
    return found.length ? (en ? 'Found: ' : '찾은 명소: ') + found.map(spotLine).join('  ') : (en ? 'Try “help”.' : '“도움말”을 입력해 보세요.');
  }

  function sendChat(text) {
    const msg = (text || $('#chatInput').value).trim();
    if (!msg) return;
    $('#chatInput').value = '';
    pushChat('user', msg);
    pushChat('bot', answer(msg));
  }

  /* ---------- 이벤트 ---------- */
  function bindEvents() {
    $('#searchBtn').addEventListener('click', () => {
      state.query = $('#searchInput').value;
      renderAll();
      $('#console').scrollIntoView({ behavior: 'smooth' });
    });
    $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#searchBtn').click(); });
    $$('#quickChips button').forEach((b) => b.addEventListener('click', () => { $('#searchInput').value = b.dataset.query; $('#searchBtn').click(); }));
    $('#indoorToggle').addEventListener('change', (e) => {
      state.indoorOnly = e.target.checked;
      if (state.indoorOnly) { state.outdoorOnly = false; $('#outdoorToggle').checked = false; }
      renderAll();
    });
    $('#outdoorToggle').addEventListener('change', (e) => {
      state.outdoorOnly = e.target.checked;
      if (state.outdoorOnly) { state.indoorOnly = false; $('#indoorToggle').checked = false; }
      renderAll();
    });
    $('#clearCourse').addEventListener('click', () => { state.course = []; renderAll(); });
    $('#recommendBtn').addEventListener('click', () => {
      const st = recommendCourse(state.query);
      pushChat('bot', state.lang === 'en' ? `Recommended ${st.spots.length} places.` : `${st.spots.length}곳을 추천했습니다.`);
    });
    $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
    $$('#chatSuggestions button').forEach((b) => b.addEventListener('click', () => sendChat(b.dataset.message)));
    $('#weatherChip').addEventListener('click', () => sendChat(state.lang === 'en' ? 'weather' : '날씨 알려줘'));
    $('#langBtn').addEventListener('click', () => {
      state.lang = state.lang === 'ko' ? 'en' : 'ko';
      localStorage.setItem('sc-lang', state.lang);
      applyI18n();
    });
    $('#themeBtn').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = state.theme;
      localStorage.setItem('sc-theme', state.theme);
      $('#themeBtn').textContent = state.theme === 'dark' ? '◐' : '☀';
    });
    $$('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  }

  document.body.dataset.theme = state.theme;
  $('#themeBtn').textContent = state.theme === 'dark' ? '◐' : '☀';
  state.selected = SPOTS.slice().sort((a, b) => b.rating - a.rating)[0].id;
  bindEvents();
  applyI18n();
  renderChat();
})();
