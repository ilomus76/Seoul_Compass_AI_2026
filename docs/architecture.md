# 아키텍처 (AGENTS.md 15장 기준)

```
Seoul_Compass_AI_2026/
├── AGENTS.md                 # 최상위 개발 지침
├── README.md / requirements.txt / .env.example / .gitignore
├── frontend/                 # HTML5 + CSS3 + JavaScript
│   ├── index.html
│   ├── css/style.css
│   ├── js/{app,compass,map,schedule,route,history}.js
│   └── assets/
├── backend/                  # Python + FastAPI
│   ├── main.py               # API 엔드포인트
│   ├── config.py / schemas.py
│   ├── places.py             # 샘플 장소 검색
│   ├── direction.py          # Haversine·방위각·8구역
│   ├── scoring.py            # 장소/방향 점수
│   ├── optimizer.py          # Beam Search 경로 추천 TOP3
│   ├── schedule.py           # 시간 제약·충돌 검사
│   ├── ai_parser.py          # 자연어 구조화(규칙 기반)
│   ├── report.py             # 기대치 리포트
│   ├── database.py / history.py  # SQLite 저장
├── data/sample_places.json   # 샘플 장소(24곳)
├── tests/                    # unittest 14건
└── docs/                     # 설계·진행 문서
```

## 데이터 흐름
`질문 입력 → /api/parse → 활동/시간 구조화 → /api/directions/analyze → 방향 점수 → /api/routes/recommend → 경로 TOP3 → /api/schedule/validate → /api/report → 화면 표시 → /api/trips 저장`

## 설계 원칙
- LLM은 자연어 분석에만 사용하고, 거리·시간·점수 계산은 Python 알고리즘이 담당한다(AGENTS.md 13.7).
- 외부 API 키가 없어도 샘플 데이터로 전체 흐름이 동작해야 한다.
- 직선거리와 실제 경로 추정치를 명확히 구분한다.

## v1.0.3 설치형 웹앱

- FastAPI가 같은 주소에서 웹앱 페이지와 `/manifest.webmanifest`, `/service-worker.js`를 제공한다. 브라우저는 매니페스트의 이름, 아이콘과 독립 실행 창 설정을 설치에 사용한다.
- 서비스 워커는 오프라인 안내 HTML만 캐시에 저장한다. 기본 화면과 추가 코스 페이지는 서버에서 읽고, 연결이 끊겼을 때 안내 화면을 연다. 질문, GPS 좌표, 지도 타일, API 응답과 여행 기록은 서비스 워커 캐시에 저장하지 않는다.
- 600px 이하 화면에서는 검색창 아래에 지도를 먼저 배치한다. 지도 조작과 일정 계산은 같은 웹앱과 API를 사용한다.
