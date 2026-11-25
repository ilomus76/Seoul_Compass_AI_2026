# Seoul_Compass_AI_2026

이곳은 서울 관광을 위한 여행 가이드 개발을 위한 사이트입니다.

**Seoul Compass AI(서울 컴파스 AI)** — 출발지 주변 360도를 스캔해 관심 장소를 찾고, 사용자의 방문 순서·고정 약속시간·이동시간·비용을 고려해 실제 방문 가능한 여행 코스를 추천합니다. 최상위 개발 지침은 [`AGENTS.md`](AGENTS.md)입니다.

> ⚠️ 샘플 데이터와 시각화 지표는 **데모용 예시**입니다. 실제 운영 정보는 공식 출처에서 확인하세요.

## 실행 방법

```powershell
# 의존성 설치 (이미 설치되어 있으면 생략)
pip install -r requirements.txt

# 서버 실행 (전용 포트 9200)
python -m uvicorn backend.main:app --host 127.0.0.1 --port 9200
# → http://127.0.0.1:9200  (Swagger UI: /docs)
```

테스트:

```powershell
python -m unittest discover -s tests
```

## 주요 기능

- **자연어 일정 입력** — "오후2시부터 4시까지 쇼핑", "9시 관악산 등산, 14시 신림역 약속, 18시 볼링" 등을 활동/시간 JSON으로 구조화 (키 없이 동작하는 규칙 기반 파서)
- **360도 방향 분석** — Haversine 직선거리 + 방위각, 8개(45도) 방향 구역별 점수, 지도 부채꼴 표시
- **시간 제약 검증** — 고정 약속 시간 유지, 도착·시작·종료 시간 계산, 충돌 정보 제공
- **경로 추천 TOP 3** — 활동별 최대 5개 후보, Beam Search, 경로 점수 `R = 0.35U + 0.25T + 0.20C + 0.20Q`
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
4. 서버 재시작 → `GET /api/config`의 `map_mode`가 `kakao`로 변경되고 지도·마커·반경원·TOP3 경로가 카카오맵에 표시됨

> 실제 도보/대중교통 길찾기(카카오모빌리티 API)는 별도 승인·키가 필요하며, 현재는 추정 경로입니다.

## API

| Method | Endpoint | 기능 |
|---|---|---|
| GET | `/api/health` | 상태 확인 |
| POST | `/api/parse` | 자연어 분석 |
| POST | `/api/places/search` | 주변 장소 검색 |
| POST | `/api/directions/analyze` | 8방향 점수 |
| POST | `/api/routes/recommend` | 추천 경로 TOP3 |
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
