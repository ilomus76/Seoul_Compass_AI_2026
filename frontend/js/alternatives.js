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
  const directions = data?.directions || [];
  $('emptyState').hidden = !!(routes.length || places.length || directions.length);
  $('directionReview').hidden = !directions.length;
  $('otherRoutes').hidden = !routes.length;
  $('otherPlaces').hidden = !places.length;

  const compass = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  function directionReason(row, review) {
    switch (row.status) {
      case 'selected': return '해당 방향의 상위 경로로 선정됐습니다.';
      case 'rank_limit': return row.factor ? `${row.factor} 비교에서 상위 5개보다 순위가 낮았습니다.`
        : '경로는 구성됐으며 전체 비교에서 상위 5개 밖이었습니다.';
      case 'missing_clusters': {
        const activity = row.missing?.join(', ') || review.activity;
        return activity ? `이 방향에서 ‘${activity}’에 맞는 후보 군집을 찾지 못했습니다.`
          : '이 방향의 검색 결과에서 일정에 연결할 후보 군집을 찾지 못했습니다.';
      }
      case 'schedule': return '후보를 찾았으나 방문 시각과 체류·이동 조건을 함께 만족하는 경로를 확인하지 못했습니다.';
      case 'goal_direction': return '지정한 최종 목적지가 이 방향의 비교 범위에서 벗어납니다.';
      case 'duplicate_route': return '다른 방향과 방문 순서가 겹치거나 같은 방향의 다른 코스가 먼저 선정됐습니다.';
      case 'duplicate_cluster': return '같은 장소 군집이 이미 다른 방향에 포함됐습니다.';
      case 'no_combination': return '후보 군집은 조회됐으나 비교할 참고 동선을 확보하지 못했습니다.';
      case 'not_requested': return '요청에서 지정한 방향의 검색 범위 밖입니다.';
      default: return '선정 이유를 확인하지 못했습니다.';
    }
  }

  async function walkingDistance(button, result, leg) {
    button.disabled = true;
    result.textContent = '도보 경로를 확인하고 있습니다.';
    try {
      const response = await fetch('/api/routes/network', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({mode:'walking', legs:[{index:0, start:leg.start, end:leg.end}]})});
      if (!response.ok) throw new Error();
      const data = await response.json();
      const walked = data.legs?.[0]?.distance_km;
      if (!Number.isFinite(walked)) throw new Error();
      const difference = walked - leg.straight_km;
      result.textContent = `도보 ${walked.toFixed(2)}km · 직선 ${leg.straight_km.toFixed(2)}km`
        + (difference >= .02 ? ` · 직선보다 ${difference.toFixed(2)}km 더 이동` : '');
    } catch {
      result.textContent = '이 구간의 도보 경로를 확인하지 못했습니다.';
      button.disabled = false;
    }
  }

  for (const review of directions) {
    const rows = Object.values(review.rows || {});
    const selected = rows.filter(row => row.status === 'selected').sort((a, b) => a.rank - b.rank);
    const card = add($('directionReports'), 'article');
    card.className = 'direction-report';
    const kind = review.kind === 'reference' ? '참고 동선' : '추천 경로';
    add(card, 'h3', `${review.region} · ${kind}`);
    const headings = selected.map(row => `${row.heading}°`).join(', ');
    add(card, 'p', [review.base && `${review.base} 기준`, `반경 ${review.radius}km`,
      `선정 방향 ${selected.length}개${headings ? ` (${headings})` : ''}`].filter(Boolean).join(' · '));
    const table = add(card, 'table');
    table.className = 'direction-table';
    const header = add(add(table, 'thead'), 'tr');
    for (const field of ['방향', '결과', '선정 결과와 이동 거리']) add(header, 'th', field).scope = 'col';
    const body = add(table, 'tbody');
    for (const row of rows) {
      const tr = add(body, 'tr');
      const bearing = `${compass[Math.floor((row.heading + 22.5) / 45) % 8]} ${row.heading}°`;
      add(tr, 'th', bearing).scope = 'row';
      const label = row.status === 'selected' ? `${kind} ${row.rank}` : row.rank ? `전체 ${row.rank}위`
        : row.status === 'not_requested' ? '비교 범위 밖' : '미선정';
      const status = add(tr, 'td', label);
      if (row.status === 'selected') status.className = 'direction-selected';
      const detail = add(tr, 'td', directionReason(row, review));
      const summary = [row.place, row.leg_km != null ? `기준 구간 직선 ${row.leg_km}km`
        : row.distance_km != null ? `전체 직선 ${row.distance_km}km` : '',
        row.leg_minutes != null ? `구간 이동 추정 ${row.leg_minutes}분` : row.minutes != null && `예상 이동 ${row.minutes}분`];
      if (summary.some(Boolean)) add(detail, 'div', summary.filter(Boolean).join(' · '));
      if (row.walking_leg) {
        const button = add(detail, 'button', '도보 거리 확인');
        button.type = 'button';
        button.ariaLabel = `${bearing} 도보 거리 확인`;
        const result = add(detail, 'span');
        result.ariaLive = 'polite';
        button.addEventListener('click', () => walkingDistance(button, result, row.walking_leg));
      }
    }
  }

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
      let title;
      if (/^https?:\/\//i.test(place.url || '')) {
        title = add(item, 'a', place.name);
        title.href = place.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
      } else {
        title = add(item, 'span', place.name);
      }
      if (place.industry) add(item, 'small', ` · ${place.industry}`);
      if (place.visit_warning) {
        title.classList.add('visit-warning');
        const warning = add(item, 'span', place.visit_warning.reason);
        warning.className = 'visit-warning visit-warning-detail';
      }
    }
  }
})();
