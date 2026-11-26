# Seoul_Compass_AI_2026

이곳은 서울 관광을 위한 여행 가이드 개발을 위한 사이트입니다.

**Seoul Compass AI(서울 컴파스 AI)** — 출발지 주변 360도를 스캔해 관심 장소를 찾고, 사용자의 방문 순서·고정 약속시간·이동시간·비용을 고려해 실제 방문 가능한 여행 코스를 추천합니다. 최상위 개발 지침은 [`AGENTS.md`](AGENTS.md)입니다.

> ⚠️ 샘플 데이터와 시각화 지표는 **데모용 예시**입니다. 실제 운영 정보는 공식 출처에서 확인하세요.

## 실행 방법

```powershell
# 의존성 설치 (이미 설치되어 있으면 생략)
pip install -r requirements.txt

# 웹 실행 파일 (Windows)
.\run.ps1        # PowerShell
run.bat          # 명령 프롬프트 더블클릭

# 또는 직접 실행
python -m uvicorn backend.main:app --host 127.0.0.1 --port 9200
# → http://127.0.0.1:9200  (Swagger UI: /docs)
```

> `server.py`는 이전 정적 데모용 파일입니다. 현재 서비스는 `backend/main.py`(FastAPI)를 실행해야 합니다.

### 앱으로 설치하기

`dev_choi_v1.0.3`의 서울 컴패스 AI는 브라우저에서 설치할 수 있는 웹앱(PWA)입니다. PC에서는 서버를 실행한 뒤 Chrome 또는 Edge로 [로컬 앱](http://127.0.0.1:9200/)을 열고 상단의 **앱 설치**를 선택합니다.

- Android에서는 설치 버튼이나 Chrome 메뉴의 **앱 설치/홈 화면에 추가**를 이용합니다. [Chrome 웹앱 설치 안내](https://developer.chrome.com/docs/modern-web-guidance/guides/pwa/install-web-app)
- iPhone에서는 Safari의 **공유 → 홈 화면에 추가**를 이용합니다. **웹 앱으로 열기** 옵션이 표시되면 켭니다. [Apple 웹앱 설치 안내](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
- 별도 기기에서 설치하려면 그 기기에서 접속 가능한 HTTPS 앱 주소가 필요합니다. `127.0.0.1:9200`은 서버를 실행한 PC의 로컬 주소입니다.
- 한 번 연결한 앱을 오프라인에서 열면 연결 안내가 표시됩니다. 지도, 장소 검색, 일정 계산과 여행 기록은 서버 연결 상태에서 사용합니다.

테스트:

```powershell
python -m unittest discover -s tests
# 지도 군집·시간대 동선 검증 (설치된 Node.js 사용)
node --test tests/test_journey.cjs
# 앱 설치 설정과 연결 끊김 화면 검증
node --test tests/test_pwa.cjs
```

## 주요 기능

- **목적지 미정 지역 비교** — “내일 10시 서울의 산 등산, 12시 하산 후 수영, 15시 순대국”처럼 산 이름 없이 요청하면 실제 조회한 산 입구·수영장·메뉴 조건의 식당을 묶어 최대 3개 지역 후보를 보여줍니다. 기존 카카오 REST 키가 필요하며 산행으로 시작하는 서울 일정부터 지원합니다. 체류시간을 수정해 충돌을 확인할 수 있습니다. 영업시간·자유수영·산행 코스·실제 길찾기는 미검증이므로 결과는 검토용 일정으로 표시합니다.
- **문맥 기반 검색 중심** — “관악산 기준 3km”, “용산역에서 만나 볼링” 등 질문의 장소를 검색 중심에 반영합니다. 명시한 출발지는 검색 중심과 별도로 유지하며, 위치를 확인하지 못하면 서울시청으로 대체하지 않고 위치 지정을 안내합니다. 현재 해석은 규칙 기반이며, 카카오 REST 키가 있으면 이름이 지정된 목적지의 주변 시설도 실제 조회합니다. 키가 없을 때의 샘플과 이동 추정은 구분합니다. 상세 지침은 [`docs/map-routing.md` 2.1절](docs/map-routing.md#21-문맥에-따른-중심-선택과-서울시청-자동-대체-금지)을 따릅니다.
- **현재 위치에서 지정 목적지로 출발** — “10시에 소래산으로 지금 위치에서 발해서 12시에 내려와 수영하고 15시에 순대국”의 목적지·산행·출발 표현을 해석합니다. 지역 제한이 없으면 서울 밖 시설도 검색합니다. 현재 위치가 없으면 주변 시설은 먼저 보여주고 ‘현재 위치 적용 후 다시 분석’ 버튼 또는 수동 출발 좌표 입력을 안내합니다. 위치 적용 후 첫 이동 추정을 포함해 12시 하산·15시 식사 충돌을 계산합니다. 실제 코스·입구·영업·자유수영·길찾기는 확인이 필요합니다.
- **자연어 일정 입력** — "오후2시부터 4시까지 쇼핑", "9시 관악산 등산, 14시 신림역 약속, 18시 볼링" 등을 활동/시간 JSON으로 구조화 (키 없이 동작하는 규칙 기반 파서)
- **360도 방향 분석** — Haversine 직선거리 + 방위각, 8개(45도) 방향 구역별 점수, 지도 부채꼴 표시
- **시간대별 지도 동선** — 같은 활동의 후보를 중심 반경 50m 안에 묶고 각 군집 중심을 방문 순서대로 연결합니다. 추천 목록에 장소별 원문 요청 단어를 표시합니다. 일정표에서 시간대를 필터링하고 하단에서 시간을 재생할 수 있습니다. 출발지 미확보 시에는 요청 시각만 가진 후보 동선이며, 경로 점선은 실제 길찾기 미확인 상태입니다.
- **시간 제약 검증** — 고정 약속 시간 유지, 도착·시작·종료 시간 계산, 충돌 정보 제공
- **경로 추천 최대 5개** — 서로 다른 장소 조합을 지도에 색으로 표시하고 오른쪽에서 직선 거리·이동 추정·일정 충돌·방문 장소를 비교합니다. 일반 경로 점수는 `R = 0.35U + 0.25T + 0.20C + 0.20Q`를 사용합니다.
- **이동수단별 실제 선형** — 지도에서 이동수단과 추천을 골라 실제 길을 조회합니다. 도보·자전거·자동차는 [OpenStreetMap 기반 공개 경로 서버](https://routing.openstreetmap.de/about.html)를 사용합니다. 기차·지하철은 사용 가능한 ODsay 키를 `.env`의 `ODSAY_API_KEY`에 설정한 뒤 서버를 재시작합니다.
- **AI 기대치 리포트** — 추천 이유, 예상 시간/비용, 신뢰도, 주의사항, 대체 장소
- **여행 기록** — SQLite에 일정/방문 기록 저장, 조회, 수정, 삭제, 이전 일정 재사용
- **반응형 UI** — 모바일 우선 설계, PC/스마트폰 모두 지원

## 폴더 구조

```
Seoul_Compass_AI_2026/
├── AGENTS.md, README.md, requirements.txt, .env.example, .gitignore
├── frontend/        index.html, css/, js/(app·map·compass·schedule·route·history)
├── backend/         main.py, config.py, schemas.py, places.py, direction.py,
│                    scoring.py, optimizer.py, schedule.py, ai_parser.py,
│                    report.py, database.py, history.py
├── data/            sample_places.json (예시 장소 24곳), travel.db(실행 시 생성)
├── tests/           unittest 14건
├── docs/            architecture, algorithm, api, database, development_plan,
│                    test_plan, progress, SBOM
└── (기존 데모)       index.html, assets/, server.py — 삭제하지 않고 유지
```

기존 정적 데모(`index.html`, `assets/`)는 그대로 두어 이전 화면도 확인할 수 있습니다. 새 서비스는 `frontend/`와 FastAPI 백엔드로 동작합니다.

## 카카오맵 연동 (선택)

키가 없으면 자체 SVG 지도로 동작하며, 아래 설정 후에는 카카오맵 JS SDK로 자동 전환됩니다.

1. [Kakao Developers](https://developers.kakao.com) → 애플리케이션 생성 → **JavaScript 키** 발급
2. 앱 설정 → **플랫폼 → Web**에 `localhost`, `127.0.0.1` 도메인 등록
3. 프로젝트 루트에 `.env` 파일 생성 (`.gitignore`로 제외됨):
   ```
   KAKAO_JAVASCRIPT_KEY=발급받은_javascript_키
   KAKAO_REST_API_KEY=발급받은_rest_키
   ```
4. 서버 재시작 → `GET /api/config`의 `map_mode`가 `kakao`로 변경되고 지도·마커·반경원·추천 경로가 카카오맵에 표시됨

> 추천을 계산할 때는 직선거리 추정을 사용합니다. 선택 경로의 실제 길을 조회하면 좌표가 제공된 구간을 실선으로 표시합니다.

## 문맥 분석과 공개 메뉴 조회

- 외부 유료 API 사용 승인을 받은 후 서버 `.env`에 `LLM_API_KEY`와 `CONTEXT_LLM_ENABLED=true`를 설정하고 재시작합니다. 기본 모델은 `gpt-4.1-mini`이며 `CONTEXT_LLM_MODEL`로 지정할 수 있습니다. 기본 실행은 기존 분석 모드입니다.
- 공공데이터포털의 [한국관광공사_국문 관광정보 서비스_GW (`KorService2`)](https://www.data.go.kr/data/15101578/openapi.do)에서 활용신청을 합니다. 승인 후 상세 화면에서 `일반 인증키(Decoding)` 값을 복사해 프로젝트 루트의 `.env`에 `TOUR_API_KEY=발급받은_인증키`로 설정하고 서버를 재시작합니다. 키는 `.env.example`이나 GitHub에 넣지 않습니다.
- 이 키로 같은 시설로 확인된 음식점의 공개 메뉴를 표시합니다. 메뉴 데이터가 없는 곳은 장소 링크와 공개 전화번호로 확인할 수 있습니다.
- KBO 경기는 TheSportsDB 무료 일정 API에서 조회합니다. 별도 계정 키를 사용하려면 `.env`의 `SPORTSDB_API_KEY`에 설정합니다. 요청 날짜의 경기가 확인되지 않으면 KBO 또는 대회 주최 측 공식 홈페이지 링크를 제공합니다.
- 폭 10°의 구역 36개에서 활동 군집을 시간 순서대로 연결합니다. 단일 구역에서 코스가 성립하지 않으면 양옆 10° 구역을 함께 조회합니다. 상위 5개는 지도에서, 추가 코스와 나머지 장소는 `/alternatives`에서 확인합니다. [지도·장소 검색·길찾기 요구사항](docs/map-routing.md#44-문맥-분석의-36방향-스캔과-대안-코스)

### 필요한 API와 추가 데이터

분석·장소 검색·상가 업종·메뉴·경기 일정·실제 경로의 공급자, 키 설정법과 검증 상태는 [종류별 외부 API와 데이터 출처](docs/api-sources.md)에 정리했습니다.

## API

| Method | Endpoint | 기능 |
|---|---|---|
| GET | `/api/health` | 상태 확인 |
| POST | `/api/parse` | 자연어 분석 |
| POST | `/api/places/search` | 주변 장소 검색 |
| POST | `/api/directions/analyze` | 8방향 점수 |
| POST | `/api/routes/recommend` | 추천 경로 최대 5개 |
| POST | `/api/schedule/validate` | 일정 충돌 검사 |
| POST | `/api/report` | 기대치 리포트 |
| POST/GET/PATCH/DELETE | `/api/trips...` | 일정 저장·조회·수정·삭제 |
| POST/GET | `/api/trips/{id}/visits` | 방문 기록 |

자세한 내용은 [`docs/api.md`](docs/api.md) 참고.

## Git 작업 흐름 (GitHub 메인 / 컴퓨터 백업)

```powershell
git pull origin main
git add .
git commit -m "작업 내용"
# GitHub Push는 AGENTS.md 19.4에 따라 사용자 승인 후 진행
git push origin main
```

- 원본(메인): `https://github.com/ilomus76/Seoul_Compass_AI_2026`
- 로컬 백업: `C:\Users\sehun\OneDrive\문서\기본 프로젝트\Seoul_Compass_AI_2026`
