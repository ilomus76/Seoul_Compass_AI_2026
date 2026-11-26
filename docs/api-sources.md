# 관광 코스 추천에 사용하는 외부 API

이 문서는 문맥 분석, 장소와 사업체 정보, 메뉴·경기 일정, 실제 경로에 사용하는 외부 API를 정리한다. 앱 내부 요청과 응답은 [백엔드 API 명세](api.md)에 기록한다.

## 지금 필요한 설정

2026-11-26 로컬 환경에서 OpenAI·카카오·상권정보·TourAPI·TheSportsDB의 실제 API 응답을 확인했다. ODsay는 발급 문의 중이다. 새 환경에서 상권 업종 정보를 조회하려면 `SBDC_API_KEY`를 설정한다.

1. 공공데이터포털에서 소상공인시장진흥공단 상가(상권)정보 API를 무료로 활용신청한다. [활용신청 페이지](https://www.data.go.kr/data/15012005/openapi.do)
2. 승인 후 발급된 일반 인증키를 프로젝트 루트의 `.env`에 `SBDC_API_KEY=발급받은_인증키`로 저장한다. 공개 철도 기능이 필요하면 ODsay 키도 `ODSAY_API_KEY`에 설정한다. [환경변수 항목](../.env.example) · [ODsay 개발자 문서](https://lab.odsay.com/guide/releaseReference?platform=web)
3. 서버를 재시작하고 `GET /api/config`에서 `merchant_lookup_configured`를 확인한다. `true`는 키가 로드됐다는 뜻이다. 분석 응답에서 `merchant_lookup: matched`이면 추천 과정에 공공 업종 데이터가 포함된 것이다. [연동 상태 응답](api.md#문맥-분석과-36방향-코스-추천)

실제 서버 키는 로컬 `.env`에서 관리한다. `.env.example`에는 설정 이름만 기록한다.

## 1. 문맥 분석

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| OpenAI Responses API | `LLM_API_KEY`, `CONTEXT_LLM_ENABLED=true`. `CONTEXT_LLM_MODEL`로 모델 변경 가능 | 사용자의 의도, 활동별 검색어와 유사 표현, 업종명 후보, 방문 순서와 시간 제약을 구조화한다. |

앱은 모델 출력에서 날짜·시간·조건을 읽고, 장소명·좌표·업종은 장소 및 공공 데이터 응답에서 검증한다. 기존에 사용 중인 외부 유료 API의 승인 기준은 프로젝트 규칙을 따른다. [Responses API 명세](https://developers.openai.com/api/reference/resources/responses/methods/create) · [프로젝트 승인 규칙](../AGENTS.md#194-변경-승인-규칙)

승인된 실호출 1건에서 서울역 반경 1km, 오전 10시 카페, 정오 식사와 업종 후보를 확인했다. 이 응답을 연결한 추천 요청은 공개 상권 데이터를 받았고 코스는 0개였다. 같은 장소와 활동 시각에 체류 시간을 따로 지정한 요청은 상위 5개와 추가 21개 코스를 반환했다. [검증 기록](progress.md#2026-11-26-발급된-외부-api-키-실조회-점검)

## 2. 지도와 실제 장소 검색

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| 카카오 Local | `KAKAO_REST_API_KEY` | 장소명, 카테고리, 주소, 좌표, 제공된 공개 전화번호와 장소 상세 링크를 조회한다. |
| 카카오 지도 JavaScript SDK | `KAKAO_JAVASCRIPT_KEY`, 웹 도메인 등록 | 반경 원, 장소 마커, 군집과 추천 경로를 지도에 그린다. |

현재 로컬 환경에서 카카오 장소 실조회를 검증했다. 상권정보 키가 없거나 공개 업종을 확인하지 못하면 카카오 결과와 확인 상태를 보여준다. [카카오 Local 명세](https://developers.kakao.com/docs/ko/local/dev-guide) · [카카오 지도 SDK 가이드](https://apis.map.kakao.com/web/guide/)

## 3. 상가 업종과 영업 상태

| 서비스 | 단계 | 데이터와 쓰임새 |
|---|---|---|
| 소상공인시장진흥공단 상가(상권)정보 API | 로컬 키 설정 및 실조회 검증 | `smallUpjongList`에서 업종명을 소분류 코드에 연결하고 `storeListInRectangle`에서 상가업소번호, 업종, 주소, 좌표를 조회한다. 앱에서 실제 반경과 지역을 다시 확인한다. |
| 행정안전부 전국일반음식점표준데이터 | 추가 연동 후보 | 일반음식점 인허가와 공개 영업 상태를 확인할 수 있는 데이터다. 개별 점포의 당일 영업시간은 별도 출처가 필요하다. |
| 국세청 사업자등록정보 진위확인·상태조회 | 키 설정 및 직접 요청의 인증 검증, 앱 연동 예정 | 이미 알고 있는 사업자등록번호로 휴업·폐업 등 상태를 조회하는 용도다. |

상가업소번호는 상권정보 서비스의 식별자다. 앱에서 동일한 지점으로 연결할 때는 상호와 주소 또는 50m 이내 좌표를 대조한다. 양쪽에 공개 전화번호가 있으면 번호도 비교한다. [상권정보 API](https://www.data.go.kr/data/15012005/openapi.do) · [일반음식점 인허가 데이터](https://www.data.go.kr/data/15096283/standard.do) · [국세청 상태조회 API](https://www.data.go.kr/data/15081808/openapi.do)

국세청 상태조회는 아직 연동되지 않았으며 현재 앱에 활성화할 환경변수는 없다. 향후 연동할 때는 `NTS_BUSINESS_API_KEY`를 변수명으로 사용한다. 공공데이터포털에서 해당 서비스의 활용 승인을 받은 계정의 일반 인증키를 프로젝트 루트 `.env`에 저장하는 형식은 아래와 같다. [국세청 API 활용신청](https://www.data.go.kr/data/15081808/openapi.do)

```env
NTS_BUSINESS_API_KEY=발급받은_일반_인증키
```

로컬 `.env`에 저장된 인증키로 합성 시험 번호를 조회했고 `HTTP 200`과 `status_code: OK` 응답을 확인했다. 이 인증 시험은 실제 사업체의 휴업·폐업 여부를 확인하는 검증과 구분한다.

## 4. 메뉴와 관람 일정

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| 한국관광공사 국문 관광정보 서비스_GW `KorService2` | `TOUR_API_KEY` | `searchKeyword2`로 장소를 찾고 동일한 업소로 확인되면 `detailIntro2`의 공개 메뉴, 영업시간(`opentimefood`), 휴무(`restdatefood`)를 사용한다. |
| 행정안전부 착한가격업소 현황 | 키 없이 공개 CSV | [공개 자료](https://www.data.go.kr/data/3045247/fileData.do)의 2026-09-30 서울 음식점 중 메뉴가 있는 1,428곳을 `data/public_menus_seoul.csv`에 저장했다. 상호, 주소, 업종과 등록 메뉴만 사용한다. 같은 지점 확인과 유사 업소 모델에 쓰며, 갱신 시 파일과 `backend/menu_model.py`의 자료 기준일을 함께 업데이트한다. |
| TheSportsDB KBO 일정 | 공개 무료 기본값 사용. 계정별 키는 `SPORTSDB_API_KEY` | 요청 날짜와 앞뒤 하루의 경기, 구장, 시작 시각을 조회한다. 일정을 확인하지 못하면 KBO나 주최 측 홈페이지를 안내한다. |

TourAPI 키는 서비스 활용신청 후 일반 인증키를 사용한다. 공개 메뉴가 없을 때는 장소 상세 링크와 제공된 전화번호로 확인할 수 있다. 취소·연기 또는 시작 시각이 확인되지 않은 경기에는 확정 관람 경로를 만들지 않는다. [한국관광공사 TourAPI](https://www.data.go.kr/data/15101578/openapi.do) · [TheSportsDB 일정 명세](https://api.thesportsdb.com/documentation) · [KBO 공식 경기 일정](https://www.koreabaseball.com/Schedule/Schedule.aspx)

## 5. 실제 이동 경로

| 서비스 | 설정 | 앱에서 사용하는 정보 |
|---|---|---|
| OpenStreetMap 기반 OSRM | 공개 도로 서비스 사용 | 선택한 코스의 도보·자전거·자동차 선형을 조회한다. |
| ODsay | `ODSAY_API_KEY` | 지하철·기차로 선택한 코스의 탑승 구간 선형을 조회한다. 현재 로컬 키 미설정 상태다. |

순위 추천 단계는 이동시간 추정치를 사용한다. 지도에서 **선택 경로의 실제 길 조회**를 누르면 공급자가 제공한 구간을 실선으로 표시한다. [OSRM 공개 서비스](https://routing.openstreetmap.de/about.html) · [ODsay API 명세](https://lab.odsay.com/guide/releaseReference?platform=web) · [실제 선형 표시 기준](map-routing.md#43-이동수단별-실제-선형-표시)

## 6. 방향별 토지 이용

서울특별시가 공개한 `비오톱유형_평가도(2025년기준).zip`을 사용한다. 원본 도형을 위·경도 약 55m 간격의 유형 표본으로 변환한 `data/seoul_land_use_2025.json`을 앱에서 읽는다. 서울시 경계 밖이나 분류되지 않은 표본은 미확인으로 둔다. 출처는 앱 방향별 비교에 표시한다. [서울 열린데이터광장 OA-21145](https://data.seoul.go.kr/dataList/OA-21145/S/1/datasetView.do)

원본 ZIP을 받은 후 프로젝트 루트에서 `python scripts/prepare_seoul_land_use.py <ZIP 경로> data/seoul_land_use_2025.json`을 실행하면 변환할 수 있다. 서버 실행에 별도 키는 필요하지 않다.
