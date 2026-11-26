# API 명세

서버: `http://127.0.0.1:9200` · Swagger UI: `/docs`

| Method | Endpoint | 기능 |
|---|---|---|
| GET | `/api/health` | 상태 확인 |
| POST | `/api/parse` | 자연어 → 활동/시간 JSON |
| POST | `/api/places/search` | 반경 내 장소 검색 |
| POST | `/api/directions/analyze` | 8방향 점수 분석 |
| POST | `/api/routes/recommend` | 추천 경로 최대 5개 |
| POST | `/api/routes/network` | 선택 경로의 도로·철도 선형 조회 |
| POST | `/api/schedule/validate` | 일정 충돌 검사 |
| POST | `/api/report` | 기대치 리포트 |
| POST | `/api/trips` | 일정 저장 |
| GET | `/api/trips` | 일정 목록 |
| GET | `/api/trips/{id}` | 상세 조회 |
| PATCH | `/api/trips/{id}` | 수정 |
| DELETE | `/api/trips/{id}` | 삭제 |
| POST | `/api/trips/{id}/visits` | 방문 기록 저장 |
| GET | `/api/trips/{id}/visits` | 방문 기록 조회 |

요청/응답 스키마는 `backend/schemas.py`에 정의되어 있습니다.
실제 경로 API 미연동 상태에서는 이동시간이 추정치임을 응답에 명시합니다.

## 문맥에 따른 검색 중심 (2026-11-26)

- `POST /api/parse`는 기존 `text` 외에 선택 필드 `fallback_location`과 `fallback_radius_km`를 받습니다. 위치에는 `name`, `latitude`, `longitude`, `type`을 전달할 수 있습니다. 자동으로 표시된 기본 지도 좌표를 사용자 지정 위치로 전달하지 않습니다.
- 응답에는 `search_center`, `start_location`, `radius_km`, `location_context`가 포함됩니다. `location_context.reason`은 중심 선택 이유, `needs_confirmation`과 `error`는 위치 확인 필요 여부와 안내입니다. 좌표를 확인하지 못하면 `search_center`는 null이며, 클라이언트는 주변 검색·방향 분석·경로 추천을 실행하지 않습니다.
- 장소명 좌표 확인은 로컬 샘플과 기존 `KAKAO_REST_API_KEY`의 카카오 키워드 검색을 사용합니다. 샘플은 `source: sample`, 실조회는 `source: kakao`로 구분합니다. 이름이 불명확하거나 API 실패 시 임의의 좌표를 만들지 않습니다. 근거: [카카오 Local 공식 문서](https://developers.kakao.com/docs/ko/local/dev-guide#search-by-keyword).
- `POST /api/routes/recommend`는 선택 필드 `search_center`를 추가로 받습니다. 후보 검색은 이 중심에서 하고, 실제 첫 구간 거리는 `start_location`에서 계산합니다. 좌표가 없으면 서울시청으로 대체하지 않고 HTTP 422를 반환합니다.
- 후보 장소 데이터와 경로 이동시간은 여전히 샘플·직선거리 기반 추정입니다. 이 변경으로 실제 주변 업소 검색과 실제 길찾기가 모두 연동된 것은 아닙니다.

## 목적지 미정 지역 추천 (2026-11-26)

- `POST /api/parse`: 특정 장소 없이 서울의 산행 일정에 맞는 지역 추천을 요청하면 `planning_mode: region_discovery`, `region_scope: 서울`을 반환합니다. 활동에는 `swimming`, `required_keywords`, `end_time`, `duration_estimated`, `duration_source`가 반영됩니다. “내일”은 한국 시간 기준입니다.
- `POST /api/regions/recommend`: `region_scope`, `travel_date`, `activities`, `radius_km`, `transport_modes`를 받습니다. 기존 카카오 장소 검색으로 산 입구·수영장·메뉴 조건에 맞는 식당을 확인합니다. 공개 검색 응답에 없는 운영시간·요금은 null입니다.
- 응답의 `regions`는 최대 3개이며 `candidate_groups`(활동별 조회 장소 최대 15개), `coverage_percent`(시설 후보 충족률), `missing_activities`, `checks_needed`, `search_center`, `start_location`, `draft_route`를 제공합니다. `status`는 `missing_places`, `needs_origin`, `time_conflict`, `needs_confirmation` 중 하나입니다. 검색된 지역 수는 `searched_region_count`로 제공합니다.
- 각 지역의 `routes`는 방문 장소 조합이 서로 다른 경로를 최대 5개 제공합니다. 출발 위치 미확인 상태(`needs_origin`)에서는 `preview: true`이며 `schedule`과 `total_travel_minutes`는 null입니다. `draft_route`는 계산한 일정이 있을 때 첫 번째 경로입니다.
- 지역 및 일반 추천의 각 경유지에는 원문 표현인 `request_term`과 군집의 `center`, `radius_m`, `size`, `place_ids`를 담은 `cluster`가 포함됩니다. `place`는 목록·일정에 표시할 실제 대표 장소이며, 추정 동선은 `cluster.center`를 사용합니다.
- `/api/routes/network`는 `mode`와 `legs`(최대 20개, 각 `index`, `start`, `end` 포함)를 받습니다. 조회된 구간에만 `index`, `paths`(서로 독립적인 좌표선), `source`를 제공합니다. 도로 구간에는 `distance_km`와 `minutes`가 포함됩니다. 철도 키 미설정은 `missing_key`, 조회 결과가 없으면 `unavailable`을 반환합니다.
- 시설 후보가 모두 있어도 실제 방문 가능성이 검증된 것은 아닙니다. `draft_route.verification_status`는 `unverified`, `score`와 `estimated_cost_krw`는 null입니다. 일정의 `timing_feasible_estimate`는 시간창·이동 추정 기준 판정, `feasible: null`과 `verified_feasible: false`는 실제 방문 미검증을 뜻합니다.
- 날짜는 방문 전 확인 안내에 유지하며 실제 시설 운영일·자유수영 시간·산행 코스 데이터의 자동 검증은 아직 제공하지 않습니다. 기본 주변 검색 및 이름이 지정된 일반 경로 기능의 데이터 출처는 기존과 같습니다.
- 검색 캐시는 메모리 내 5분·최대 128개 요청으로 제한하며, REST 키나 상세 여행 기록을 응답에 포함하지 않습니다.

## 명시 목적지와 현재 위치 출발 (2026-11-26)

- `/api/parse`의 `live_place_plan`이 true이면 이름이 지정된 목적지의 실제 시설 검색에도 `/api/regions/recommend`를 사용합니다. `location_context.uses_current_location`, `needs_current_location`, `mountain_name`, `implicit_hiking`과 `departure_time`으로 역할을 구분합니다.
- 현재 출발 좌표가 없어도 목적지와 활동을 확인하면 `needs_confirmation: false`로 주변 시설을 조회할 수 있습니다. `needs_current_location: true`인 경우에는 출발 구간과 일정 계산을 위해 별도로 위치 적용을 안내합니다. IP 추정 출발지는 허용하지 않습니다.
- `/api/regions/recommend`의 선택 입력: `search_center`, `start_location`, `destination_name`, `current_location_requested`, `departure_time`. `region_scope: null`은 특정 시·도 주소 제한 없이 목적지 반경 안에서 검색하는 뜻입니다. 목적지가 없는 기존 서울 지역 비교는 유지합니다.
- 지역 후보 응답의 `first_leg`는 `status`, `planned_departure`, `estimated_minutes`, 좌표가 있으면 `distance_km`와 `estimated_arrival`을 제공합니다. 출발 위치가 없으면 `status: needs_origin`, `draft_route: null`이며 조회된 `candidate_groups`는 유지합니다.
- 출발 10:00·하산 12:00 요청에서는 첫 이동 추정과 여유시간 후 남은 산행 시간창으로 `evaluated_activities`를 계산합니다. 이는 실제 산행 코스 시간이 아닙니다. `draft_route.departure_time`을 일정 재검증 요청에도 유지해야 합니다.
- 응답 위치의 `source`, `resolved_name`, `address`를 보존합니다. 좌표 조회를 실제로 했어도 시설 운영·자유수영·코스·실제 길찾기는 별도 확인이 필요합니다.

## 문맥 분석과 36방향 코스 추천

- `/api/parse`의 선택 필드 `analysis_mode`는 `context`, `legacy`입니다. 생략하면 서버 활성화 설정을 따릅니다. 응답의 `analysis_method`로 실제 실행 모드를 확인합니다. 문맥 분석이 요청됐으나 사용할 수 없으면 HTTP 503 안내를 반환합니다.
- 문맥 분석 응답은 `requested_bearing`, `route_goal`과 활동별 `search_query`, `venue_kind`, `menu_terms`를 제공합니다. 분석의 `location_context.needs_confirmation`이 true면 검색에 앞서 `error`를 표시합니다.
- `/api/regions/recommend`에 `contextual: true`, `requested_bearing`, `route_goal`을 전달하면 전체 `recommendations`를 최대 5개 반환합니다. `scanned_headings`는 기준 방향 수 36, `direction_candidate_count`는 중복을 제거한 순위 적용 전 건수입니다. 각 코스의 `rank`, `region_id`, `start_location`, `corridor.heading`, `corridor.variant`(`primary`, `left`, `right`)를 제공합니다. 방향과 시간이 함께 맞지 않는 지역에는 `no_corridor`를 표시합니다.
- 음식점 후보의 `menus`, `menu_source`, `matched_menu_terms`, `menu_status`로 공개 메뉴와 확인 상태를 구별합니다. `matched`는 요청 메뉴가 공개 정보에서 확인된 경우, `unconfirmed`는 요청 메뉴 확인 필요, `published`는 공개 메뉴 있음, `unavailable`은 공개 메뉴 미확인입니다.

## 야구 일정 조회와 홈페이지 안내

- `/api/parse`는 KBO 경기 일정에서 날짜와 시작 시각을 받아 카카오 장소 좌표와 연결합니다. `event_options`에는 날짜, 한국 시각, 경기장, 일정 출처(`source`, `source_url`)를 제공합니다.
- 요청 조건을 충족하는 일정이 없거나 조회에 실패하면 같은 날짜를 유지하고 `event_links`의 공식 홈페이지를 화면에 표시합니다. `event_links`의 각 항목은 `label`, `url`을 제공합니다.
