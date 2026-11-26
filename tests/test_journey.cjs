// 지도 동선: 공간 군집, 요청 순서, 미확인 출발지 및 누락 후보의 경계 조건.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const {join} = require('node:path');
const context = {window:{}};
runInNewContext(readFileSync(join(__dirname, '../frontend/js/journey.js'), 'utf8'), context);
const J = context.window.SeoulJourney;

test('추가 코스 페이지는 6위 코스와 별도 장소 목록을 같은 세션에서 표시한다', () => {
  const node = () => ({children:[], appendChild(child) { this.children.push(child); }, addEventListener() {}});
  const elements = new Map();
  const document = {getElementById(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  }, createElement:node};
  const data = {routes:[{rank:6,corridor:{heading:0,variant:'adjacent'},distance:1.2,minutes:25,
    stops:[{time:'10:00',name:'시험 카페',term:'커피'}]}],
  places:[{label:'커피',items:[{name:'다른 카페',industry:'카페',url:'https://example.com'}]}]};
  const source = readFileSync(join(__dirname, '../frontend/js/alternatives.js'), 'utf8');
  runInNewContext(source, {document, sessionStorage:{getItem:() => JSON.stringify(data)}});
  assert.equal(elements.get('emptyState').hidden, true);
  assert.match(elements.get('additionalRoutes').children[0].children[0].textContent, /추천 6.*양옆/);
  assert.equal(elements.get('additionalPlaces').children[0].children[1].children[0].children[0].href,
    'https://example.com');
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
