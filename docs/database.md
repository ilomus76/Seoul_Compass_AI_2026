# 데이터베이스

MVP 1차는 SQLite(`data/travel.db`, Git에는 포함하지 않음)를 사용합니다.

## trips
| 컬럼 | 설명 |
|---|---|
| trip_id | 일정 식별자 (PK) |
| user_id | 사용자 식별자 (기본 local_user) |
| date | 여행 날짜 |
| start_lat / start_lng | 출발지 좌표 |
| payload | 구조화된 일정/경로 JSON |
| created_at | 생성 시각 |

## visits
| 컬럼 | 설명 |
|---|---|
| visit_id | 방문 기록 ID |
| trip_id | 일정 ID (FK) |
| place_name / category | 장소명/분류 |
| planned_start / actual_start / actual_end | 계획·실제 시각 |
| status | planned / visited |
| actual_cost_krw / memo | 실제 비용/메모 |

개인정보(집 주소, 상세 이동 기록)는 외부 LLM에 전달하지 않으며, 기록 삭제 기능을 제공합니다.
