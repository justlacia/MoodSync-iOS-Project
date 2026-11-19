-- MoodSync Relational Database Schema (SQLite 3 / WAL Mode)
-- Stores users, authentication sessions, genres, online-synced music catalog,
-- past emotion scan sessions, session-specific recommended playlists, favorites, and learned genre preferences.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    avatar_hue INTEGER NOT NULL DEFAULT 18,
    preferred_region TEXT NOT NULL DEFAULT 'all' CHECK (preferred_region IN ('all', 'tr', 'global')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_info TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name_tr TEXT NOT NULL,
    default_mood TEXT NOT NULL CHECK (default_mood IN ('positive', 'neutral', 'negative'))
);

CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_source TEXT NOT NULL DEFAULT 'itunes',
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT 'Pop',
    mood TEXT NOT NULL CHECK (mood IN ('positive', 'neutral', 'negative')),
    energy_tag TEXT NOT NULL DEFAULT 'balanced',
    language TEXT NOT NULL DEFAULT 'global' CHECK (language IN ('tr', 'global')),
    artwork_url TEXT NOT NULL DEFAULT '',
    preview_url TEXT NOT NULL DEFAULT '',
    store_url TEXT NOT NULL DEFAULT '',
    youtube_url TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    release_year INTEGER,
    popularity INTEGER NOT NULL DEFAULT 50,
    play_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(external_source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_tracks_mood_lang ON tracks(mood, language, popularity DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_title ON tracks(artist, title);

CREATE TABLE IF NOT EXISTS scan_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mood TEXT NOT NULL CHECK (mood IN ('positive', 'neutral', 'negative')),
    emotion TEXT,
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    scores_json TEXT NOT NULL DEFAULT '{}',
    face_box_json TEXT,
    snapshot_data_url TEXT,
    capture_source TEXT NOT NULL DEFAULT 'camera' CHECK (capture_source IN ('camera', 'upload', 'demo')),
    device_label TEXT NOT NULL DEFAULT 'Kamera',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_sessions_user_date ON scan_sessions(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS scan_session_tracks (
    session_id INTEGER NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_session_tracks_order ON scan_session_tracks(session_id, position ASC);

CREATE TABLE IF NOT EXISTS user_favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS user_genre_preferences (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    genre TEXT NOT NULL,
    mood TEXT NOT NULL CHECK (mood IN ('positive', 'neutral', 'negative')),
    weight REAL NOT NULL DEFAULT 1.0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, genre, mood)
);
