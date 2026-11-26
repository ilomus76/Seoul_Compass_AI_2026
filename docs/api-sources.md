# 관광 코스 추천에 사용하는 외부 API

이 문서는 문맥 분석, 장소와 사업체 정보, 메뉴·경기 일정, 실제 경로에 사용하는 외부 API를 정리한다. 앱 내부 요청과 응답은 [백엔드 API 명세](api.md)에 기록한다.

## 지금 필요한 설정

2026-11-26 로컬 환경 기준으로 OpenAI 문맥 분석, 카카오 지도·장소 검색, TourAPI 키가 설정되어 있다. **상권 업종 정보를 실조회하려면 `SBDC_API_KEY`가 필요하다.** 철도 실선을 조회할 때는 `ODSAY_API_KEY`가 필요하다.

1. 공공데이터포털에서 소상공인시장진흥공단 상가(상권)정보 API를 무료로 활용신청한다. [활용신청 페이지](https://www.data.go.kr/data/15012005/openapi.do)
2. 승인 후 발급된 일반 인증키를 프로젝트 루트의 `.env`에 `SBDC_API_KEY=발급받은_인증키`로 저장한다. 공개 철도 기능이 필요하면 ODsay 키도 `ODSAY_API_KEY`에 설정한다. [환경변수 항목](../.env.example) · [ODsay 개발자 문서](https://lab.odsay.com/guide/releaseReference?platform=web)
3. 서버를 재시작하고 `GET /api/config`에서 `merchant_lookup_configured`를 확인한다. `true`는 키가 로드됐다는 뜻이다. 분석 응답에서 `merchant_lookup: matched`이면 추천 과정에 공공 업종 데이터가 포함된 것이다. [연동 상태 응답](api.md#문맥-분석과-36방향-코스-추천)

실제 서버 키는 로컬 `.env`에서 관리한다. `.env.example`에는 설정 이름만 기록한다.

## 1. 문맥 분석

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| OpenAI Responses API | `LLM_API_KEY`, `CONTEXT_LLM_ENABLED=true`. `CONTEXT_LLM_MODEL`로 모델 변경 가능 | 사용자의 의도, 활동별 검색어와 유사 표현, 업종명 후보, 방문 순서와 시간 제약을 구조화한다. |

앱은 모델 출력에서 날짜·시간·조건을 읽고, 장소명·좌표·업종은 장소 및 공공 데이터 응답에서 검증한다. 기존에 사용 중인 외부 유료 API의 승인 기준은 프로젝트 규칙을 따른다. [Responses API 명세](https://developers.openai.com/api/reference/resources/responses/methods/create) · [프로젝트 승인 규칙](../AGENTS.md#194-변경-승인-규칙)

## 2. 지도와 실제 장소 검색

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| 카카오 Local | `KAKAO_REST_API_KEY` | 장소명, 카테고리, 주소, 좌표, 제공된 공개 전화번호와 장소 상세 링크를 조회한다. |
| 카카오 지도 JavaScript SDK | `KAKAO_JAVASCRIPT_KEY`, 웹 도메인 등록 | 반경 원, 장소 마커, 군집과 추천 경로를 지도에 그린다. |

현재 로컬 환경에서 카카오 장소 실조회를 검증했다. 상권정보 키가 없거나 공개 업종을 확인하지 못하면 카카오 결과와 확인 상태를 보여준다. [카카오 Local 명세](https://developers.kakao.com/docs/ko/local/dev-guide) · [카카오 지도 SDK 가이드](https://apis.map.kakao.com/web/guide/)

## 3. 상가 업종과 영업 상태

| 서비스 | 단계 | 데이터와 쓰임새 |
|---|---|---|
| 소상공인시장진흥공단 상가(상권)정보 API | 연동 구현, 응답 모의 검증, 로컬 키 미설정 | `smallUpjongList`에서 업종명을 소분류 코드에 연결하고 `storeListInRectangle`에서 상가업소번호, 업종, 주소, 좌표를 조회한다. 앱에서 실제 반경과 지역을 다시 확인한다. |
| 행정안전부 전국일반음식점표준데이터 | 추가 연동 후보 | 일반음식점 인허가와 공개 영업 상태를 확인할 수 있는 데이터다. 개별 점포의 당일 영업시간은 별도 출처가 필요하다. |
| 국세청 사업자등록정보 진위확인·상태조회 | 추가 연동 후보 | 이미 알고 있는 사업자등록번호로 휴업·폐업 등 상태를 조회하는 용도다. |

상가업소번호는 상권정보 서비스의 식별자다. 앱에서 동일한 지점으로 연결할 때는 상호와 주소 또는 50m 이내 좌표를 대조한다. 양쪽에 공개 전화번호가 있으면 번호도 비교한다. [상권정보 API](https://www.data.go.kr/data/15012005/openapi.do) · [일반음식점 인허가 데이터](https://www.data.go.kr/data/15096283/standard.do) · [국세청 상태조회 API](https://www.data.go.kr/data/15081808/openapi.do)

## 4. 메뉴와 관람 일정

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| 한국관광공사 국문 관광정보 서비스_GW `KorService2` | `TOUR_API_KEY` | `searchKeyword2`로 장소를 찾고 동일한 업소로 확인되면 `detailIntro2`에서 공개 메뉴를 조회한다. |
| TheSportsDB KBO 일정 | 공개 무료 기본값 사용. 계정별 키는 `SPORTSDB_API_KEY` | 요청 날짜와 앞뒤 하루의 경기, 구장, 시작 시각을 조회한다. 일정을 확인하지 못하면 KBO나 주최 측 홈페이지를 안내한다. |

TourAPI 키는 서비스 활용신청 후 일반 인증키를 사용한다. 공개 메뉴가 없을 때는 장소 상세 링크와 제공된 전화번호로 확인할 수 있다. 취소·연기 또는 시작 시각이 확인되지 않은 경기에는 확정 관람 경로를 만들지 않는다. [한국관광공사 TourAPI](https://www.data.go.kr/data/15101578/openapi.do) · [TheSportsDB 일정 명세](https://api.thesportsdb.com/documentation) · [KBO 공식 경기 일정](https://www.koreabaseball.com/Schedule/Schedule.aspx)

## 5. 실제 이동 경로

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| OpenStreetMap 기반 OSRM | 공개 도로 서비스 사용 | 선택한 코스의 도보·자전거·자동차 선형을 조회한다. |
| ODsay | `ODSAY_API_KEY` | 지하철·기차로 선택한 코스의 탑승 구간 선형을 조회한다. 현재 로컬 키 미설정 상태다. |

순위 추천 단계는 이동시간 추정치를 사용한다. 지도에서 **선택 경로의 실제 길 조회**를 누르면 공급자가 제공한 구간을 실선으로 표시한다. [OSRM 공개 서비스](https://routing.openstreetmap.de/about.html) · [ODsay API 명세](https://lab.odsay.com/guide/releaseReference?platform=web) · [실제 선형 표시 기준](map-routing.md#43-이동수단별-실제-선형-표시)
