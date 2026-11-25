/* Seoul Compass AI 2026 — 프론트엔드 컨트롤러 (외부 라이브러리 없음) */
(function () {
  'use strict';

  const { SPOTS, CATEGORIES, I18N } = window.SeoulData;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const savedLang = localStorage.getItem('sc-lang') || 'ko';
  const savedTheme = localStorage.getItem('sc-theme') || 'dark';
  const state = {
    lang: savedLang,
    theme: savedTheme,
    category: 'all',
    query: '',
    indoorOnly: false,
    course: [],
    selected: null
  };

  const t = (key) => (I18N[state.lang] && I18N[state.lang][key]) || I18N.ko[key] || key;
  const nameOf = (spot) => (state.lang === 'en' ? spot.nameEn : spot.name);
  const descOf = (spot) => (state.lang === 'en' ? spot.descEn : spot.desc);
  const districtOf = (spot) => (state.lang === 'en' ? spot.districtEn : spot.district);
  const catOf = (key) => {
    const c = CATEGORIES.find((x) => x.key === key) || CATEGORIES[0];
    return state.lang === 'en' ? c.en : c.ko;
  };

  /* ---------- 날씨(계절 추정) ---------- */
  function seasonWeather() {
    const m = new Date().getMonth() + 1;
    if (m >= 6 && m <= 8) return { label: '☀ 맑음 · 29°', key: 'clear', temp: 29, rainy: false };
    if (m === 4 || m === 5 || m === 9 || m === 10) return { label: '🌤 맑음 · 21°', key: 'clear', temp: 21, rainy: false };
    if (m === 11 || m === 12) return { label: '☁ 흐림 · 8°', key: 'cloud', temp: 8, rainy: false };
    return { label: '❄ 눈 · 0°', key: 'cloud', temp: 0, rainy: true };
  }
  let weather = seasonWeather();

  function renderWeather() {
    $('#weatherChip').textContent = weather.label;
    $('#weatherChip').title = state.lang === 'en'
      ? 'Seasonal estimate (demo) — click to ask the guide'
      : '계절 기반 추정값(데모) · 누르면 가이드에게 질문합니다';
  }

  /* ---------- 다국어 ---------- */
  function applyI18n() {
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $('#langBtn').textContent = state.lang === 'ko' ? 'KO' : 'EN';
    document.documentElement.lang = state.lang === 'ko' ? 'ko' : 'en';
    renderWeather();
    renderFilters();
    renderSpots();
    renderCourse();
    renderChat();
  }

  /* ---------- 필터 / 카드 ---------- */
  function renderFilters() {
    $('#filters').innerHTML = CATEGORIES.map((c) => {
      const label = state.lang === 'en' ? c.en : c.ko;
      const active = c.key === state.category ? ' active' : '';
      return `<button type="button" class="filter-btn${active}" data-category="${c.key}">${esc(c.emoji)} ${esc(label)}</button>`;
    }).join('');
    $$('#filters button').forEach((btn) => btn.addEventListener('click', () => {
      state.category = btn.dataset.category;
      renderFilters();
      renderSpots();
      renderMap();
    }));
  }

  function getFiltered() {
    const q = state.query.trim().toLowerCase();
    return SPOTS.filter((s) => {
      if (state.category !== 'all' && s.category !== state.category) return false;
      if (state.indoorOnly && !s.indoor) return false;
      if (!q) return true;
      const hay = [s.name, s.nameEn, s.desc, s.descEn, districtOf(s), catOf(s.category), ...s.tags]
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function spotCard(spot) {
    const added = state.course.includes(spot.id);
    return `
      <article class="spot-card" data-id="${esc(spot.id)}" tabindex="0">
        <div class="spot-thumb cat-${esc(spot.category)}"><span aria-hidden="true">${esc(spot.emoji)}</span><span class="thumb-cat">${esc(catOf(spot.category))}</span></div>
        <div class="spot-info">
          <div class="spot-title-row"><h3>${esc(nameOf(spot))}</h3><span class="rating">★ ${spot.rating.toFixed(1)}</span></div>
          <p class="spot-sub">${esc(districtOf(spot))} · ${esc(descOf(spot))}</p>
          <div class="tag-row">${spot.tags.slice(0, 3).map((tag) => `<span class="tag">#${esc(tag)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn small ${added ? 'added' : 'outline'}" type="button" data-action="add" data-id="${esc(spot.id)}">${esc(t(added ? 'card.added' : 'card.add'))}</button>
            <button class="link-btn" type="button" data-action="detail" data-id="${esc(spot.id)}">${esc(t('card.detail'))} →</button>
          </div>
        </div>
      </article>`;
  }

  function renderSpots() {
    const list = getFiltered();
    $('#resultCount').textContent = state.lang === 'en'
      ? `${list.length} places found`
      : `${list.length}곳의 명소`;
    $('#statSpots').textContent = SPOTS.length;
    $('#statAreas').textContent = new Set(SPOTS.map((s) => s.district)).size;
    $('#spotList').innerHTML = list.length
      ? list.map(spotCard).join('')
      : `<div class="empty-state"><h3>${esc(t('empty.title'))}</h3><p>${esc(t('empty.desc'))}</p></div>`;
    $$('#spotList [data-action="add"]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCourse(b.dataset.id);
    }));
    $$('#spotList [data-action="detail"]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const spot = SPOTS.find((s) => s.id === b.dataset.id);
      if (spot) openModal(spot);
    }));
    $$('#spotList .spot-card').forEach((card) => {
      card.addEventListener('click', () => {
        const spot = SPOTS.find((s) => s.id === card.dataset.id);
        if (spot) openModal(spot);
      });
    });
  }

  /* ---------- 지도 ---------- */
  function project(lat, lng) {
    const x = 24 + ((lng - 126.86) / (127.15 - 126.86)) * 352;
    const y = 276 - ((lat - 37.42) / (37.68 - 37.42)) * 252;
    return { x: Math.max(18, Math.min(382, x)), y: Math.max(18, Math.min(282, y)) };
  }

  function renderMap() {
    const list = getFiltered();
    $('#mapMarkers').innerHTML = list.map((s) => {
      const p = project(s.lat, s.lng);
      const active = state.selected === s.id;
      return `<g class="marker${active ? ' active' : ''}" data-id="${esc(s.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" role="button" tabindex="0" aria-label="${esc(nameOf(s))}">
        <circle class="marker-halo" r="${active ? 12 : 9}" /><circle class="marker-dot" r="${active ? 6 : 4.5}" />
        <text x="9" y="-8">${esc(nameOf(s))}</text></g>`;
    }).join('');
    $$('#mapMarkers .marker').forEach((m) => {
      const open = () => {
        const spot = SPOTS.find((s) => s.id === m.dataset.id);
        if (spot) openModal(spot);
      };
      m.addEventListener('click', open);
      m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  /* ---------- 코스 ---------- */
  function haversine(a, b) {
    const R = 6371, rad = (d) => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function courseStats() {
    const spots = state.course.map((id) => SPOTS.find((s) => s.id === id)).filter(Boolean);
    let km = 0;
    for (let i = 1; i < spots.length; i++) km += haversine(spots[i - 1], spots[i]);
    const mins = spots.length * 60 + Math.round(km * 12);
    return { spots, km, mins };
  }

  function renderCourse() {
    const { spots, km, mins } = courseStats();
    const list = $('#courseList');
    if (!spots.length) {
      list.innerHTML = `<li class="empty">${esc(t('course.empty'))}</li>`;
      $('#courseSummary').hidden = true;
      return;
    }
    list.innerHTML = spots.map((s, i) => `<li><span class="course-num">${i + 1}</span><span class="course-name">${esc(nameOf(s))}</span><button class="remove-btn" type="button" data-remove="${esc(s.id)}" aria-label="삭제">×</button></li>`).join('');
    $$('#courseList [data-remove]').forEach((b) => b.addEventListener('click', () => toggleCourse(b.dataset.remove)));
    const sum = $('#courseSummary');
    sum.hidden = false;
    sum.innerHTML = `<div><span>${esc(t('course.summary'))}</span><strong>${mins >= 60 ? Math.floor(mins / 60) + 'h ' : ''}${mins % 60}m</strong></div>
      <div><span>${esc(t('course.walk'))}</span><strong>${km.toFixed(1)} km</strong></div>`;
  }

  function toggleCourse(id) {
    const i = state.course.indexOf(id);
    if (i >= 0) state.course.splice(i, 1);
    else {
      if (state.course.length >= 8) {
        pushChat('bot', state.lang === 'en' ? 'A course can hold up to 8 places.' : '코스는 최대 8곳까지 담을 수 있어요.');
        return;
      }
      state.course.push(id);
    }
    renderSpots();
    renderCourse();
    renderMap();
  }

  function nearestOrder(seed, spots) {
    const remaining = spots.slice();
    const ordered = [];
    let cur = seed;
    while (remaining.length) {
      remaining.sort((a, b) => haversine(cur, a) - haversine(cur, b));
      cur = remaining.shift();
      ordered.push(cur);
    }
    return ordered;
  }

  function recommendCourse(preference) {
    let pool = SPOTS.slice();
    const pref = (preference || state.query || '').toLowerCase();
    if (/비|우천|rain|실내|indoor|replan|재조정/.test(pref)) pool = pool.filter((s) => s.indoor);
    else if (/야경|전망|night|view/.test(pref)) pool = pool.filter((s) => s.category === 'night');
    else if (/맛집|먹|음식|food|카페|cafe/.test(pref)) pool = pool.filter((s) => s.category === 'food');
    else if (/한옥|궁|역사|palace|hanok|history/.test(pref)) pool = pool.filter((s) => s.category === 'heritage');
    else if (/자연|공원|산|nature|park|hiking/.test(pref)) pool = pool.filter((s) => s.category === 'nature');

    pool.sort((a, b) => b.rating - a.rating);
    const picked = pool.slice(0, 5);
    if (!picked.length) picked.push(SPOTS[0]);
    const seed = { lat: 37.5665, lng: 126.9780 };
    state.course = nearestOrder(seed, picked).map((s) => s.id);
    state.category = 'all';
    state.indoorOnly = false;
    $('#indoorToggle').checked = false;
    renderFilters();
    renderSpots();
    renderCourse();
    renderMap();
    $('#course').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return courseStats();
  }

  /* ---------- 모달 ---------- */
  function openModal(spot) {
    state.selected = spot.id;
    renderMap();
    const added = state.course.includes(spot.id);
    $('#modalBody').innerHTML = `
      <div class="modal-hero cat-${esc(spot.category)}"><span aria-hidden="true">${esc(spot.emoji)}</span></div>
      <div class="modal-content">
        <p class="eyebrow">${esc(catOf(spot.category))} · ${esc(districtOf(spot))}</p>
        <h2 id="modalTitle">${esc(nameOf(spot))} <small>${esc(spot.nameEn)}</small></h2>
        <p class="modal-desc">${esc(descOf(spot))}</p>
        <div class="modal-meta">
          <div><span>🕒</span><b>${esc(t('course.summary')) === 'Estimated time' ? 'Hours' : '운영시간'}</b><p>${esc(spot.hours)}</p></div>
          <div><span>🚇</span><b>${state.lang === 'en' ? 'Transit' : '교통'}</b><p>${esc(spot.transit)}</p></div>
          <div><span>⭐</span><b>${state.lang === 'en' ? 'Rating' : '평점'}</b><p>${spot.rating.toFixed(1)} / 5.0</p></div>
        </div>
        <p class="modal-tip">💡 ${esc(state.lang === 'en' ? spot.tipEn : spot.tip)}</p>
        <div class="tag-row">${spot.tags.map((tag) => `<span class="tag">#${esc(tag)}</span>`).join('')}</div>
        <button class="btn primary full" type="button" id="modalAdd">${esc(t(added ? 'card.added' : 'modal.add'))}</button>
      </div>`;
    $('#modal').hidden = false;
    $('#modalAdd').addEventListener('click', () => {
      toggleCourse(spot.id);
      $('#modalAdd').textContent = t('card.added');
      $('#modalAdd').classList.add('added');
    });
  }

  function closeModal() {
    $('#modal').hidden = true;
    state.selected = null;
    renderMap();
  }

  /* ---------- 챗 ---------- */
  let chatHistory = [];

  function pushChat(role, text) {
    chatHistory.push({ role, text });
    renderChat();
  }

  function renderChat() {
    const log = $('#chatLog');
    const messages = chatHistory.length ? chatHistory : [{ role: 'bot', text: t('chat.welcome') }];
    log.innerHTML = messages.map((m) => `<div class="chat-row ${m.role}"><div class="avatar">${m.role === 'bot' ? '✦' : '🙂'}</div><div class="bubble">${esc(m.text)}</div></div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  function spotLine(s) { return `• ${nameOf(s)} (${catOf(s.category)})`; }

  function answer(message) {
    const q = message.toLowerCase();
    const en = state.lang === 'en';
    if (/도움말|help|도와줘/.test(q)) return en ? chatHistoryHelpEn() : chatHistoryHelpKo();
    if (/비|우천|rain|실내|indoor|재조정|replan/.test(q)) {
      const stats = recommendCourse('실내');
      return en
        ? `Rainy-day plan ready: ${stats.spots.map((s) => s.nameEn).join(' → ')}. Estimated ${Math.round(stats.mins / 60)}h${stats.mins % 60}m. I kept the mood and moved everything indoors.`
        : `비 오는 날 코스로 재조정했어요: ${stats.spots.map((s) => s.name).join(' → ')}. 예상 ${Math.floor(stats.mins / 60)}시간 ${stats.mins % 60}분. 실내 명소만 골랐습니다.`;
    }
    if (/코스|추천|짜줘|plan|recommend|course|itinerary/.test(q)) {
      const stats = recommendCourse(message);
      return en
        ? `Here’s your course: ${stats.spots.map((s) => s.nameEn).join(' → ')}. Total walking ${stats.km.toFixed(1)} km, about ${Math.floor(stats.mins / 60)}h${stats.mins % 60}m.`
        : `취향을 반영한 코스를 만들었어요: ${stats.spots.map((s) => s.name).join(' → ')}. 도보 ${stats.km.toFixed(1)}km, 예상 ${Math.floor(stats.mins / 60)}시간 ${stats.mins % 60}분입니다.`;
    }
    if (/야경|전망|night|view/.test(q)) {
      const list = SPOTS.filter((s) => s.category === 'night');
      return (en ? 'Night views: ' : '야경 명소를 추천합니다: ') + list.map(spotLine).join('  ');
    }
    if (/맛집|먹|음식|food|카페|cafe/.test(q)) {
      const list = SPOTS.filter((s) => s.category === 'food').slice(0, 6);
      return (en ? 'Food & cafés: ' : '맛집과 카페: ') + list.map(spotLine).join('  ');
    }
    if (/한옥|궁|역사|palace|hanok|history/.test(q)) {
      const list = SPOTS.filter((s) => s.category === 'heritage');
      return (en ? 'Palaces & hanok: ' : '궁궐과 한옥: ') + list.map(spotLine).join('  ');
    }
    if (/지하철|교통|subway|station/.test(q)) {
      const first = courseStats().spots[0] || SPOTS[0];
      return en ? `Nearest transit for ${first.nameEn}: ${first.transit}.` : `${first.name} 주변 교통: ${first.transit}`;
    }
    if (/날씨|기온|weather|temperature/.test(q)) {
      return en
        ? `Demo seasonal estimate: ${weather.label}. For real forecasts, check the Korea Meteorological Administration.`
        : `데모 계절 추정 날씨는 ${weather.label}입니다. 정확한 예보는 기상청 공식 정보를 확인해 주세요.`;
    }
    const found = SPOTS.filter((s) => [s.name, s.nameEn, s.desc, s.descEn, ...s.tags].join(' ').toLowerCase().includes(q)).slice(0, 4);
    if (found.length) return (en ? 'I found these places: ' : '이런 명소를 찾았어요: ') + found.map(spotLine).join('  ');
    return en ? 'Sorry, I did not catch that. Type “help” to see what I can do.' : '잘 모르겠어요. “도움말”을 입력하면 할 수 있는 일을 알려드릴게요.';
  }

  function chatHistoryHelpKo() { return '이렇게 물어보세요: 코스 짜줘 / 비 와! 실내로 재조정 / 야경 명소 / 맛집 / 한옥 / 지하철 / 날씨 / 도움말'; }
  function chatHistoryHelpEn() { return 'Try: plan a course / raining, indoor plan / night views / food / hanok / subway / weather / help'; }

  function sendChat(text) {
    const msg = (text || $('#chatInput').value).trim();
    if (!msg) return;
    $('#chatInput').value = '';
    pushChat('user', msg);
    pushChat('bot', answer(msg));
  }

  /* ---------- 이벤트 바인딩 ---------- */
  function bindEvents() {
    $('#searchBtn').addEventListener('click', () => {
      state.query = $('#searchInput').value;
      renderSpots();
      renderMap();
      $('#explore').scrollIntoView({ behavior: 'smooth' });
    });
    $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#searchBtn').click(); });
    $$('#quickChips button').forEach((b) => b.addEventListener('click', () => {
      $('#searchInput').value = b.dataset.query;
      $('#searchBtn').click();
    }));
    $('#indoorToggle').addEventListener('change', (e) => {
      state.indoorOnly = e.target.checked;
      renderSpots();
      renderMap();
    });
    $('#clearCourse').addEventListener('click', () => {
      state.course = [];
      renderCourse();
      renderSpots();
      renderMap();
    });
    $('#recommendBtn').addEventListener('click', () => {
      const stats = recommendCourse(state.query);
      pushChat('bot', state.lang === 'en'
        ? `Recommended ${stats.spots.length} places in a compact route.`
        : `평점과 거리를 고려해 ${stats.spots.length}곳을 추천했습니다.`);
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
  bindEvents();
  applyI18n();
  renderMap();
})();
