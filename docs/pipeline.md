# 파이프라인 구성

## 1. CI/CD 파이프라인
- 파일: `.github/workflows/ci.yml`
- 트리거: `main`, `work/gyuhyeon` 브랜치 push / PR
- 단계:
  1. 체크아웃 + Python 3.12 + 의존성 설치
  2. `python -m unittest discover -s tests -v`
  3. 데이터 파이프라인 검증(`scripts/build_places.py`)
  4. Node 20 + `frontend/js/*.js` 문법 검사
  5. `.env` 커밋 여부 검사(누출 시 실패)
  6. `git archive`로 소스 ZIP 생성 후 아티팩트 업로드(7일)

> `.env`는 git에 없으므로 아티팩트에도 포함되지 않습니다.

## 2. 데이터 파이프라인
- 스크립트: `scripts/build_places.py`
- 입력/출력: `data/sample_places.json` (기본값, 인자로 변경 가능)
- 처리: 필수 필드 검증 → id 중복 제거 → 카테고리 소문자화 → 숫자형 정규화 → `crowd_by_hour` 보완 → id 순 정렬 → 메타 갱신
- 워크플로: `.github/workflows/data-pipeline.yml`
  - 수동 실행(`workflow_dispatch`) 또는 매일 18:00 UTC
  - 정규화 결과를 아티팩트로 업로드하고 변경분 보고

## 3. 로컬 실행
```powershell
python scripts/build_places.py                       # 제자리 정규화
python scripts/build_places.py data/sample_places.json data/out.json
python -m unittest discover -s tests
```

## 4. 주의
- 외부 API 키는 `.env`에만 두고 절대 커밋하지 않습니다.
- 실제 서울 Open API 수집은 키 발급 후 별도 어댑터를 추가해 이 스크립트 앞단에 붙입니다.
