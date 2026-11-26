/* 같은 탭의 최근 분석에서 추가 코스와 공개 장소를 보여준다. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  function add(parent, tag, text) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function load() {
    try { return JSON.parse(sessionStorage.getItem('seoul-compass-additional-courses')); }
    catch { return null; }
  }

  $('backToPlan').addEventListener('click', event => {
    if (document.referrer === new URL('/', location.origin).href) {
      event.preventDefault();
      history.back();
    }
  });
  const data = load();
  const routes = data?.routes || [];
  const places = data?.places || [];
  $('emptyState').hidden = !!(routes.length || places.length);
  $('otherRoutes').hidden = !routes.length;
  $('otherPlaces').hidden = !places.length;

  for (const route of routes) {
    const heading = route.corridor?.heading;
    const mode = route.corridor?.variant === 'adjacent' ? '양옆 10° 구역 연결' : '10° 구역';
    const card = add($('additionalRoutes'), 'article');
    card.className = 'route-card';
    add(card, 'h3', `추천 ${route.rank} · ${heading}° ${mode}`);
    const travel = route.minutes == null ? '출발 위치 적용 필요' : `이동 추정 ${route.minutes}분`;
    add(card, 'p', `직선 연결 ${route.distance}km · ${travel}`);
    const stops = add(card, 'ol');
    for (const stop of route.stops) {
      add(stops, 'li', [stop.time, stop.name, stop.term && `(${stop.term})`].filter(Boolean).join(' '));
    }
  }
  for (const group of places) {
    const card = add($('additionalPlaces'), 'article');
    card.className = 'route-card';
    add(card, 'h3', group.label);
    const entries = add(card, 'ul');
    for (const place of group.items) {
      const item = add(entries, 'li');
      if (/^https?:\/\//i.test(place.url || '')) {
        const link = add(item, 'a', place.name);
        link.href = place.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        add(item, 'span', place.name);
      }
      if (place.industry) add(item, 'small', ` · ${place.industry}`);
    }
  }
})();
