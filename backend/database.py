"""SQLite 연결 및 테이블 초기화 (MVP 1차)."""
import sqlite3
from typing import List

from .config import DB_PATH


def get_connection() -> sqlite3.Connection:
    """DB 연결을 열고 테이블이 없으면 생성한다."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trips (
            trip_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            date TEXT NOT NULL,
            start_lat REAL,
            start_lng REAL,
            payload TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS visits (
            visit_id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id TEXT NOT NULL,
            place_name TEXT NOT NULL,
            category TEXT,
            planned_start TEXT,
            actual_start TEXT,
            actual_end TEXT,
            status TEXT DEFAULT 'planned',
            actual_cost_krw INTEGER,
            memo TEXT DEFAULT ''
        )
    """)
    conn.commit()
    return conn


def query_all(sql: str, params: tuple = ()) -> List[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(sql, params).fetchall()
