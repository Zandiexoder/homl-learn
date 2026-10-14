"""SQLite storage. One short-lived connection per call keeps threads and asyncio simple."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

from .config import get_config

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  questions TEXT NOT NULL DEFAULT '[]',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  uri TEXT,
  status TEXT NOT NULL,
  error TEXT,
  text TEXT,
  summary TEXT,
  selected INTEGER NOT NULL DEFAULT 1,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  page INTEGER,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS chunks_nb ON chunks(notebook_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '{}',
  options TEXT NOT NULL DEFAULT '{}',
  data TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
"""

JSON_COLUMNS = {"meta", "citations", "progress", "options", "data", "questions"}
LIST_COLUMNS = {"citations", "questions"}


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def now() -> float:
    return time.time()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_config().db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with tx() as conn:
        conn.executescript(SCHEMA)
        # Jobs that were running when the server stopped will never finish.
        conn.execute(
            "UPDATE artifacts SET status='failed', error='Interrupted by a server restart' "
            "WHERE status IN ('queued','running')"
        )
        conn.execute(
            "UPDATE sources SET status='failed', error='Interrupted by a server restart' "
            "WHERE status IN ('queued','processing')"
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out = dict(row)
    for key in JSON_COLUMNS & out.keys():
        out[key] = json.loads(out[key]) if out[key] else ([] if key in LIST_COLUMNS else {})
    out.pop("embedding", None)
    return out


def fetch_one(sql: str, params: tuple = ()) -> dict[str, Any] | None:
    with tx() as conn:
        return row_to_dict(conn.execute(sql, params).fetchone())


def fetch_all(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with tx() as conn:
        return [row_to_dict(r) for r in conn.execute(sql, params).fetchall()]  # type: ignore[misc]


def execute(sql: str, params: tuple = ()) -> None:
    with tx() as conn:
        conn.execute(sql, params)


def insert(table: str, values: dict[str, Any]) -> None:
    cols = list(values)
    encoded = [json.dumps(values[c]) if c in JSON_COLUMNS else values[c] for c in cols]
    with tx() as conn:
        conn.execute(
            f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            encoded,
        )


def update(table: str, row_id: str, values: dict[str, Any]) -> None:
    if not values:
        return
    cols = list(values)
    encoded = [json.dumps(values[c]) if c in JSON_COLUMNS else values[c] for c in cols]
    with tx() as conn:
        conn.execute(
            f"UPDATE {table} SET {','.join(f'{c}=?' for c in cols)} WHERE id=?",
            [*encoded, row_id],
        )


def get_setting(key: str, default: Any = None) -> Any:
    row = fetch_one("SELECT value FROM settings WHERE key=?", (key,))
    return json.loads(row["value"]) if row else default


def set_setting(key: str, value: Any) -> None:
    execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value)),
    )
