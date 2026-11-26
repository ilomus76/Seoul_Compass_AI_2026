// 지도 동선: 공간 군집, 요청 순서, 미확인 출발지 및 누락 후보의 경계 조건.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const {join} = require('node:path');
const context = {window:{}};
runInNewContext(readFileSync(join(__dirname, '../frontend/js/journey.js'), 'utf8'), context);
const J = context.window.SeoulJourney;

test('경기 검색 결과가 없으면 날짜가 다른 경기와 전야제 안내를 결과 영역에 표시한다', () => {
  const page = {window:{}};
  runInNewContext(readFileSync(join(__dirname, '../frontend/js/route.js'), 'utf8'), page);
  const panel = {innerHTML:'', hidden:true};
  const view = page.window.SeoulRouteView;
  view.renderEventNotice(panel, {
    location_context:{needs_confirmation:true,error:'입력한 날짜의 경기를 확인하지 못했습니다.'},
    event_options:[{date:'2026-12-04',start_time:'18:30',name:'전야제',venue:'고척스카이돔'},
                   {date:'2026-12-05',start_time:'14:00',name:'본경기',venue:'고척스카이돔'}],
    event_links:[{label:'공식 홈페이지',url:'https://dreamplayers.kr/'}]
  });
  assert.equal(panel.hidden, false);
  assert.match(panel.innerHTML, /2026-12-04 18:30.*전야제/);
  assert.match(panel.innerHTML, /2026-12-05 14:00.*본경기/);
  assert.match(panel.innerHTML, /원하는 날짜와 경기 또는 행사를 질문에 적고 다시 분석/);
  assert.match(panel.innerHTML, /href="https:\/\/dreamplayers\.kr\/"/);
  view.renderEventNotice(panel, null, '문맥 분석 API 호출에 실패했습니다.');
  assert.match(panel.innerHTML, /문맥 분석 API 호출에 실패했습니다/);
});

test('추가 코스 페이지는 6위 코스와 별도 장소 목록을 같은 세션에서 표시한다', () => {
  const node = () => ({children:[], appendChild(child) { this.children.push(child); }, addEventListener() {}});
  const elements = new Map();
  const document = {getElementById(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  }, createElement:node};
  const data = {routes:[{rank:6,corridor:{heading:0,variant:'adjacent'},distance:1.2,minutes:25,
    stops:[{time:'10:00',name:'시험 카페',term:'커피',menu_status:'unconfirmed',
      menu_model:{relatedness:18,supporting_neighbors:2}}]}],
  places:[{label:'커피',items:[{name:'다른 카페',industry:'카페',url:'https://example.com'}]}],
  directions:[{kind:'reference', region:'시험 지역', base:'시험 구장', radius:5, activity:'식사',
    land_use_source:{name:'서울시 생태현황도',year:2025,url:'https://data.seoul.go.kr/'}, rows:{
      0:{heading:0,status:'selected',rank:1},
      90:{heading:90,status:'missing_clusters',land_use:{coverage_percent:80,
        types:[{name:'주거지',percent:70},{name:'산림지',percent:25}],commercial_percent:5}},
      180:{heading:180,status:'rank_limit',factor:'직선 연결 거리',leg_km:2.3},
      270:{heading:270,status:'missing_clusters',land_use:{coverage_percent:20,types:[]}}}}]};
  const source = readFileSync(join(__dirname, '../frontend/js/alternatives.js'), 'utf8');
  const page = {window:{}, document, sessionStorage:{getItem:() => JSON.stringify(data)}};
  runInNewContext(readFileSync(join(__dirname, '../frontend/js/route.js'), 'utf8'), page);
  runInNewContext(source, page);
  assert.equal(elements.get('emptyState').hidden, true);
  assert.match(elements.get('additionalRoutes').children[0].children[0].textContent, /추천 6.*양옆/);
  const menu = elements.get('additionalRoutes').children[0].children[2].children[0].children[0].innerHTML;
  assert.match(menu, /관련도 18점.*판매 확인 필요/);
  assert.doesNotMatch(menu, /공개 메뉴 근거/);
  assert.equal(elements.get('additionalPlaces').children[0].children[1].children[0].children[0].href,
    'https://example.com');
  assert.equal(elements.get('directionReview').hidden, false);
  const report = elements.get('directionReports').children[0];
  assert.equal(report.children[2].children[0].href, 'https://data.seoul.go.kr/');
  const rows = report.children[3].children[1].children;
  assert.equal(rows.length, 4);
  assert.match(rows[0].children[1].textContent, /참고 동선 1/);
  assert.match(rows[1].children[2].textContent, /‘식사’에 맞는 후보 군집을 찾지 못했습니다/);
  assert.match(rows[1].children[2].children[0].textContent, /주거지 70% · 산림지 25% · 상업·업무지 5%.*80%/);
  assert.match(rows[2].children[2].textContent, /직선 연결 거리 비교에서 상위 5개보다/);
  assert.match(rows[3].children[2].children[0].textContent, /표본이 부족합니다.*20%/);
});
const a = {id:'a', name:'시험 산', category:'hiking', lat:37.45, lng:126.78};
const b = {id:'b', name:'시험 수영장', category:'swimming', lat:37.46, lng:126.79};
const c = {id:'c', name:'시험 식당', category:'restaurant', lat:37.47, lng:126.80};
const activities = [
  {id:1, category:'hiking', start_time:'10:00', end_time:'12:00'},
  {id:2, category:'swimming', earliest_start:'12:00'},
  {id:3, category:'restaurant', start_time:'15:00'}
];
const data = () => ({start:{latitude:a.lat, longitude:a.lng}, activities, places:[a,b,c]});

test('컴패스와 SVG 지도에서 선택한 검색 범위와 1·3·5km 점선 원을 함께 표시한다', () => {
  const page = {window:{SeoulJourney:J}, document:{getElementById:id => id === 'scrubSlider' ? {value:0} : null}};
  runInNewContext(readFileSync(join(__dirname, '../frontend/js/compass.js'), 'utf8'), page);
  const map = page.window.SeoulCompassMap;
  const container = {innerHTML:'', querySelector:() => null, querySelectorAll:() => []};
  for (const [draw, extent] of [[map.render, 245], [map.renderGeo, 275]]) {
    draw(container, {...data(), radius_km:3});
    const circles = [...container.innerHTML.matchAll(/class="radius-ring"[^>]+r="([\d.]+)"[^>]+stroke="([^"]+)"\s+stroke-width="1" stroke-dasharray="1 4"/g)];
    assert.deepEqual(circles.map(([, r, color]) => [Number(r), color]),
      [[extent / 5, '#2563EB'], [extent * 3 / 5, '#15803D'], [extent, '#E53935']]);
    assert.ok(container.innerHTML.includes(`A${extent * 3 / 5} ${extent * 3 / 5}`));
    draw(container, {...data(), radius_km:10});
    assert.match(container.innerHTML, /fill="#64748B"[^>]*>반경 10km/);
  }
});

test('두 손가락 확대 후 버튼으로 축소하면 같은 SVG 배율로 돌아온다', () => {
  const page = {window:{}};
  for (const module of ['compass', 'map']) {
    runInNewContext(readFileSync(join(__dirname, `../frontend/js/${module}.js`), 'utf8'), page);
  }
  const handlers = {};
  const svg = {viewBox:{baseVal:{x:100, y:120, width:400, height:400}},
    setAttribute(_name, value) {
      const [x, y, width, height] = value.split(' ').map(Number);
      this.viewBox.baseVal = {x, y, width, height};
    }};
  const container = {querySelector:() => svg, addEventListener:(type, handler) => { handlers[type] = handler; }};
  const zoom = steps => page.window.SeoulCompassMap.zoom(container, 1.25 ** steps);
  page.window.SeoulMapHelper.bindPinchZoom(container, zoom);
  const touch = (type, pointerId, clientX) => handlers[type]({
    pointerType:'touch', pointerId, clientX, clientY:4, stopPropagation() {}
  });
  touch('pointerdown', 1, 0);
  touch('pointerdown', 2, 100);
  touch('pointermove', 2, 125);
  assert.deepEqual(svg.viewBox.baseVal, {x:140, y:160, width:320, height:320});
  touch('pointerup', 1, 0);
  touch('pointerup', 2, 125);
  zoom(1);
  assert.deepEqual(svg.viewBox.baseVal, {x:100, y:120, width:400, height:400});
  touch('pointerdown', 1, 0);
  touch('pointerdown', 2, 100);
  touch('pointermove', 2, 80);
  assert.equal(svg.viewBox.baseVal.width, 500);
  touch('pointercancel', 1, 0);
  touch('pointerup', 2, 80);
  let cancelled = false;
  handlers.click({detail:1, preventDefault() { cancelled = true; }, stopImmediatePropagation() {}});
  assert.ok(cancelled);
});

test('오른쪽 추천과 참고 동선에 원문 요청과 인식한 활동을 장소 옆에 표시한다', () => {
  const page = {window:{SeoulJourney:J}};
  for (const module of ['charts', 'route']) {
    runInNewContext(readFileSync(join(__dirname, `../frontend/js/${module}.js`), 'utf8'), page);
  }
  const view = page.window.SeoulRouteView;
  const options = {
    start:{latitude:37.44, longitude:126.77, name:'서울역'},
    requestText:'서울역에서 출발해서 순대국을 먹고 야구 경기를 보고 노래방에 가요.',
    activities:[{category:'restaurant'}, {category:'baseball_game'}, {category:'karaoke', request_term:'노래방'}]
  };
  const route = {total_distance_km:4, total_travel_minutes:25, nodes:[
    {place:{...a, name:'시험 <식당>', category:'cafe'}, request_term:'순대국'},
    {place:{...b, name:'고척스카이돔'}, request_term:'야구 경기'},
    {place:{...c, name:'시험 노래방'}}
  ]};
  const right = view.recommendationList([route], route, -1, options);
  assert.match(right, /서울역\(서울역\) → 시험 &lt;식당&gt;\(순대국 · 식사\) → 고척스카이돔\(야구 경기 · 야구 경기 관람\) → 시험 노래방\(노래방\)/);
  assert.match(right, /aria-expanded="false"/);
  assert.doesNotMatch(right, /최단 직선 연결/);
  const expanded = view.recommendationList([route], route, -1, options, route);
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /최단 직선 연결 4km/);
  const reference = view.referenceCourse({...route, preview:true}, route, 0, options);
  assert.match(reference, /<small>시험 &lt;식당&gt;\(순대국 · 식사\) → 고척스카이돔\(야구 경기 · 야구 경기 관람\)/);
});

test('참고 동선에서 출발부터 모든 경유지까지 연결하고 방문 경고를 빨간 장소에 표시한다', () => {
  const start = {latitude:37.44, longitude:126.77, name:'출발 위치'};
  const warning = {reason:'영업시간 밖 · 18:00부터 영업',source:'공식 일정',source_url:'https://example.com/'};
  const blocked = {...b, visit_warning:warning};
  const route = {reference:true, start_location:start, nodes:[{place:a}, {place:blocked}, {place:c}]};
  const model = J.build({...data(), route});
  assert.equal(model.segments.length, 3);
  assert.equal(model.stops[1].warning, warning);
  assert.ok(J.routeLayers({...data(), routes:[route]}, route, 'all').every(leg => leg.color === J.REFERENCE_COLOR));
  runInNewContext(readFileSync(join(__dirname, '../frontend/js/route.js'), 'utf8'), context);
  const view = context.window.SeoulRouteView;
  assert.match(view.referenceCourse(route, route, 0, {start}), /출발 위치.*시험 산 → <strong class="visit-warning">시험 수영장<\/strong> → 시험 식당/);
  assert.match(view.visitWarning(warning), /영업시간 밖.*https:\/\/example\.com\//);
});

test('참고 동선 다섯 개는 같은 색상 목록과 지도에서 서로 구분된다', () => {
  const courses = [0, 60, 120, 180, 240].map((heading, i) => ({reference:true, reference_rank:i + 1,
    reference_heading:heading, reference_direction:'방향', nodes:[{place:a}, {place:{...b, lng:b.lng + i * .003}}, {place:c}]}));
  const layers = J.routeLayers({...data(), routes:courses}, courses[0], 'all');
  assert.equal(new Set(layers.map(leg => leg.color)).size, 5);
  const view = context.window.SeoulRouteView;
  assert.match(view.referenceCourse(courses[4], courses[4], 0, {}, 4, courses[4]), /data-route="4" aria-pressed="true" aria-expanded="true".*\s+<strong>참고 5\]<\/strong>/);
  assert.match(view.referenceCourse(courses[4], courses[4], 0, {}, 4, courses[4]), /방향 240°/);
  assert.match(view.referenceCourse(courses[4], courses[4], 0, {}, 4), /--reference-color:#397044/);
});

test('50m 반경 군집은 중복·잘못된 좌표를 제외하고 실제 장소를 대표로 쓴다', () => {
  const nearby = {...b, id:'near', lat:a.lat + .0003, lng:a.lng};
  const groups = J.cluster([a, a, nearby, c, {...b, lat:null}, {...b, lat:100}]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].members.length, 2);
  assert.ok(groups[0].members.includes(groups[0].representative));
});

test('출발지 미확인 상태에서도 활동별 한 후보만 연결하며 시간표는 만들지 않는다', () => {
  const model = J.build({...data(), places:[a,b,{...b,id:'b2',lat:b.lat+.0003},c]});
  assert.equal(model.preview, true);
  assert.equal(model.stops.length, 3);
  assert.equal(model.segments.length, 2);
  assert.equal(model.stops[1].time, '12:00 이후');
  assert.equal(model.stops[1].endMinute, null);
  assert.equal(model.stops[1].clusters[0].members.length, 2);
});

test('선택 경로의 장소·예상 시각·충돌을 사용하고 고정 시각으로 재정렬하지 않는다', () => {
  const chosen = {...b, id:'selected', lat:b.lat+.02};
  const center = {lat:chosen.lat + .0001, lng:chosen.lng};
  const route = {nodes:[{place:a},{place:chosen,cluster:{center,size:2,radius_m:50,place_ids:['selected','near']}},{place:c}], schedule:{
    timeline:[{activity_id:1,estimated_start:'10:00',estimated_end:'12:00'},
      {activity_id:2,estimated_start:'12:45',estimated_end:'14:15'},
      {activity_id:3,estimated_start:'15:00',estimated_end:'16:00'}],
    conflicts:[{activity_id:2}]}};
  const model = J.build({...data(), route});
  assert.equal(model.preview, false);
  assert.equal(model.stops[1].place, chosen);
  assert.equal(model.segments[0].to, center);
  assert.equal(model.stops[1].time, '12:45');
  assert.equal(model.stops[1].conflict, true);
  assert.equal(model.segments[0].startMinute, 720);
  assert.equal(model.segments[0].endMinute, 765);
});

test('필수 활동의 후보가 없으면 그 활동을 건너뛰는 선을 만들지 않는다', () => {
  const model = J.build({...data(), places:[a,c]});
  assert.equal(model.stops[1].place, null);
  assert.equal(model.segments.length, 0);
});

test('확인된 출발지만 첫 구간에 사용하고 동일 좌표의 선은 생략한다', () => {
  const route = {nodes:[{place:a},{place:b},{place:c}], departure_time:'09:00'};
  assert.equal(J.build({...data(),route,route_start:{latitude:37.4,longitude:126.7}}).segments.length, 3);
  assert.equal(J.build({...data(),route,route_start:{latitude:a.lat,longitude:a.lng}}).segments.length, 2);
});

test('전체 추천 지도에서 각 경로의 출발지와 색을 유지한다', () => {
  const first = {nodes:[{place:a},{place:b},{place:c}], start_location:{latitude:37.44,longitude:126.78}};
  const second = {nodes:[{place:a},{place:b},{place:c}], start_location:{latitude:37.43,longitude:126.78}};
  const map = {...data(), route_start:first.start_location, routes:[first, second]};
  const firstLegs = J.routeLayers(map, first, 'all').filter(leg => leg.index === 0);
  assert.equal(firstLegs.length, 2);
  assert.ok(firstLegs.some(leg => leg.from.lat === first.start_location.latitude && leg.color === J.ROUTE_COLORS[0]));
  assert.ok(firstLegs.some(leg => leg.from.lat === second.start_location.latitude && leg.color === J.ROUTE_COLORS[1]));
});

test('자정을 넘는 방문 순서와 시간대 필터를 유지하고 장소명을 HTML로 실행하지 않는다', () => {
  const model = J.build({...data(), activities:[{id:1,category:'hiking',start_time:'23:00',end_time:'00:30'},
    {id:2,category:'swimming',start_time:'01:00',end_time:'02:00'}]});
  assert.equal(model.stops[0].endMinute, 1470);
  assert.equal(model.stops[1].startMinute, 1500);
  assert.equal(J.visible(1, '1'), true);
  assert.equal(J.visible(0, '1'), false);
  model.stops[1].place = {...b,name:'<img src=x onerror=alert(1)>'};
  const svg = J.renderSvg(model, p => ({x:p.lng,y:p.lat}), '1');
  assert.ok(svg.includes('&lt;img'));
  assert.ok(!svg.includes('<img'));
});
