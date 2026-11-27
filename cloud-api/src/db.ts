import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { getSnapshotReadUrl } from './blobStorage';
import { config } from './config';
import {
  ALL_EMOTIONS,
  EmotionScores,
  EmotionType,
  MoodType,
  ScanSessionRecord,
  TrackRecord,
  UserRole,
} from './types';

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL environment variable is missing.');
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export function resolveRole(username: string, role?: string | null): UserRole {
  return role === 'admin' || username.toLowerCase() === 'haluk' ? 'admin' : 'user';
}

export async function initDatabase(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

      CREATE TABLE IF NOT EXISTS biometric_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id SERIAL PRIMARY KEY,
        external_source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT 'Pop',
        mood TEXT NOT NULL DEFAULT 'neutral',
        energy_tag TEXT NOT NULL DEFAULT 'balanced',
        language TEXT NOT NULL DEFAULT 'global',
        artwork_url TEXT NOT NULL DEFAULT '',
        preview_url TEXT NOT NULL DEFAULT '',
        store_url TEXT NOT NULL DEFAULT '',
        youtube_url TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 30000,
        popularity INTEGER NOT NULL DEFAULT 70,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (external_source, external_id)
      );

      CREATE TABLE IF NOT EXISTS favorites (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, track_id)
      );

      CREATE TABLE IF NOT EXISTS disliked_tracks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, track_id)
      );

      CREATE TABLE IF NOT EXISTS scan_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mood TEXT NOT NULL,
        emotion TEXT,
        confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
        emotion_scores_json TEXT,
        note TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        mood_strategy TEXT NOT NULL DEFAULT 'match',
        is_manual_override INTEGER NOT NULL DEFAULT 0,
        snapshot_uri TEXT,
        device_label TEXT NOT NULL DEFAULT 'iPhone 16 Pro',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scan_session_tracks (
        session_id INTEGER NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, track_id)
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        mood TEXT,
        color_hex TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (playlist_id, track_id)
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_mood_lang ON tracks(mood, language);
      CREATE INDEX IF NOT EXISTS idx_scans_user_created ON scan_sessions(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_disliked_user ON disliked_tracks(user_id);
      CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position ASC);
    `);

    const halukRes = await db.query(
      'SELECT id, role FROM users WHERE LOWER(username) = LOWER($1)',
      ['haluk']
    );
    if (halukRes.rows.length === 0) {
      const hash = await bcrypt.hash('haluk', 10);
      await db.query(
        'INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4)',
        ['haluk', 'Haluk', hash, 'admin']
      );
    } else if (halukRes.rows[0].role !== 'admin') {
      await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [halukRes.rows[0].id]);
    }
  })();

  return initPromise;
}

export function parseEmotionScoresJson(raw: unknown): EmotionScores | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: EmotionScores = { happy: 0, surprise: 0, neutral: 0, sad: 0, angry: 0 };
    let hasPositive = false;
    for (const em of ALL_EMOTIONS) {
      const val = Number((parsed as Record<string, unknown>)[em] ?? 0);
      if (Number.isFinite(val) && val > 0) {
        out[em] = val;
        hasPositive = true;
      }
    }
    return hasPositive ? out : null;
  } catch {
    return null;
  }
}

export function parseTagsJson(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  } catch {
    return [];
  }
}

export function mapTrackRow(row: any): TrackRecord {
  return {
    id: Number(row.id),
    externalSource: String(row.external_source || 'itunes'),
    externalId: String(row.external_id || ''),
    title: String(row.title || ''),
    artist: String(row.artist || ''),
    album: String(row.album || ''),
    genre: String(row.genre || 'Pop'),
    mood: (row.mood as MoodType) || 'neutral',
    energyTag: String(row.energy_tag || 'balanced'),
    language: row.language === 'tr' ? 'tr' : 'global',
    artworkUrl: String(row.artwork_url || ''),
    previewUrl: String(row.preview_url || ''),
    storeUrl: String(row.store_url || ''),
    youtubeUrl: String(row.youtube_url || ''),
    durationMs: Number(row.duration_ms || 30000),
    popularity: Number(row.popularity || 70),
    isFavorite: Boolean(Number(row.is_favorite || 0) === 1 || row.is_favorite === true),
  };
}

export function mapScanSessionFields(r: any): Omit<ScanSessionRecord, 'tracks'> {
  const rawStrategy = String(r.mood_strategy || 'match');
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    mood: (r.mood as MoodType) || 'neutral',
    emotion: (r.emotion as EmotionType) || null,
    confidence: Number(r.confidence || 0),
    emotionScores: parseEmotionScoresJson(r.emotion_scores_json),
    note: typeof r.note === 'string' ? r.note : '',
    tags: parseTagsJson(r.tags_json),
    moodStrategy: rawStrategy === 'uplift' ? 'uplift' : 'match',
    isManualOverride: Boolean(Number(r.is_manual_override || 0)),
    snapshotUri: getSnapshotReadUrl(r.snapshot_uri),
    deviceLabel: String(r.device_label || 'iPhone 16 Pro'),
    trackCount: Number(r.track_count ?? 0),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}
