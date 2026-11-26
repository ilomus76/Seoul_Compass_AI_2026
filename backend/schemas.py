"""API 입출력 스키마 (Pydantic 모델)."""
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class Location(BaseModel):
    type: str = "current_location"
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    name: Optional[str] = None
    source: Optional[str] = None
    resolved_name: Optional[str] = None
    address: Optional[str] = None
    place_id: Optional[str] = None
    place_url: Optional[str] = None
    phone: Optional[str] = None
    provider_category: Optional[str] = None


class Activity(BaseModel):
    id: int
    category: str
    keyword: Optional[str] = None
    request_term: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)
    required_keywords: List[str] = Field(default_factory=list)
    search_query: Optional[str] = None
    venue_kind: Optional[str] = None
    menu_terms: List[str] = Field(default_factory=list)
    duration_estimated: bool = True
    duration_source: Optional[str] = None
    location: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    earliest_start: Optional[str] = None
    latest_end: Optional[str] = None
    preferred_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    fixed_location: bool = False
    fixed_time: bool = False
    required: bool = True


class ParseRequest(BaseModel):
    text: str
    fallback_location: Optional[Location] = None
    fallback_radius_km: Optional[float] = Field(default=None, gt=0)
    analysis_mode: Literal['context', 'legacy'] | None = None


class ParseResponse(BaseModel):
    start_location: Location
    search_center: Optional[Location] = None
    location_context: Dict[str, Any] = Field(default_factory=dict)
    travel_date: Optional[str] = None
    radius_km: float = 5.0
    transport_modes: List[str] = Field(default_factory=list)
    activities: List[Activity] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class SearchRequest(BaseModel):
    latitude: float = 37.5665
    longitude: float = 126.9780
    radius_km: float = 5.0
    category: Optional[str] = None
    keyword: Optional[str] = None
    limit: int = 5


class DirectionAnalyzeRequest(BaseModel):
    latitude: float = 37.5665
    longitude: float = 126.9780
    radius_km: float = 5.0
    weights: Optional[Dict[str, float]] = None
    interests: List[str] = Field(default_factory=list)


class RouteRecommendRequest(BaseModel):
    start_location: Location
    search_center: Optional[Location] = None
    activities: List[Activity]
    radius_km: float = 5.0
    transport_modes: List[str] = Field(default_factory=list)
    weights: Optional[Dict[str, float]] = None


class RegionRecommendRequest(BaseModel):
    region_scope: Optional[str] = '서울'
    search_center: Optional[Location] = None
    start_location: Optional[Location] = None
    return_location: Optional[Location] = None
    destination_name: Optional[str] = None
    current_location_requested: bool = False
    departure_time: Optional[str] = None
    travel_date: Optional[str] = None
    activities: List[Activity]
    radius_km: float = Field(default=5, gt=0, le=10)
    transport_modes: List[str] = Field(default_factory=lambda: ['walking'])
    contextual: bool = False
    requested_bearing: Optional[float] = Field(default=None, ge=0, lt=360)
    route_goal: Optional[Location] = None


class ScheduleValidateRequest(BaseModel):
    activities: List[Activity]
    route: Dict[str, Any]


class NetworkPoint(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class NetworkLeg(BaseModel):
    index: int = Field(ge=0, le=30)
    start: NetworkPoint
    end: NetworkPoint


class NetworkRouteRequest(BaseModel):
    mode: Literal['walking', 'cycling', 'driving', 'subway', 'train']
    legs: List[NetworkLeg] = Field(min_length=1, max_length=20)


class ReportRequest(BaseModel):
    route: Dict[str, Any]
    preferences: Dict[str, Any] = Field(default_factory=dict)


class TripCreate(BaseModel):
    trip_id: Optional[str] = None
    user_id: str = "local_user"
    date: str
    start_location: Location
    activities: List[Activity] = Field(default_factory=list)
    routes: List[Dict[str, Any]] = Field(default_factory=list)


class VisitCreate(BaseModel):
    place_name: str
    category: Optional[str] = None
    planned_start: Optional[str] = None
    actual_start: Optional[str] = None
    actual_end: Optional[str] = None
    status: str = "planned"
    actual_cost_krw: Optional[int] = None
    memo: str = ""
