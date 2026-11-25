"""API 입출력 스키마 (Pydantic 모델)."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class Location(BaseModel):
    type: str = "current_location"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    name: Optional[str] = None


class Activity(BaseModel):
    id: int
    category: str
    keyword: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)
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


class ParseResponse(BaseModel):
    start_location: Location
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
    activities: List[Activity]
    radius_km: float = 5.0
    transport_modes: List[str] = Field(default_factory=list)
    weights: Optional[Dict[str, float]] = None


class ScheduleValidateRequest(BaseModel):
    activities: List[Activity]
    route: Dict[str, Any]


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
