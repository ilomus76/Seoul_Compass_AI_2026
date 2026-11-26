"""FastAPI 서버: AGENTS.md 16장의 API 엔드포인트를 제공한다.

실행: python -m uvicorn backend.main:app --host 127.0.0.1 --port 9200
"""
import uuid
from typing import Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import ai_parser, context_parser, density, history, network_routes, optimizer, report, safety, schedule, weather
from .config import CONTEXT_LLM_ENABLED, FRONTEND_DIR, HOST, KAKAO_JAVASCRIPT_KEY, PORT, TOUR_API_KEY
from .direction import analyze_directions, calculate_bearing, get_direction
from .places import find_by_keywords, load_places, search_places
from .location_context import apply_location_context
from .region_planner import recommend_regions
from .scoring import score_directions, score_place
from .schemas import (DirectionAnalyzeRequest, ParseRequest, ReportRequest,
                      RouteRecommendRequest, ScheduleValidateRequest,
                      SearchRequest, TripCreate, VisitCreate, RegionRecommendRequest, NetworkRouteRequest)

app = FastAPI(title="Seoul Compass AI", version="1.0",
              description="360도 공간 분석과 시간 제약 기반 경로 추천 MVP")


@app.get("/api/health")
def health() -> Dict:
    """서버 상태 확인."""
    return {"status": "ok", "service": "Seoul Compass AI",
            "places": len(load_places()), "port": PORT}


@app.post("/api/parse")
def parse(req: ParseRequest) -> Dict:
    """자연어 질문을 활동/시간 구조로 변환한다."""
    fallback = req.fallback_location.model_dump() if req.fallback_location else None
    if req.analysis_mode == 'context' or (req.analysis_mode is None and CONTEXT_LLM_ENABLED):
        try:
            return context_parser.resolve_intent(context_parser.analyze_text(req.text), fallback, req.fallback_radius_km)
        except context_parser.ContextAnalysisError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
    result = apply_location_context(ai_parser.parse_user_request(req.text), req.text, fallback, req.fallback_radius_km)
    return {**result, 'analysis_method': 'legacy'}


@app.post("/api/places/search")
def place_search(req: SearchRequest) -> Dict:
    """반경 안의 장소를 검색한다."""
    places = search_places(req.latitude, req.longitude, req.radius_km,
                           req.category, req.keyword, req.limit)
    for place in places:
        place["bearing"] = round(calculate_bearing(
            req.latitude, req.longitude, place["lat"], place["lng"]), 1)
        place["direction"] = get_direction(place["bearing"])
    return {"places": places, "count": len(places),
            "note": "샘플 데이터이며 직선거리 기준입니다."}


@app.post('/api/regions/recommend')
def region_recommend(req: RegionRecommendRequest) -> Dict:
    """목적지 미정 요청의 지역 후보·누락 활동·검토용 일정을 반환한다."""
    return recommend_regions(req.model_dump())


@app.post("/api/directions/analyze")
def direction_analyze(req: DirectionAnalyzeRequest) -> Dict:
    """8개 방향 구역의 점수와 상위 방향을 계산한다."""
    places = search_places(req.latitude, req.longitude, req.radius_km, limit=40)
    for place in places:
        place["bearing"] = round(calculate_bearing(
            req.latitude, req.longitude, place["lat"], place["lng"]), 1)
        place["direction"] = get_direction(place["bearing"])
        place["score"] = score_place(place, req.interests, req.radius_km, req.weights)
    sectors = analyze_directions(req.latitude, req.longitude, places)["sectors"]
    scores = score_directions(sectors, req.interests, places, req.weights)
    return {"sectors": sectors, "scores": scores,
            "top_directions": sorted(scores, key=scores.get, reverse=True)[:3]}


@app.post("/api/routes/recommend")
def route_recommend(req: RouteRecommendRequest) -> Dict:
    """활동 순서를 유지한 추천 경로를 최대 5개 반환한다."""
    data = req.dict()
    for location in (data['start_location'], data.get('search_center')):
        if location is not None and (location.get('latitude') is None or location.get('longitude') is None):
            raise HTTPException(status_code=422, detail='검색 기준점과 출발지의 좌표를 먼저 확인해 주세요.')
    routes = optimizer.recommend_routes(data)
    return {"routes": routes, "count": len(routes),
            "note": "직선거리 기반 추정이며 실제 경로 API로 검증되지 않았습니다."}


@app.post("/api/routes/network")
def route_network(req: NetworkRouteRequest) -> Dict:
    """요청한 구간만 이동수단별 실제 선형으로 조회한다."""
    return network_routes.lookup(req.mode, [leg.model_dump() for leg in req.legs])


@app.post("/api/schedule/validate")
def schedule_validate(req: ScheduleValidateRequest) -> Dict:
    """고정 약속시간과 활동 시간의 충돌을 검사한다."""
    return schedule.validate_schedule([a.dict() for a in req.activities], req.route)


@app.post("/api/report")
def build_report(req: ReportRequest) -> Dict:
    """선택한 경로의 기대치 리포트를 만든다."""
    return report.build_report(req.route, req.preferences)


@app.post("/api/trips")
def create_trip(trip: TripCreate) -> Dict:
    data = trip.dict()
    data["trip_id"] = data.get("trip_id") or f"trip_{uuid.uuid4().hex[:8]}"
    return history.save_trip(data)


@app.get("/api/trips")
def get_trips(user_id: str = "local_user") -> Dict:
    trips = history.list_trips(user_id)
    return {"trips": trips, "count": len(trips)}


@app.get("/api/trips/{trip_id}")
def get_trip(trip_id: str) -> Dict:
    trip = history.get_trip(trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
    return trip


@app.patch("/api/trips/{trip_id}")
def patch_trip(trip_id: str, payload: Dict) -> Dict:
    updated = history.update_trip(trip_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
    return updated


@app.delete("/api/trips/{trip_id}")
def remove_trip(trip_id: str) -> Dict:
    removed = history.delete_trip(trip_id)
    if not removed:
        raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
    return {"deleted": trip_id}


@app.post("/api/trips/{trip_id}/visits")
def create_visit(trip_id: str, visit: VisitCreate) -> Dict:
    if history.get_trip(trip_id) is None:
        raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
    return history.add_visit(trip_id, visit.dict())


@app.get("/api/trips/{trip_id}/visits")
def get_visits(trip_id: str) -> Dict:
    visits = history.list_visits(trip_id)
    return {"visits": visits, "count": len(visits)}


@app.delete("/api/trips/{trip_id}/visits/{visit_id}")
def remove_visit(trip_id: str, visit_id: int) -> Dict:
    if not history.delete_visit(trip_id, visit_id):
        raise HTTPException(status_code=404, detail="방문 기록을 찾을 수 없습니다.")
    return {"deleted": visit_id}


@app.get("/api/weather")
def get_weather(latitude: float = 37.5665, longitude: float = 126.9780, date: str | None = None) -> Dict:
    """날씨를 조회하고 실내/실외 권장 여부를 반환한다."""
    return weather.get_weather(latitude, longitude, date)


@app.post("/api/density/analyze")
def density_analyze(payload: Dict) -> Dict:
    """시간별 플랜과 전체 장소를 연관해 밀집도를 분석한다."""
    return density.analyze_density(
        float(payload.get("latitude", 37.5665)), float(payload.get("longitude", 126.9780)),
        payload.get("activities", []), float(payload.get("radius_km", 5.0)))


@app.post("/api/routes/options")
def route_options(payload: Dict) -> Dict:
    """구간별 이동수단 options를 교통비·혼잡도·시간 기준으로 정렬해 반환한다."""
    lat = float(payload.get("latitude", 37.5665)); lng = float(payload.get("longitude", 126.9780))
    radius = float(payload.get("radius_km", 5.0))
    result = optimizer.recommend_routes({
        "start_location": payload.get('start_location') or {"latitude": lat, "longitude": lng},
        "search_center": {"latitude": lat, "longitude": lng},
        "activities": payload.get("activities", []), "radius_km": radius,
        "transport_modes": payload.get("transport_modes", ["walking"])})
    options = []
    for route in result[:1]:
        for i, node in enumerate(route["nodes"]):
            crowd = node["place"].get("crowd_by_hour", {})
            avg_crowd = round(sum(crowd.values()) / len(crowd)) if crowd else 50
            modes = []
            for mode, speed, base, fare in (("walking", 5, 1, 0), ("bus", 20, 5, 1200), ("subway", 30, 6, 1400)):
                minutes = max(1, round(node["distance_km"] / speed * 60)) + base
                modes.append({"mode": mode, "minutes": minutes, "fare_krw": fare,
                              "crowd": avg_crowd, "score": round(100 - minutes * 0.5 - fare * 0.01 - avg_crowd * 0.2, 1)})
            modes.sort(key=lambda m: m["score"], reverse=True)
            options.append({"order": i + 1, "place": node["place"]["name"],
                            "distance_km": node["distance_km"], "modes": modes})
    return {"options": options, "note": "교통비·혼잡도는 샘플 데이터 기반 추정치입니다."}


@app.get("/api/safety/guide")
def get_safety_guide(category: str = "moving") -> Dict:
    return safety.safety_guide(category)


@app.get("/api/safety/riskzones")
def get_risk_zones(latitude: float = 37.5665, longitude: float = 126.9780,
                   radius_km: float = 5.0) -> Dict:
    return safety.risk_zones(latitude, longitude, radius_km)


@app.post("/api/safety/help")
def safety_help(payload: Dict) -> Dict:
    return safety.nearby_help(float(payload.get("latitude", 37.5665)),
                              float(payload.get("longitude", 126.9780)),
                              float(payload.get("radius_km", 5.0)))


@app.get("/api/kakao/check")
def kakao_check() -> Dict:
    """카카오맵 SDK 키/도메인 상태 진단 (키 값은 노출하지 않음)."""
    if not KAKAO_JAVASCRIPT_KEY:
        return {"ok": False, "status": "no_key", "message": "KAKAO_JAVASCRIPT_KEY가 비어 있습니다."}
    import urllib.error
    import urllib.request
    url = f"https://dapi.kakao.com/v2/maps/sdk.js?appkey={KAKAO_JAVASCRIPT_KEY}&autoload=false"
    req = urllib.request.Request(url, headers={"Referer": "http://127.0.0.1:9200"})
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            return {"ok": res.status == 200, "status": res.status,
                    "message": "SDK 로드 가능" if res.status == 200 else "SDK 응답 오류"}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "status": exc.code,
                "message": "401: JavaScript 키가 아니거나 등록 도메인이 일치하지 않습니다." if exc.code == 401 else "SDK 요청 실패"}
    except Exception as exc:
        return {"ok": False, "status": "network_error", "message": str(exc)[:120]}


@app.get("/api/config")
def frontend_config() -> Dict:
    """프론트 설정: 카카오맵 키 존재 여부만 노출한다."""
    # JavaScript 키는 도메인 제한 하에 브라우저에 노출되는 공개 키다.
    return {"kakao_javascript_key_configured": bool(KAKAO_JAVASCRIPT_KEY),
            "kakao_javascript_key": KAKAO_JAVASCRIPT_KEY,
            "context_analysis": CONTEXT_LLM_ENABLED,
            "verified_menu_lookup": bool(TOUR_API_KEY),
            "map_mode": "kakao" if KAKAO_JAVASCRIPT_KEY else "svg"}


@app.exception_handler(Exception)
async def error_handler(request, exc):  # pragma: no cover - 프레임워크 오류 처리
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# 정적 프론트엔드 (같은 오리진에서 API 호출)
if FRONTEND_DIR.exists():
    for folder in ("assets", "css", "js"):
        path = FRONTEND_DIR / folder
        if path.exists():
            app.mount(f"/{folder}", StaticFiles(directory=path), name=folder)


@app.get("/")
def index():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "frontend/index.html이 없습니다."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
