"""Cache middleware for NotebookLM API client.

Provides an optional caching layer that intercepts API calls to reduce
rate limiting and store query/response pairs for dataset building.

Supports two backends:
- LocalSQLiteBackend: Local SQLite database (default, no external deps)
- NullBackend: No-op backend (caching disabled)

The cache is opt-in and does not affect behavior when not configured.
"""

import hashlib
import json
import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class CacheConfig:
    """Configuration for the cache middleware.

    Attributes:
        enabled: Whether caching is enabled.
        db_path: Path to the SQLite database file. If None, uses
            ~/.notebooklm/cache.db.
        default_ttl: Default TTL in seconds for cached entries (300 = 5 min).
        query_ttl: TTL for chat query/response cache (86400 = 24 hours).
        notebook_ttl: TTL for notebook metadata cache (300 = 5 min).
        source_ttl: TTL for source content cache (3600 = 1 hour).
        log_queries: Whether to log all queries for dataset building.
    """

    enabled: bool = True
    db_path: Path | None = None
    default_ttl: int = 300
    query_ttl: int = 86400
    notebook_ttl: int = 300
    source_ttl: int = 3600
    log_queries: bool = True


@dataclass
class CacheEntry:
    """A cached value with metadata."""

    key: str
    value: Any
    created_at: float
    ttl: int
    hit_count: int = 0

    @property
    def is_expired(self) -> bool:
        """Check if the cache entry has expired."""
        if self.ttl <= 0:
            return False  # TTL 0 = never expires
        return (time.time() - self.created_at) > self.ttl


class CacheBackend:
    """Abstract cache backend interface."""

    def get(self, key: str) -> CacheEntry | None:
        """Get a cached entry by key."""
        raise NotImplementedError

    def set(self, key: str, value: Any, ttl: int = 300) -> None:
        """Store a value in the cache."""
        raise NotImplementedError

    def delete(self, key: str) -> bool:
        """Delete a cached entry."""
        raise NotImplementedError

    def invalidate_prefix(self, prefix: str) -> int:
        """Delete all entries matching a key prefix."""
        raise NotImplementedError

    def store_query(
        self,
        notebook_id: str,
        query_text: str,
        response_text: str,
        *,
        citations: str | None = None,
        conversation_id: str | None = None,
        turn_number: int = 1,
        source_ids: list[str] | None = None,
        latency_ms: int | None = None,
    ) -> None:
        """Store a query/response pair for dataset building."""
        raise NotImplementedError

    def log_query(
        self,
        notebook_id: str,
        query_text: str,
        *,
        response_length: int = 0,
        citation_count: int = 0,
        source_count: int = 0,
        latency_ms: int = 0,
        cache_hit: bool = False,
        agent_id: str | None = None,
        session_id: str | None = None,
    ) -> None:
        """Log a query for analytics (append-only)."""
        raise NotImplementedError

    def close(self) -> None:
        """Close the backend."""
        pass


class NullBackend(CacheBackend):
    """No-op backend when caching is disabled."""

    def get(self, key: str) -> CacheEntry | None:
        return None

    def set(self, key: str, value: Any, ttl: int = 300) -> None:
        pass

    def delete(self, key: str) -> bool:
        return False

    def invalidate_prefix(self, prefix: str) -> int:
        return 0

    def store_query(
        self, notebook_id: str, query_text: str, response_text: str, **kwargs: Any
    ) -> None:
        pass

    def log_query(self, notebook_id: str, query_text: str, **kwargs: Any) -> None:
        pass


class LocalSQLiteBackend(CacheBackend):
    """SQLite-based cache backend for local use.

    Creates tables matching the D1 schema so data can be migrated
    to Cloudflare D1 when running via the worker.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path))
        self._conn.row_factory = sqlite3.Row
        self._init_tables()

    def _init_tables(self) -> None:
        """Create cache tables if they don't exist."""
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS nlm_cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at REAL NOT NULL,
                ttl INTEGER NOT NULL DEFAULT 300,
                hit_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS nlm_query_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                notebook_id TEXT NOT NULL,
                query_hash TEXT NOT NULL,
                query_text TEXT NOT NULL,
                response_text TEXT NOT NULL,
                response_citations TEXT,
                conversation_id TEXT,
                turn_number INTEGER DEFAULT 1,
                source_ids TEXT,
                model_context TEXT,
                latency_ms INTEGER,
                created_at REAL NOT NULL,
                expires_at REAL,
                hit_count INTEGER DEFAULT 0,
                UNIQUE(notebook_id, query_hash)
            );

            CREATE TABLE IF NOT EXISTS nlm_query_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                notebook_id TEXT NOT NULL,
                query_text TEXT NOT NULL,
                response_length INTEGER,
                citation_count INTEGER,
                source_count INTEGER,
                latency_ms INTEGER,
                cache_hit INTEGER DEFAULT 0,
                agent_id TEXT,
                session_id TEXT,
                created_at REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cache_key ON nlm_cache(key);
            CREATE INDEX IF NOT EXISTS idx_qc_notebook ON nlm_query_cache(notebook_id);
            CREATE INDEX IF NOT EXISTS idx_qc_hash ON nlm_query_cache(query_hash);
        """)

    def get(self, key: str) -> CacheEntry | None:
        """Get a cached entry by key."""
        row = self._conn.execute(
            "SELECT key, value, created_at, ttl, hit_count FROM nlm_cache WHERE key = ?",
            (key,),
        ).fetchone()
        if row is None:
            return None

        entry = CacheEntry(
            key=row["key"],
            value=json.loads(row["value"]),
            created_at=row["created_at"],
            ttl=row["ttl"],
            hit_count=row["hit_count"],
        )

        if entry.is_expired:
            self.delete(key)
            return None

        # Increment hit count
        self._conn.execute(
            "UPDATE nlm_cache SET hit_count = hit_count + 1 WHERE key = ?",
            (key,),
        )
        self._conn.commit()
        return entry

    def set(self, key: str, value: Any, ttl: int = 300) -> None:
        """Store a value in the cache."""
        self._conn.execute(
            """INSERT OR REPLACE INTO nlm_cache (key, value, created_at, ttl, hit_count)
               VALUES (?, ?, ?, ?, 0)""",
            (key, json.dumps(value), time.time(), ttl),
        )
        self._conn.commit()

    def delete(self, key: str) -> bool:
        """Delete a cached entry."""
        cursor = self._conn.execute("DELETE FROM nlm_cache WHERE key = ?", (key,))
        self._conn.commit()
        return cursor.rowcount > 0

    def invalidate_prefix(self, prefix: str) -> int:
        """Delete all entries matching a key prefix."""
        cursor = self._conn.execute(
            "DELETE FROM nlm_cache WHERE key LIKE ?",
            (f"{prefix}%",),
        )
        self._conn.commit()
        return cursor.rowcount

    def store_query(
        self,
        notebook_id: str,
        query_text: str,
        response_text: str,
        *,
        citations: str | None = None,
        conversation_id: str | None = None,
        turn_number: int = 1,
        source_ids: list[str] | None = None,
        latency_ms: int | None = None,
    ) -> None:
        """Store a query/response pair."""
        query_hash = _normalize_and_hash(query_text)
        source_ids_json = json.dumps(source_ids) if source_ids else None

        self._conn.execute(
            """INSERT OR REPLACE INTO nlm_query_cache
               (notebook_id, query_hash, query_text, response_text,
                response_citations, conversation_id, turn_number,
                source_ids, latency_ms, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                notebook_id,
                query_hash,
                query_text,
                response_text,
                citations,
                conversation_id,
                turn_number,
                source_ids_json,
                latency_ms,
                time.time(),
            ),
        )
        self._conn.commit()

    def get_cached_query(self, notebook_id: str, query_text: str) -> str | None:
        """Look up a cached query response."""
        query_hash = _normalize_and_hash(query_text)
        row = self._conn.execute(
            """SELECT response_text, created_at FROM nlm_query_cache
               WHERE notebook_id = ? AND query_hash = ?""",
            (notebook_id, query_hash),
        ).fetchone()

        if row is None:
            return None

        # Update hit count
        self._conn.execute(
            """UPDATE nlm_query_cache SET hit_count = hit_count + 1
               WHERE notebook_id = ? AND query_hash = ?""",
            (notebook_id, query_hash),
        )
        self._conn.commit()
        return row["response_text"]

    def log_query(
        self,
        notebook_id: str,
        query_text: str,
        *,
        response_length: int = 0,
        citation_count: int = 0,
        source_count: int = 0,
        latency_ms: int = 0,
        cache_hit: bool = False,
        agent_id: str | None = None,
        session_id: str | None = None,
    ) -> None:
        """Log a query for analytics."""
        self._conn.execute(
            """INSERT INTO nlm_query_log
               (notebook_id, query_text, response_length, citation_count,
                source_count, latency_ms, cache_hit, agent_id, session_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                notebook_id,
                query_text,
                response_length,
                citation_count,
                source_count,
                latency_ms,
                1 if cache_hit else 0,
                agent_id,
                session_id,
                time.time(),
            ),
        )
        self._conn.commit()

    def close(self) -> None:
        """Close the SQLite connection."""
        if self._conn:
            self._conn.close()


class CacheMiddleware:
    """Optional cache layer that wraps API calls.

    Usage:
        config = CacheConfig(enabled=True)
        cache = CacheMiddleware(config)

        # Wrap a fetch operation
        result = cache.get_or_fetch(
            cache_key="nlm:notebooks:list",
            ttl=300,
            fetch_fn=lambda: client.notebooks.list()
        )

        # Store a query/response pair
        cache.store_query(notebook_id, question, answer)
    """

    def __init__(self, config: CacheConfig | None = None) -> None:
        if config is None or not config.enabled:
            self._backend: CacheBackend = NullBackend()
            self._config = config or CacheConfig(enabled=False)
        else:
            self._config = config
            db_path = config.db_path
            if db_path is None:
                from .paths import get_home_dir

                db_path = get_home_dir(create=True) / "cache.db"
            self._backend = LocalSQLiteBackend(db_path)

    @property
    def config(self) -> CacheConfig:
        """Get the cache configuration."""
        return self._config

    @property
    def backend(self) -> CacheBackend:
        """Get the cache backend."""
        return self._backend

    def get_or_fetch_sync(
        self,
        cache_key: str,
        ttl: int,
        fetch_fn: Any,
    ) -> Any:
        """Check cache synchronously, return if hit.

        For async fetch operations, use this to check cache first,
        then call fetch_fn only on miss.

        Returns:
            Tuple of (cached_value_or_None, was_cache_hit).
        """
        entry = self._backend.get(cache_key)
        if entry is not None:
            logger.debug("Cache HIT: %s", cache_key)
            return entry.value, True
        return None, False

    def store(self, cache_key: str, value: Any, ttl: int) -> None:
        """Store a value in the cache."""
        self._backend.set(cache_key, value, ttl=ttl)
        logger.debug("Cache STORE: %s (ttl=%ds)", cache_key, ttl)

    def invalidate(self, cache_key: str) -> None:
        """Invalidate a specific cache key."""
        self._backend.delete(cache_key)
        logger.debug("Cache INVALIDATE: %s", cache_key)

    def invalidate_notebook(self, notebook_id: str) -> None:
        """Invalidate all cache entries for a notebook."""
        count = self._backend.invalidate_prefix(f"nlm:notebook:{notebook_id}")
        self._backend.delete("nlm:notebooks:list")
        logger.debug("Cache INVALIDATE notebook %s (%d entries)", notebook_id, count + 1)

    def store_query(
        self,
        notebook_id: str,
        query_text: str,
        response_text: str,
        *,
        citations: str | None = None,
        conversation_id: str | None = None,
        turn_number: int = 1,
        source_ids: list[str] | None = None,
        latency_ms: int | None = None,
    ) -> None:
        """Store a query/response pair for caching and dataset building."""
        self._backend.store_query(
            notebook_id,
            query_text,
            response_text,
            citations=citations,
            conversation_id=conversation_id,
            turn_number=turn_number,
            source_ids=source_ids,
            latency_ms=latency_ms,
        )

    def log_query(
        self,
        notebook_id: str,
        query_text: str,
        *,
        response_length: int = 0,
        citation_count: int = 0,
        source_count: int = 0,
        latency_ms: int = 0,
        cache_hit: bool = False,
        agent_id: str | None = None,
        session_id: str | None = None,
    ) -> None:
        """Log a query for analytics (append-only)."""
        if self._config.log_queries:
            self._backend.log_query(
                notebook_id,
                query_text,
                response_length=response_length,
                citation_count=citation_count,
                source_count=source_count,
                latency_ms=latency_ms,
                cache_hit=cache_hit,
                agent_id=agent_id,
                session_id=session_id,
            )

    def close(self) -> None:
        """Close the cache backend."""
        self._backend.close()


def _normalize_and_hash(query: str) -> str:
    """Normalize a query string and return its SHA256 hash.

    Normalization: lowercase, strip whitespace, collapse multiple spaces.
    """
    normalized = " ".join(query.lower().strip().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
