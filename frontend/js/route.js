/* 추천 경로와 선정 근거 렌더링 */
(function (global) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  // 알려진 출발지는 별도로 표시하고, 모든 방문점에 분석한 원래 요청 표현을 연결한다.
  function stopLabels(route, start, requestText) {
    start = route.start_location || start;
    const labels = route.nodes.map(node => {
      const term = node.request_term;
      return `${node.place.name}${term ? `(${term})` : ''}`;
    });
    const first = global.SeoulJourney.nodePoint(route.nodes[0]);
    if (!route.preview && start?.name && start.latitude != null && start.longitude != null && first
        && global.SeoulJourney.distance({lat:start.latitude,lng:start.longitude}, first) > 1) {
      const startName = start.name;
      const term = requestText?.toLowerCase().includes(startName.toLowerCase()) ? startName : '출발지';
      labels.unshift(`${startName}(${term})`);
    }
    return labels;
  }

  function render(container, routes, onSelect) {
    if (!container) return;
    if (!routes || !routes.length) {
      container.innerHTML = '<p>추천 경로가 없습니다. 질문에 장소 조건을 포함해 주세요.</p>';
      return;
    }
    const accents = global.SeoulJourney.ROUTE_COLORS;
    container.innerHTML = routes.map((r, i) => {
      const names = stopLabels(r).join(' → ');
      const conflict = r.schedule && r.schedule.conflicts && r.schedule.conflicts.length;
      return `<article class="route-card" data-index="${i}" style="--card-accent:${accents[i % accents.length]}">
        <h3><span class="rank">${i + 1}</span> ${r.preview ? '후보 동선' : r.verification_status === 'unverified' ? '검토용 일정' : `${esc(r.direction)} 방향 · ${r.score}점`}</h3>
        <p>${esc(names)}</p>
        <p>직선 연결 ${r.total_distance_km}km · ${r.preview ? '출발 구간 미포함' : `이동 추정 ${r.total_travel_minutes}분 · 비용 ${r.estimated_cost_krw == null ? '확인 필요' : r.estimated_cost_krw + '원'}`}</p>
        <p>${r.verification_status === 'unverified' ? '영업시간·산행 코스·실제 이동 경로 미검증' : `신뢰도 ${Math.round((r.data_confidence || 0) * 100)}%`} ${conflict ? '· 일정 충돌 있음' : ''}</p>
        <button type="button" class="ghost select-route">이 경로 선택</button>
      </article>`;
    }).join('');
    container.querySelectorAll('.select-route').forEach((btn) => {
      btn.addEventListener('click', () => onSelect(routes[Number(btn.parentElement.dataset.index)]));
    });
  }

  function recommendationList(routes, selected, regionIndex, start, requestText) {
    if (!routes.length) return '<p class="hint">표시할 추천 경로가 없습니다.</p>';
    const shortest = Math.min(...routes.map(r => Number(r.total_distance_km)));
    const quickest = Math.min(...routes.filter(r => r.total_travel_minutes != null).map(r => r.total_travel_minutes));
    const bestScore = Math.max(...routes.filter(r => r.score != null).map(r => r.score));
    return `<ol class="recommendation-list">${routes.map((r, i) => {
      const color = global.SeoulJourney.ROUTE_COLORS[i];
      const conflicts = r.schedule?.conflicts?.length || 0;
      const reasons = [
        `${Number(r.total_distance_km) === shortest ? '표시 경로 중 최단 직선 연결 ' : '직선 연결 '}${r.total_distance_km}km`
      ];
      if (r.preview) reasons.push('목적지 주변 활동 조합');
      else {
        reasons.push(`${r.total_travel_minutes === quickest ? '표시 경로 중 최소 ' : ''}이동 추정 ${r.total_travel_minutes}분`);
        reasons.push(conflicts ? `일정 충돌 ${conflicts}건` : '추정 일정에서 시간 충돌 없음');
      }
      if (r.score != null) reasons.push(`${r.score === bestScore ? '표시 경로 중 최고 ' : ''}종합 점수 ${r.score}점`);
      if (r.corridor) {
        const {heading, variant} = r.corridor;
        const side = {primary:'10° 구역', adjacent:'양옆 10° 구역 연결'}[variant];
        reasons.push(`기준 ${Math.round(heading) % 360}° · ${side}`);
      }
      const confirmed = r.nodes.filter(node => node.place.menu_status === 'matched');
      if (confirmed.length) reasons.push(`요청 메뉴 공개 정보 확인 ${confirmed.length}곳`);
      if (r.nodes.some(node => node.place.menu_status === 'unconfirmed')) reasons.push('요청 메뉴 확인 필요');
      if (r.nodes.some(node => node.place.venue_condition_unconfirmed)) reasons.push('장소의 세부 조건 확인 필요');
      const places = stopLabels(r, start, requestText).map(esc).join(' → ');
      return `<li style="--recommendation-color:${color}">
        <button type="button" class="select-recommendation" data-region="${regionIndex}" data-route="${i}" aria-pressed="${r === selected}">
          <strong>추천 ${i + 1}]</strong> <span>${reasons.map(esc).join(' · ')}</span>
          <small>${places}</small>
        </button></li>`;
    }).join('')}</ol>`;
  }

  function venuePhone(value) {
    const number = String(value || '').replace(/[\s().-]/g, '');
    return /^\+?\d{8,13}$/.test(number) ? ` · <a href="tel:${number}">${esc(value)}</a>` : '';
  }

  function operatingHours(place) {
    const hours = place.operating_hours;
    return [hours?.hours, hours?.holidays, hours?.source && `출처 ${hours.source}`].filter(Boolean).join(' · ')
      || place.hours || '영업시간 확인 필요';
  }

  function visitPlaceLink(place) {
    const name = esc(place.name);
    const color = place.visit_warning ? ' class="visit-warning"' : '';
    return /^https?:\/\//i.test(place.place_url || '')
      ? `<a${color} href="${esc(place.place_url)}" target="_blank" rel="noopener noreferrer">${name}</a>`
      : `<strong${color}>${name}</strong>`;
  }

  function visitWarning(warning) {
    if (!warning) return '';
    const source = esc(warning.source || '공식 안내');
    const link = /^https?:\/\//i.test(warning.source_url || '')
      ? ` · <a href="${esc(warning.source_url)}" target="_blank" rel="noopener noreferrer">${source}</a>`
      : warning.source ? ` · ${source}` : '';
    return `<span class="visit-warning visit-warning-detail">${esc(warning.reason)}${link}</span>`;
  }

  function referenceCourse(route, selected, regionIndex, start, routeIndex = 0) {
    if (!route) return '';
    const places = stopLabels(route, start);
    const offset = places.length - route.nodes.length;
    const stops = places.map((name, i) => route.nodes[i - offset]?.place.visit_warning
      ? `<strong class="visit-warning">${esc(name)}</strong>` : esc(name));
    const color = global.SeoulJourney.routeColor(route, routeIndex);
    const direction = Number.isFinite(route.reference_heading)
      ? ` · ${esc(route.reference_direction)} ${route.reference_heading}°` : '';
    return `<div class="reference-course" style="--reference-color:${color}">
      <button class="ghost select-reference" type="button" data-region="${regionIndex}" data-route="${routeIndex}" aria-pressed="${route === selected}">참고 ${routeIndex + 1}${direction}</button>
      <p>${stops.join(' → ')}</p>
      <p>${route.partial ? '확인된 구간까지 표시 · ' : ''}${route.preview ? '현재 위치 적용 후 출발·복귀 계산 · ' : ''}빨간 장소의 방문 조건을 확인해 주세요.</p>
    </div>`;
  }

  function venueDetails(route) {
    const venues = route?.nodes.map(node => node.place).filter(place =>
      !place.food_options?.length && (place.merchant || place.menu_status || place.phone || place.place_url)) || [];
    if (!venues.length) return '';
    return `<div class="market-food-options"><strong>선택 코스 장소 정보</strong><ul>${venues.map(place => {
      const title = visitPlaceLink(place);
      const menus = place.menus?.length ? ` · ${esc(place.menus.join(' / '))} (${esc(place.menu_source)})` : '';
      const check = ['unconfirmed', 'unavailable'].includes(place.menu_status) ? ' · 메뉴 확인 필요' : '';
      const industry = place.merchant?.industry ? ` · ${esc(place.merchant.industry)} (상권정보)` : '';
      return `<li>${title}${industry}${menus}${check}${venuePhone(place.phone)}</li>`;
    }).join('')}</ul></div>`;
  }

  function renderReport(container, data) {
    if (!container) return;
    if (!data) { container.innerHTML = '<p>리포트가 없습니다.</p>'; return; }
    const list = (title, items) => `<h3>${title}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>없음</li>'}</ul>`;
    container.innerHTML = `
      <p>${data.verification_status === 'unverified' ? '지역 후보의 검토용 일정 · 실제 방문 가능성 미검증' : `추천 방향: <b>${esc(data.recommended_direction)}</b> · 경로 점수 <b>${data.route_score}</b> · 관심사 충족 <b>${data.interest_satisfaction}%</b>`}</p>
      ${list('추천 이유', data.reasons || [])}
      ${list('주의사항', data.cautions || [])}
      ${list('대체 장소', data.alternatives || [])}
      <p>데이터 신뢰도: ${data.verification_status === 'unverified' ? '확인 필요' : Math.round((data.data_confidence || 0) * 100) + '%'}</p>`;
  }

  function renderEventNotice(container, parsed, error = '') {
    const events = parsed?.event_options || [];
    const officialLinks = parsed?.event_links || [];
    const needsConfirmation = !!parsed?.location_context?.needs_confirmation;
    container.hidden = !(events.length || officialLinks.length || error);
    if (container.hidden) {
      container.innerHTML = '';
      return;
    }
    const title = error ? '분석을 완료하지 못했습니다' : needsConfirmation ? '관람 일정을 확인해 주세요' : '경기·행사 일정';
    const safeLink = (url, label) => /^https:\/\//i.test(url || '')
      ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
    const eventRows = events.map(event => `<li><strong>${esc(event.date)} ${esc(event.start_time)}</strong> · ${esc(event.name)} · ${esc(event.venue)}${
      event.source_url ? ` · ${safeLink(event.source_url, event.source || '일정 출처')}` : ''}</li>`).join('');
    const linkRows = officialLinks.map(link => safeLink(link.url, link.label)).filter(Boolean).map(link => `<li>${link}</li>`).join('');
    const message = error || (needsConfirmation && parsed.location_context.error);
    container.innerHTML = `<h3>${title}</h3>${message ? `<p class="visit-warning">${esc(message)}</p>` : ''}${eventRows ? `<ul>${eventRows}</ul>` : ''}${
      needsConfirmation && eventRows ? '<p>원하는 날짜와 경기 또는 행사를 질문에 적고 다시 분석하세요.</p>' : ''}${
      linkRows ? `<ul>${linkRows}</ul>` : ''}`;
  }

  global.SeoulRouteView = {render, renderReport, recommendationList, renderEventNotice, venuePhone, venueDetails,
    operatingHours, visitPlaceLink, visitWarning, referenceCourse};
})(window);
