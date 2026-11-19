"""Relational SQLite database engine & repository for MoodSync."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "moodsync.db"
SCHEMA_PATH = BASE_DIR / "sql" / "sqlite_schema.sql"

MOOD_LABELS_TR = {
    "positive": "Mutlu & Enerjik",
    "neutral": "Dingin & Dengeli",
    "negative": "Üzgün & Melankolik",
}

EMOTION_FULL_LABELS_TR = {
    "happy": "Mutlu & Enerjik",
    "surprise": "Heyecanlı & Enerjik",
    "neutral": "Dingin & Dengeli",
    "sad": "Üzgün & Melankolik",
    "angry": "Kızgın & Deşarj",
}

ANGRY_KEYWORDS = (
    "rock",
    "rap",
    "hip-hop",
    "hip hop",
    "metal",
    "alternat",
    "punk",
    "electronic",
    "angry_rock",
    "duman",
    "şebnem ferah",
    "sebnem ferah",
    "manga",
    "mor ve ötesi",
    "ceza",
    "sagopa",
    "hayko",
    "pentagram",
    "teoman",
    "athena",
    "radiohead",
    "linkin park",
    "eminem",
    "arctic monkeys",
    "imagine dragons",
    "nirvana",
    "muse",
)

SAD_KEYWORDS = (
    "acoustic",
    "akustik",
    "slow",
    "ballad",
    "balad",
    "singer",
    "classical",
    "piano",
    "piyano",
    "sezen aksu",
    "dedublüman",
    "cem adrian",
    "emir can",
    "semicenk",
    "madrigal",
    "canozan",
    "adele",
    "billie eilish",
    "lana del rey",
    "cigarettes after sex",
    "yiruma",
    "sufjan",
    "hozier",
)

DEFAULT_GENRES = [
    ("pop", "Pop", "positive"),
    ("turkce-pop", "Türkçe Pop", "positive"),
    ("dance", "Dance & Elektronik", "positive"),
    ("funk-soul", "Funk & Soul", "positive"),
    ("indie-rock", "Alternatif & Indie", "neutral"),
    ("anadolu-rock", "Anadolu Rock", "neutral"),
    ("chill-electronic", "Chill & Downtempo", "neutral"),
    ("jazz-lofi", "Caz & Lo-Fi", "neutral"),
    ("classical-piano", "Piyano & Modern Klasik", "negative"),
    ("acoustic-ballad", "Akustik & Balad", "negative"),
    ("turkce-alternatif", "Türkçe Alternatif", "negative"),
    ("ambient", "Ambient & Film Müziği", "negative"),
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def hash_password(password: str, iterations: int = 600_000) -> str:
    """PBKDF2-HMAC-SHA256 format identical to C# Passwords.Hash (600000.<salt>.<hash>)."""
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
    return f"{iterations}.{base64.b64encode(salt).decode('ascii')}.{base64.b64encode(derived).decode('ascii')}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        parts = encoded.split(".")
        if len(parts) != 3:
            return False
        iterations = int(parts[0])
        if iterations < 100_000 or iterations > 1_000_000:
            return False
        salt = base64.b64decode(parts[1])
        expected = base64.b64decode(parts[2])
        if len(salt) != 16 or len(expected) != 32:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
        return hmac.compare_digest(expected, actual)
    except Exception:
        return False


class Database:
    """Thread-safe SQLite repository with WAL concurrency and normalized tables."""

    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        return conn

    def _init_schema(self) -> None:
        schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
        with self._write_lock, self._connect() as conn:
            conn.executescript(schema_sql)
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(scan_sessions)").fetchall()}
            if "emotion" not in cols:
                conn.execute("ALTER TABLE scan_sessions ADD COLUMN emotion TEXT")
            conn.executemany(
                "INSERT OR IGNORE INTO genres(slug, name_tr, default_mood) VALUES (?, ?, ?)",
                DEFAULT_GENRES,
            )
            conn.commit()

    # ───────────────────────── Users & Auth ─────────────────────────

    def register_user(
        self,
        username: str,
        password: str,
        display_name: str = "",
        email: str | None = None,
    ) -> dict[str, Any]:
        clean_user = username.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.\-]{3,32}", clean_user):
            raise ValueError("Kullanıcı adı 3–32 karakter olmalı ve yalnızca harf, rakam, nokta veya alt çizgi içermelidir.")
        if len(password) < 6:
            raise ValueError("Şifre en az 6 karakter olmalıdır.")
        clean_name = (display_name.strip() or clean_user)[:80]
        clean_email = email.strip().lower() if email and email.strip() else None
        hue = random.choice([14, 24, 34, 168, 186, 208])
        pw_hash = hash_password(password)

        with self._write_lock, self._connect() as conn:
            try:
                cur = conn.execute(
                    """
                    INSERT INTO users (username, display_name, email, password_hash, avatar_hue, last_login_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (clean_user, clean_name, clean_email, pw_hash, hue, utc_now_iso()),
                )
                user_id = int(cur.lastrowid)
                conn.commit()
            except sqlite3.IntegrityError as exc:
                msg = str(exc).lower()
                if "username" in msg:
                    raise ValueError("Bu kullanıcı adı zaten alınmış. Başka bir kullanıcı adı seçin.") from exc
                raise ValueError("Bu e-posta adresi zaten kayıtlı.") from exc

        return self.get_user_by_id(user_id)  # type: ignore[return-value]

    def authenticate_user(self, username_or_email: str, password: str) -> dict[str, Any] | None:
        ident = username_or_email.strip()
        if not ident or not password:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, username, display_name, email, password_hash, avatar_hue, preferred_region, created_at
                FROM users
                WHERE username = ? COLLATE NOCASE OR (email IS NOT NULL AND email = ? COLLATE NOCASE)
                """,
                (ident, ident),
            ).fetchone()
        if row is None or not verify_password(password, row["password_hash"]):
            return None
        with self._write_lock, self._connect() as conn:
            conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (utc_now_iso(), row["id"]))
            conn.commit()
        return self._format_user(row)

    def create_auth_session(self, user_id: int, device_info: str = "") -> str:
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._write_lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO auth_sessions (token, user_id, device_info, expires_at) VALUES (?, ?, ?, ?)",
                (token, user_id, device_info[:180], expires),
            )
            conn.commit()
        return token

    def get_user_by_token(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        now_iso = utc_now_iso()
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id, u.username, u.display_name, u.email, u.avatar_hue, u.preferred_region, u.created_at
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = ? AND s.expires_at > ?
                """,
                (token, now_iso),
            ).fetchone()
        return self._format_user(row) if row else None

    def delete_auth_session(self, token: str | None) -> None:
        if not token:
            return
        with self._write_lock, self._connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
            conn.commit()

    def get_user_by_id(self, user_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, display_name, email, avatar_hue, preferred_region, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        return self._format_user(row) if row else None

    @staticmethod
    def _format_user(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "username": row["username"],
            "displayName": row["display_name"],
            "email": row["email"],
            "avatarHue": row["avatar_hue"],
            "preferredRegion": row["preferred_region"],
            "createdAt": row["created_at"],
        }

    # ───────────────────────── Tracks & Music Catalog ─────────────────────────

    def count_tracks(self) -> dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
            by_mood_rows = conn.execute("SELECT mood, COUNT(*) AS cnt FROM tracks GROUP BY mood").fetchall()
            by_lang_rows = conn.execute("SELECT language, COUNT(*) AS cnt FROM tracks GROUP BY language").fetchall()
        return {
            "total": int(total),
            "byMood": {r["mood"]: int(r["cnt"]) for r in by_mood_rows},
            "byLanguage": {r["language"]: int(r["cnt"]) for r in by_lang_rows},
        }

    def upsert_tracks(self, tracks: list[dict[str, Any]]) -> int:
        if not tracks:
            return 0
        inserted_or_updated = 0
        with self._write_lock, self._connect() as conn:
            for t in tracks:
                title = (t.get("title") or "").strip()
                artist = (t.get("artist") or "").strip()
                if not title or not artist:
                    continue
                yt_url = t.get("youtube_url") or (
                    f"https://www.youtube.com/results?search_query={quote_plus(f'{artist} {title}')}"
                )
                conn.execute(
                    """
                    INSERT INTO tracks (
                        external_source, external_id, title, artist, album, genre, mood,
                        energy_tag, language, artwork_url, preview_url, store_url, youtube_url,
                        duration_ms, release_year, popularity
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(external_source, external_id) DO UPDATE SET
                        artwork_url = CASE WHEN excluded.artwork_url != '' THEN excluded.artwork_url ELSE tracks.artwork_url END,
                        preview_url = CASE WHEN excluded.preview_url != '' THEN excluded.preview_url ELSE tracks.preview_url END,
                        store_url = CASE WHEN excluded.store_url != '' THEN excluded.store_url ELSE tracks.store_url END,
                        popularity = MAX(tracks.popularity, excluded.popularity)
                    """,
                    (
                        t.get("external_source", "itunes"),
                        str(t["external_id"]),
                        title[:200],
                        artist[:160],
                        (t.get("album") or "")[:200],
                        (t.get("genre") or "Pop")[:80],
                        t["mood"],
                        (t.get("energy_tag") or "balanced")[:30],
                        t.get("language", "global"),
                        t.get("artwork_url", ""),
                        t.get("preview_url", ""),
                        t.get("store_url", ""),
                        yt_url,
                        int(t.get("duration_ms") or 0),
                        t.get("release_year"),
                        int(t.get("popularity") or 60),
                    ),
                )
                inserted_or_updated += 1
            conn.commit()
        return inserted_or_updated

    def query_tracks(
        self,
        user_id: int | None = None,
        mood: str | None = None,
        language: str | None = None,
        genre: str | None = None,
        search: str | None = None,
        favorites_only: bool = False,
        limit: int = 60,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        clauses = ["1=1"]
        params: list[Any] = []
        if mood in ("positive", "neutral", "negative"):
            clauses.append("t.mood = ?")
            params.append(mood)
        if language in ("tr", "global"):
            clauses.append("t.language = ?")
            params.append(language)
        if genre and genre != "all":
            clauses.append("LOWER(t.genre) = LOWER(?)")
            params.append(genre)
        if search and search.strip():
            q = f"%{search.strip()}%"
            clauses.append("(t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ? OR t.genre LIKE ?)")
            params.extend([q, q, q, q])
        if favorites_only and user_id is not None:
            clauses.append("f.user_id IS NOT NULL")

        where_sql = " AND ".join(clauses)
        uid = user_id or -1
        sql = f"""
            SELECT t.*,
                   CASE WHEN f.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
            FROM tracks t
            LEFT JOIN user_favorites f ON f.track_id = t.id AND f.user_id = ?
            WHERE {where_sql}
            ORDER BY t.popularity DESC, t.id DESC
            LIMIT ? OFFSET ?
        """
        with self._connect() as conn:
            rows = conn.execute(sql, [uid, *params, max(1, min(limit, 200)), max(0, offset)]).fetchall()
        return [self._format_track(r) for r in rows]

    def list_distinct_genres(self) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT genre, COUNT(*) AS cnt FROM tracks GROUP BY genre HAVING cnt >= 2 ORDER BY cnt DESC LIMIT 20"
            ).fetchall()
        return [r["genre"] for r in rows]

    def select_playlist_for_mood(
        self,
        mood: str,
        user_id: int | None = None,
        count: int = 16,
        language_filter: str = "all",
        emotion: str | None = None,
    ) -> list[dict[str, Any]]:
        """Builds a diverse, mood-matched playlist weighted by user genre preferences, fine-grained emotion, and balanced TR/Global hits."""
        uid = user_id or -1
        with self._connect() as conn:
            prefs_rows = conn.execute(
                "SELECT genre, weight FROM user_genre_preferences WHERE user_id = ? AND mood = ?",
                (uid, mood),
            ).fetchall()
            genre_weights = {r["genre"].lower(): float(r["weight"]) for r in prefs_rows}

            mood_clause = "t.mood IN ('negative', 'positive')" if emotion == "angry" else "t.mood = ?"
            params: list[Any] = [uid] if emotion == "angry" else [uid, mood]
            lang_clause = ""
            if language_filter in ("tr", "global"):
                lang_clause = "AND t.language = ?"
                params.append(language_filter)

            candidates = conn.execute(
                f"""
                SELECT t.*,
                       CASE WHEN f.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
                FROM tracks t
                LEFT JOIN user_favorites f ON f.track_id = t.id AND f.user_id = ?
                WHERE {mood_clause} {lang_clause}
                """,
                params,
            ).fetchall()

        if not candidates:
            return []

        scored: list[tuple[float, sqlite3.Row]] = []
        for row in candidates:
            genre_lower = (row["genre"] or "").lower()
            artist_lower = (row["artist"] or "").lower()
            tag_lower = (row["energy_tag"] or "").lower()
            hay = f"{genre_lower} {artist_lower} {tag_lower}"

            g_weight = genre_weights.get(genre_lower, 1.0)
            has_preview_bonus = 0.25 if row["preview_url"] else 0.0
            fav_bonus = 0.18 if row["is_favorite"] else 0.0

            emotion_bonus = 0.0
            if emotion == "angry":
                if tag_lower == "angry_rock":
                    emotion_bonus += 1.35
                elif any(kw in hay for kw in ANGRY_KEYWORDS):
                    emotion_bonus += 0.95
                elif row["mood"] == "positive":
                    emotion_bonus -= 0.45
            elif emotion == "sad":
                if any(kw in hay for kw in SAD_KEYWORDS):
                    emotion_bonus += 0.75
                if tag_lower == "angry_rock":
                    emotion_bonus -= 0.80

            jitter = random.uniform(0.0, 0.48)
            score = (float(row["popularity"]) / 100.0) * g_weight + has_preview_bonus + fav_bonus + emotion_bonus + jitter
            scored.append((score, row))

        scored.sort(key=lambda item: item[0], reverse=True)

        # Enforce artist diversity (max 2 songs per artist) and balanced TR/Global mix when 'all'
        selected: list[dict[str, Any]] = []
        artist_counts: dict[str, int] = {}
        tr_pool = [r for _, r in scored if r["language"] == "tr"]
        gl_pool = [r for _, r in scored if r["language"] != "tr"]

        if language_filter == "all" and tr_pool and gl_pool:
            interleaved: list[sqlite3.Row] = []
            max_len = max(len(tr_pool), len(gl_pool))
            for i in range(max_len):
                if i < len(tr_pool):
                    interleaved.append(tr_pool[i])
                if i < len(gl_pool):
                    interleaved.append(gl_pool[i])
            ordered_rows = interleaved
        else:
            ordered_rows = [r for _, r in scored]

        for row in ordered_rows:
            artist_key = row["artist"].strip().lower()
            if artist_counts.get(artist_key, 0) >= 2:
                continue
            artist_counts[artist_key] = artist_counts.get(artist_key, 0) + 1
            selected.append(self._format_track(row))
            if len(selected) >= count:
                break

        return selected

    def toggle_favorite(self, user_id: int, track_id: int) -> bool:
        with self._write_lock, self._connect() as conn:
            track = conn.execute("SELECT genre, mood FROM tracks WHERE id = ?", (track_id,)).fetchone()
            if not track:
                raise ValueError("Şarkı bulunamadı.")
            existing = conn.execute(
                "SELECT 1 FROM user_favorites WHERE user_id = ? AND track_id = ?",
                (user_id, track_id),
            ).fetchone()
            if existing:
                conn.execute("DELETE FROM user_favorites WHERE user_id = ? AND track_id = ?", (user_id, track_id))
                is_fav = False
            else:
                conn.execute("INSERT INTO user_favorites (user_id, track_id) VALUES (?, ?)", (user_id, track_id))
                conn.execute(
                    """
                    INSERT INTO user_genre_preferences (user_id, genre, mood, weight, updated_at)
                    VALUES (?, ?, ?, 1.35, ?)
                    ON CONFLICT(user_id, genre, mood) DO UPDATE SET
                        weight = MIN(3.0, user_genre_preferences.weight + 0.25),
                        updated_at = excluded.updated_at
                    """,
                    (user_id, track["genre"], track["mood"], utc_now_iso()),
                )
                is_fav = True
            conn.commit()
        return is_fav

    def increment_play(self, track_id: int, user_id: int | None = None) -> None:
        with self._write_lock, self._connect() as conn:
            conn.execute("UPDATE tracks SET play_count = play_count + 1 WHERE id = ?", (track_id,))
            if user_id is not None:
                track = conn.execute("SELECT genre, mood FROM tracks WHERE id = ?", (track_id,)).fetchone()
                if track:
                    conn.execute(
                        """
                        INSERT INTO user_genre_preferences (user_id, genre, mood, weight, updated_at)
                        VALUES (?, ?, ?, 1.15, ?)
                        ON CONFLICT(user_id, genre, mood) DO UPDATE SET
                            weight = MIN(3.0, user_genre_preferences.weight + 0.08),
                            updated_at = excluded.updated_at
                        """,
                        (user_id, track["genre"], track["mood"], utc_now_iso()),
                    )
            conn.commit()

    def get_track_by_id(self, track_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT *, 0 AS is_favorite FROM tracks WHERE id = ?", (track_id,)).fetchone()
        return self._format_track(row) if row else None

    @staticmethod
    def _format_track(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "source": row["external_source"],
            "externalId": row["external_id"],
            "title": row["title"],
            "artist": row["artist"],
            "album": row["album"],
            "genre": row["genre"],
            "mood": row["mood"],
            "moodLabel": MOOD_LABELS_TR.get(row["mood"], row["mood"]),
            "energyTag": row["energy_tag"],
            "language": row["language"],
            "artworkUrl": row["artwork_url"],
            "previewUrl": row["preview_url"],
            "storeUrl": row["store_url"],
            "youtubeUrl": row["youtube_url"],
            "durationMs": row["duration_ms"],
            "releaseYear": row["release_year"],
            "popularity": row["popularity"],
            "playCount": row["play_count"],
            "isFavorite": bool(row["is_favorite"]),
        }

    # ───────────────────────── Scan Sessions (History) ─────────────────────────

    def create_scan_session(
        self,
        user_id: int,
        mood: str,
        confidence: float,
        scores: dict[str, float],
        face_box: list[float] | None,
        snapshot_data_url: str | None,
        capture_source: str,
        device_label: str,
        track_ids: list[int],
        created_at: str | None = None,
        emotion: str | None = None,
    ) -> dict[str, Any]:
        ts = created_at or utc_now_iso()
        clean_emotion = emotion if emotion in ("happy", "surprise", "neutral", "sad", "angry") else None
        with self._write_lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO scan_sessions (
                    user_id, mood, emotion, confidence, scores_json, face_box_json,
                    snapshot_data_url, capture_source, device_label, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    mood,
                    clean_emotion,
                    round(float(confidence), 4),
                    json.dumps(scores),
                    json.dumps(face_box) if face_box else None,
                    snapshot_data_url,
                    capture_source,
                    device_label[:80],
                    ts,
                ),
            )
            session_id = int(cur.lastrowid)
            for idx, tid in enumerate(track_ids):
                conn.execute(
                    "INSERT OR IGNORE INTO scan_session_tracks (session_id, track_id, position) VALUES (?, ?, ?)",
                    (session_id, tid, idx),
                )
            conn.commit()
        return self.get_scan_session(session_id, user_id)  # type: ignore[return-value]

    def list_scan_sessions(self, user_id: int, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT s.*,
                       (SELECT COUNT(*) FROM scan_session_tracks st WHERE st.session_id = s.id) AS track_count
                FROM scan_sessions s
                WHERE s.user_id = ?
                ORDER BY s.created_at DESC, s.id DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        return [self._format_session_summary(r) for r in rows]

    def get_scan_session(self, session_id: int, user_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT s.*,
                       (SELECT COUNT(*) FROM scan_session_tracks st WHERE st.session_id = s.id) AS track_count
                FROM scan_sessions s
                WHERE s.id = ? AND s.user_id = ?
                """,
                (session_id, user_id),
            ).fetchone()
            if not row:
                return None
            track_rows = conn.execute(
                """
                SELECT t.*,
                       CASE WHEN f.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
                FROM scan_session_tracks st
                JOIN tracks t ON t.id = st.track_id
                LEFT JOIN user_favorites f ON f.track_id = t.id AND f.user_id = ?
                WHERE st.session_id = ?
                ORDER BY st.position ASC
                """,
                (user_id, session_id),
            ).fetchall()
        result = self._format_session_summary(row)
        result["tracks"] = [self._format_track(tr) for tr in track_rows]
        return result

    def delete_scan_session(self, session_id: int, user_id: int) -> bool:
        with self._write_lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM scan_sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
            conn.commit()
            return cur.rowcount > 0

    def get_user_dashboard_stats(self, user_id: int) -> dict[str, Any]:
        with self._connect() as conn:
            total_scans = conn.execute("SELECT COUNT(*) FROM scan_sessions WHERE user_id = ?", (user_id,)).fetchone()[0]
            mood_rows = conn.execute(
                "SELECT mood, COUNT(*) AS cnt FROM scan_sessions WHERE user_id = ? GROUP BY mood",
                (user_id,),
            ).fetchall()
            dom_row = conn.execute(
                """
                SELECT mood, emotion, COUNT(*) AS cnt
                FROM scan_sessions
                WHERE user_id = ?
                GROUP BY COALESCE(emotion, mood)
                ORDER BY cnt DESC, MAX(id) DESC
                LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            fav_count = conn.execute("SELECT COUNT(*) FROM user_favorites WHERE user_id = ?", (user_id,)).fetchone()[0]
        catalog = self.count_tracks()
        mood_counts = {r["mood"]: int(r["cnt"]) for r in mood_rows}
        dominant_mood = dom_row["mood"] if dom_row else (max(mood_counts, key=mood_counts.get) if mood_counts else None)
        dominant_emotion = dom_row["emotion"] if dom_row and dom_row["emotion"] else None
        dom_label = (
            EMOTION_FULL_LABELS_TR.get(dominant_emotion)
            if dominant_emotion
            else (MOOD_LABELS_TR.get(dominant_mood, "Henüz tarama yok") if dominant_mood else "Henüz tarama yok")
        )
        return {
            "totalScans": int(total_scans),
            "moodCounts": mood_counts,
            "dominantMood": dominant_mood,
            "dominantEmotion": dominant_emotion,
            "dominantMoodLabel": dom_label,
            "favoriteTracksCount": int(fav_count),
            "catalog": catalog,
        }

    @staticmethod
    def _format_session_summary(row: sqlite3.Row) -> dict[str, Any]:
        try:
            scores = json.loads(row["scores_json"] or "{}")
        except Exception:
            scores = {}
        try:
            face_box = json.loads(row["face_box_json"]) if row["face_box_json"] else None
        except Exception:
            face_box = None
        emotion = row["emotion"] if "emotion" in row.keys() and row["emotion"] else None
        mood_label = EMOTION_FULL_LABELS_TR.get(emotion) if emotion else MOOD_LABELS_TR.get(row["mood"], row["mood"])
        return {
            "id": row["id"],
            "mood": row["mood"],
            "emotion": emotion,
            "moodLabel": mood_label,
            "confidence": row["confidence"],
            "scores": scores,
            "faceBox": face_box,
            "snapshotDataUrl": row["snapshot_data_url"],
            "captureSource": row["capture_source"],
            "deviceLabel": row["device_label"],
            "trackCount": int(row["track_count"]),
            "createdAt": row["created_at"],
        }
