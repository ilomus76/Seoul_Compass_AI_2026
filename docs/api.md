# API 명세

서버: `http://127.0.0.1:9200` · Swagger UI: `/docs`

| Method | Endpoint | 기능 |
|---|---|---|
| GET | `/api/health` | 상태 확인 |
| POST | `/api/parse` | 자연어 → 활동/시간 JSON |
| POST | `/api/places/search` | 반경 내 장소 검색 |
| POST | `/api/directions/analyze` | 8방향 점수 분석 |
| POST | `/api/routes/recommend` | 경로 TOP3 |
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
