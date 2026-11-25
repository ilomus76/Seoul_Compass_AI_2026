"""여행 일정과 방문 기록 저장/조회."""
import json
from typing import Dict, List

from .database import get_connection, query_all


def save_trip(payload: Dict) -> Dict:
    """여행 일정을 저장한다(같은 trip_id면 갱신)."""
    start = payload.get("start_location", {})
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO trips (trip_id, user_id, date, start_lat, start_lng, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(trip_id) DO UPDATE SET
                user_id=excluded.user_id, date=excluded.date,
                start_lat=excluded.start_lat, start_lng=excluded.start_lng,
                payload=excluded.payload
        """, (
            payload["trip_id"], payload.get("user_id", "local_user"), payload["date"],
            start.get("latitude"), start.get("longitude"),
            json.dumps(payload, ensure_ascii=False),
        ))
        conn.commit()
    return payload


def list_trips(user_id: str = "local_user") -> List[Dict]:
    rows = query_all("SELECT payload FROM trips WHERE user_id=? ORDER BY date DESC", (user_id,))
    return [json.loads(r["payload"]) for r in rows]


def get_trip(trip_id: str) -> Dict | None:
    rows = query_all("SELECT payload FROM trips WHERE trip_id=?", (trip_id,))
    return json.loads(rows[0]["payload"]) if rows else None


def update_trip(trip_id: str, payload: Dict) -> Dict | None:
    existing = get_trip(trip_id)
    if existing is None:
        return None
    payload["trip_id"] = trip_id
    return save_trip(payload)


def delete_trip(trip_id: str) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM trips WHERE trip_id=?", (trip_id,))
        conn.execute("DELETE FROM visits WHERE trip_id=?", (trip_id,))
        conn.commit()
    return cur.rowcount > 0


def add_visit(trip_id: str, visit: Dict) -> Dict:
    """실제 방문 기록을 저장한다."""
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO visits (trip_id, place_name, category, planned_start,
                                actual_start, actual_end, status, actual_cost_krw, memo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            trip_id, visit["place_name"], visit.get("category"), visit.get("planned_start"),
            visit.get("actual_start"), visit.get("actual_end"), visit.get("status", "planned"),
            visit.get("actual_cost_krw"), visit.get("memo", ""),
        ))
        conn.commit()
    return visit


def list_visits(trip_id: str) -> List[Dict]:
    rows = query_all("SELECT * FROM visits WHERE trip_id=?", (trip_id,))
    return [dict(r) for r in rows]


def delete_visit(trip_id: str, visit_id: int) -> bool:
    """개별 방문 기록을 삭제한다."""
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM visits WHERE visit_id=? AND trip_id=?", (visit_id, trip_id))
        conn.commit()
    return cur.rowcount > 0
