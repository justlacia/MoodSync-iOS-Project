import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { excludeAppDataFromBackup } from '../../modules/moodsync-vision';
import { analyzeCameraFrame } from '../services/moodAiService';
import { fetchOnlineTracksDirect, OnlineTrackPayload } from '../services/onlineMusicService';
import { emotionToMood, EmotionType, MoodType } from '../theme/colors';

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface TrackRecord {
  id: number;
  externalSource: string;
  externalId: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  mood: MoodType;
  energyTag: string;
  language: 'tr' | 'global';
  artworkUrl: string;
  previewUrl: string;
  storeUrl: string;
  youtubeUrl: string;
  durationMs: number;
  popularity: number;
  isFavorite: boolean;
}

export interface ScanSessionRecord {
  id: number;
  userId: number;
  mood: MoodType;
  emotion?: EmotionType | null;
  confidence: number;
  snapshotUri: string | null;
  deviceLabel: string;
  trackCount: number;
  createdAt: string;
  tracks?: TrackRecord[];
}

export interface DashboardStats {
  totalScans: number;
  dominantMood: MoodType | null;
  dominantEmotion?: EmotionType | null;
  favoriteCount: number;
  catalogTotal: number;
}

const DB_NAME = 'moodsync_standalone.db';
const PREFS_FILENAME = 'moodsync_client_prefs.json';
const SNAPSHOTS_DIR_NAME = 'moodsync_snapshots';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let memoryPrefs: Record<string, string> | null = null;
let seedInFlight: Promise<void> | null = null;

// ───────────────────────── App Sandbox Helpers (Auto-deleted by iOS on App Uninstall) ─────────────────────────

function getSnapshotsDirectory(): Directory {
  const dir = new Directory(Paths.document, SNAPSHOTS_DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
}

function decodeBase64ToBytes(base64Input: string): Uint8Array {
  const cleaned = base64Input.includes('base64,')
    ? base64Input.slice(base64Input.indexOf('base64,') + 7)
    : base64Input;
  const sanitized = cleaned.replace(/[^A-Za-z0-9+/=]/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = sanitized.length;
  let padding = 0;
  if (len >= 2 && sanitized[len - 1] === '=') padding++;
  if (len >= 2 && sanitized[len - 2] === '=') padding++;
  const byteLen = Math.max(0, Math.floor((len * 3) / 4) - padding);
  const bytes = new Uint8Array(byteLen);

  let outIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = chars.indexOf(sanitized[i]);
    const c2 = chars.indexOf(sanitized[i + 1]);
    const c3 = i + 2 < len && sanitized[i + 2] !== '=' ? chars.indexOf(sanitized[i + 2]) : 0;
    const c4 = i + 3 < len && sanitized[i + 3] !== '=' ? chars.indexOf(sanitized[i + 3]) : 0;
    const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (outIdx < byteLen) bytes[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < byteLen) bytes[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < byteLen) bytes[outIdx++] = triple & 0xff;
  }
  return bytes;
}

/**
 * Saves captured JPEG exclusively inside the app's private iOS sandbox Documents directory.
 * Never writes to the iPhone Photos / Camera Roll gallery, so iOS deletes 100% of photos
 * automatically when the user uninstalls the app.
 */
function saveSnapshotToSandbox(base64Jpeg: string): string | null {
  try {
    const dir = getSnapshotsDirectory();
    const filename = `scan_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`;
    const file = new File(dir, filename);
    const bytes = decodeBase64ToBytes(base64Jpeg);
    file.write(bytes);
    excludeAppDataFromBackup();
    return file.uri;
  } catch {
    return null;
  }
}

function deleteSandboxFileQuietly(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('file://')) return;
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Safe no-op
  }
}

function cleanTempCameraCaches(): void {
  for (const subDirName of ['Camera', 'ImagePicker']) {
    try {
      const subDir = new Directory(Paths.cache, subDirName);
      if (subDir.exists) {
        subDir.delete();
      }
    } catch {
      // Safe no-op
    }
  }
}

// ───────────────────────── Tiny Client Preferences (Inside App Sandbox) ─────────────────────────

function readPrefs(): Record<string, string> {
  if (memoryPrefs !== null) {
    return memoryPrefs;
  }
  try {
    const file = new File(Paths.document, PREFS_FILENAME);
    if (file.exists) {
      const raw = file.textSync();
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        memoryPrefs = parsed;
        return memoryPrefs!;
      }
    }
  } catch {
    // Ignore file read error; fall back to empty prefs
  }
  memoryPrefs = {};
  return memoryPrefs;
}

function writePrefs(next: Record<string, string>): void {
  memoryPrefs = next;
  try {
    const file = new File(Paths.document, PREFS_FILENAME);
    file.write(JSON.stringify(next));
  } catch {
    // Ignore if filesystem write fails
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const prefs = readPrefs();
  return prefs[key] ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const prefs = { ...readPrefs() };
  if (value === null || value === '') {
    delete prefs[key];
  } else {
    prefs[key] = value;
  }
  writePrefs(prefs);
}

// ───────────────────────── SQLite Database Init & Schema ─────────────────────────

async function hashPassword(password: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `moodsync_ios_v3::${password}`
  );
}

async function initDatabaseInternal(): Promise<SQLite.SQLiteDatabase> {
  cleanTempCameraCaches();
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT NOT NULL,
      UNIQUE(external_source, external_id)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, track_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scan_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mood TEXT NOT NULL,
      emotion TEXT,
      confidence REAL NOT NULL DEFAULT 0.8,
      snapshot_uri TEXT,
      device_label TEXT NOT NULL DEFAULT 'iPhone 16 Pro',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scan_session_tracks (
      session_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, track_id),
      FOREIGN KEY (session_id) REFERENCES scan_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_mood_lang ON tracks(mood, language);
    CREATE INDEX IF NOT EXISTS idx_scans_user_created ON scan_sessions(user_id, created_at DESC);
  `);

  // Remove legacy demo account and ensure default personal account (haluk / haluk) exists locally
  await db.runAsync('DELETE FROM users WHERE lower(username) = ?', ['demo']);
  const halukExists = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM users WHERE lower(username) = ?',
    ['haluk']
  );
  if (!halukExists) {
    const halukHash = await hashPassword('haluk');
    await db.runAsync(
      'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
      ['haluk', 'Haluk', halukHash, new Date().toISOString()]
    );
  }

  dbInstance = db;
  excludeAppDataFromBackup();

  // Kick off initial background catalog warm-up if empty (non-blocking)
  const countRow = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM tracks');
  if (!countRow || countRow.cnt < 18) {
    ensureInitialCatalogSeeded().catch(() => {});
  }

  return db;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  if (!dbInitPromise) {
    dbInitPromise = initDatabaseInternal();
  }
  return dbInitPromise;
}

/**
 * Completely wipes all local data inside the app sandbox (SQLite DB, all captured photos,
 * user sessions, preferences, and temporary caches).
 */
export async function wipeAllLocalData(): Promise<void> {
  if (dbInstance) {
    try {
      await dbInstance.closeAsync();
    } catch {
      // Ignore close error
    }
    dbInstance = null;
    dbInitPromise = null;
  }

  try {
    await SQLite.deleteDatabaseAsync(DB_NAME);
  } catch {
    // Safe no-op
  }

  try {
    const snapDir = new Directory(Paths.document, SNAPSHOTS_DIR_NAME);
    if (snapDir.exists) {
      snapDir.delete();
    }
  } catch {
    // Safe no-op
  }

  try {
    const prefsFile = new File(Paths.document, PREFS_FILENAME);
    if (prefsFile.exists) {
      prefsFile.delete();
    }
  } catch {
    // Safe no-op
  }
  memoryPrefs = {};

  cleanTempCameraCaches();
  await getDatabase();
}

export async function getSandboxStorageSummary(): Promise<{
  photoCount: number;
  trackCount: number;
  scanCount: number;
}> {
  const db = await getDatabase();
  const trackRow = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM tracks');
  const scanRow = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM scan_sessions');
  let photoCount = 0;
  try {
    const dir = new Directory(Paths.document, SNAPSHOTS_DIR_NAME);
    if (dir.exists) {
      photoCount = dir.list().length;
    }
  } catch {
    photoCount = 0;
  }
  return {
    photoCount,
    trackCount: Number(trackRow?.cnt || 0),
    scanCount: Number(scanRow?.cnt || 0),
  };
}

// ───────────────────────── Mappers ─────────────────────────

function mapTrackRow(row: any): TrackRecord {
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
    isFavorite: Boolean(row.is_favorite),
  };
}

// ───────────────────────── Auth (100% On-Device SQLite) ─────────────────────────

export async function loginUser(username: string, password: string): Promise<UserRecord | null> {
  const clean = username.trim();
  if (!clean || !password) return null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT id, username, display_name, password_hash, created_at FROM users WHERE lower(username) = lower(?)',
    [clean]
  );
  if (!row) return null;

  const expectedHash = await hashPassword(password);
  if (row.password_hash !== expectedHash) {
    return null;
  }

  await setSetting('active_user_id', String(row.id));
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name || row.username),
    createdAt: String(row.created_at),
  };
}

export async function registerUser(
  displayName: string,
  username: string,
  password: string
): Promise<UserRecord> {
  const cleanUser = username.trim();
  const cleanName = displayName.trim() || cleanUser;
  if (cleanUser.length < 3) {
    throw new Error('Kullanıcı adı en az 3 karakter olmalıdır.');
  }
  if (password.length < 4) {
    throw new Error('Şifre en az 4 karakter olmalıdır.');
  }

  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM users WHERE lower(username) = lower(?)',
    [cleanUser]
  );
  if (existing) {
    throw new Error('Bu kullanıcı adı zaten kayıtlı.');
  }

  const passHash = await hashPassword(password);
  const now = new Date().toISOString();
  const res = await db.runAsync(
    'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
    [cleanUser, cleanName, passHash, now]
  );

  const newId = Number(res.lastInsertRowId);
  await setSetting('active_user_id', String(newId));
  return {
    id: newId,
    username: cleanUser,
    displayName: cleanName,
    createdAt: now,
  };
}

export async function restoreActiveUser(): Promise<UserRecord | null> {
  const savedId = await getSetting('active_user_id');
  if (!savedId) return null;
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT id, username, display_name, created_at FROM users WHERE id = ?',
    [Number(savedId)]
  );
  if (!row) {
    await setSetting('active_user_id', null);
    return null;
  }
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name || row.username),
    createdAt: String(row.created_at),
  };
}

export async function logoutActiveUser(): Promise<void> {
  await setSetting('active_user_id', null);
}

// ───────────────────────── On-Device Music Catalog & iTunes/Deezer Sync ─────────────────────────

async function upsertTracks(payloads: OnlineTrackPayload[]): Promise<number> {
  if (!payloads.length) return 0;
  const db = await getDatabase();
  const now = new Date().toISOString();
  let inserted = 0;

  for (const t of payloads) {
    try {
      await db.runAsync(
        `INSERT INTO tracks (
          external_source, external_id, title, artist, album, genre,
          mood, energy_tag, language, artwork_url, preview_url,
          store_url, youtube_url, duration_ms, popularity, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_source, external_id) DO UPDATE SET
          preview_url = excluded.preview_url,
          artwork_url = CASE WHEN excluded.artwork_url != '' THEN excluded.artwork_url ELSE tracks.artwork_url END,
          popularity = MAX(tracks.popularity, excluded.popularity)`,
        [
          t.externalSource,
          t.externalId,
          t.title,
          t.artist,
          t.album,
          t.genre,
          t.mood,
          t.energyTag,
          t.language,
          t.artworkUrl,
          t.previewUrl,
          t.storeUrl,
          t.youtubeUrl,
          t.durationMs,
          t.popularity,
          now,
        ]
      );
      inserted++;
    } catch {
      // Skip malformed row
    }
  }
  return inserted;
}

async function ensureInitialCatalogSeeded(): Promise<void> {
  if (seedInFlight) return seedInFlight;
  seedInFlight = (async () => {
    try {
      const [pos, neu, neg] = await Promise.all([
        fetchOnlineTracksDirect({ mood: 'positive', language: 'all' }),
        fetchOnlineTracksDirect({ mood: 'neutral', language: 'all' }),
        fetchOnlineTracksDirect({ mood: 'negative', language: 'all' }),
      ]);
      await upsertTracks([...pos, ...neu, ...neg]);
    } finally {
      seedInFlight = null;
    }
  })();
  return seedInFlight;
}

export async function fetchAndStoreOnlineSongs(params: {
  mood: MoodType;
  emotion?: EmotionType | null;
  language?: 'all' | 'tr' | 'global';
  customQuery?: string;
}): Promise<number> {
  const fetched = await fetchOnlineTracksDirect(params);
  return upsertTracks(fetched);
}

export async function selectPlaylistForMood(
  mood: MoodType,
  userId: number,
  count = 16,
  language: 'all' | 'tr' | 'global' = 'all',
  emotion?: EmotionType | null
): Promise<TrackRecord[]> {
  const db = await getDatabase();

  // Pull fresh songs from iTunes & Deezer directly on the iPhone
  try {
    const fresh = await fetchOnlineTracksDirect({ mood, emotion, language });
    if (fresh.length > 0) {
      await upsertTracks(fresh);
    }
  } catch {
    // Offline fallback: serve from local SQLite catalog
  }

  const whereParts = ['t.mood = ?'];
  const args: any[] = [userId, mood];

  if (language === 'tr' || language === 'global') {
    whereParts.push('t.language = ?');
    args.push(language);
  }

  if (emotion === 'angry') {
    whereParts.push("(t.energy_tag = 'angry-rock' OR t.mood = 'negative')");
  }

  args.push(count);

  const rows = await db.getAllAsync<any>(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM tracks t
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
     WHERE ${whereParts.join(' AND ')}
     ORDER BY
       CASE WHEN ? = 'angry' AND t.energy_tag = 'angry-rock' THEN 0 ELSE 1 END,
       RANDOM()
     LIMIT ?`,
    [args[0], ...args.slice(1, args.length - 1), emotion || '', count]
  );

  if (rows.length > 0) {
    return rows.map(mapTrackRow);
  }

  // Fallback to any tracks in local catalog if filtered set is empty
  const fallbackRows = await db.getAllAsync<any>(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM tracks t
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
     ORDER BY RANDOM()
     LIMIT ?`,
    [userId, count]
  );
  return fallbackRows.map(mapTrackRow);
}

export async function queryCatalogTracks(options: {
  userId: number;
  mood?: MoodType | '';
  language?: 'tr' | 'global' | '';
  search?: string;
  favoritesOnly?: boolean;
  limit?: number;
}): Promise<TrackRecord[]> {
  const db = await getDatabase();
  const whereParts: string[] = ['1 = 1'];
  const params: any[] = [options.userId];

  if (options.mood) {
    whereParts.push('t.mood = ?');
    params.push(options.mood);
  }
  if (options.language) {
    whereParts.push('t.language = ?');
    params.push(options.language);
  }
  if (options.search && options.search.trim()) {
    const q = `%${options.search.trim().toLowerCase()}%`;
    whereParts.push('(lower(t.title) LIKE ? OR lower(t.artist) LIKE ? OR lower(t.genre) LIKE ?)');
    params.push(q, q, q);
  }
  if (options.favoritesOnly) {
    whereParts.push('f.track_id IS NOT NULL');
  }

  params.push(options.limit || 140);

  const rows = await db.getAllAsync<any>(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM tracks t
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
     WHERE ${whereParts.join(' AND ')}
     ORDER BY is_favorite DESC, t.popularity DESC, t.id DESC
     LIMIT ?`,
    params
  );

  return rows.map(mapTrackRow);
}

export async function toggleFavoriteTrack(userId: number, trackId: number): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ track_id: number }>(
    'SELECT track_id FROM favorites WHERE user_id = ? AND track_id = ?',
    [userId, trackId]
  );

  if (existing) {
    await db.runAsync('DELETE FROM favorites WHERE user_id = ? AND track_id = ?', [
      userId,
      trackId,
    ]);
    return false;
  }

  await db.runAsync(
    'INSERT OR IGNORE INTO favorites (user_id, track_id, created_at) VALUES (?, ?, ?)',
    [userId, trackId, new Date().toISOString()]
  );
  return true;
}

// ───────────────────────── On-Device Camera Capture & Scan Sessions ─────────────────────────

/**
 * Runs on-device Apple Vision / CoreML analysis, saves the captured photo strictly inside
 * the app's private iOS sandbox directory (auto-removed when app is uninstalled), builds
 * a mood-matched playlist directly from iTunes/Deezer + local SQLite, and stores the session.
 */
export async function captureAndSaveSessionOnServer(params: {
  userId: number;
  imageBase64: string;
  fallbackMood?: MoodType | null;
  fallbackEmotion?: EmotionType | null;
  fallbackConfidence?: number | null;
  deviceLabel: string;
  captureSource?: 'camera' | 'upload';
  language?: 'all' | 'tr' | 'global';
}): Promise<ScanSessionRecord> {
  const db = await getDatabase();

  // 1. On-device emotion analysis
  const det = await analyzeCameraFrame(params.imageBase64, true);

  const finalEmotion: EmotionType =
    det.detected && det.emotion
      ? det.emotion
      : params.fallbackEmotion || 'neutral';
  const finalMood: MoodType =
    det.detected && det.mood
      ? det.mood
      : params.fallbackMood || emotionToMood(finalEmotion);
  const finalConfidence =
    det.detected && det.confidence > 0
      ? det.confidence
      : params.fallbackConfidence || 0.82;

  // 2. Save photo strictly inside app sandbox (never to iPhone Photos gallery)
  const snapshotUri = saveSnapshotToSandbox(params.imageBase64);
  cleanTempCameraCaches();

  // 3. Build personalized playlist directly on-device
  const tracks = await selectPlaylistForMood(
    finalMood,
    params.userId,
    16,
    params.language || 'all',
    finalEmotion
  );

  // 4. Persist session & tracks in local SQLite
  const createdAt = new Date().toISOString();
  const insertRes = await db.runAsync(
    `INSERT INTO scan_sessions (user_id, mood, emotion, confidence, snapshot_uri, device_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      finalMood,
      finalEmotion,
      finalConfidence,
      snapshotUri,
      params.deviceLabel,
      createdAt,
    ]
  );

  const sessionId = Number(insertRes.lastInsertRowId);
  for (let i = 0; i < tracks.length; i++) {
    await db.runAsync(
      'INSERT OR IGNORE INTO scan_session_tracks (session_id, track_id, position) VALUES (?, ?, ?)',
      [sessionId, tracks[i].id, i]
    );
  }

  return {
    id: sessionId,
    userId: params.userId,
    mood: finalMood,
    emotion: finalEmotion,
    confidence: finalConfidence,
    snapshotUri,
    deviceLabel: params.deviceLabel,
    trackCount: tracks.length,
    createdAt,
    tracks,
  };
}

export async function listScanSessions(userId: number): Promise<ScanSessionRecord[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM scan_session_tracks sst WHERE sst.session_id = s.id) AS track_count
     FROM scan_sessions s
     WHERE s.user_id = ?
     ORDER BY s.created_at DESC
     LIMIT 60`,
    [userId]
  );

  return rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    mood: (r.mood as MoodType) || 'neutral',
    emotion: (r.emotion as EmotionType) || null,
    confidence: Number(r.confidence || 0),
    snapshotUri: r.snapshot_uri || null,
    deviceLabel: String(r.device_label || 'iPhone 16 Pro'),
    trackCount: Number(r.track_count || 0),
    createdAt: String(r.created_at),
  }));
}

export async function getScanSessionWithTracks(
  sessionId: number,
  userId: number
): Promise<ScanSessionRecord | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM scan_sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  );
  if (!row) return null;

  const trackRows = await db.getAllAsync<any>(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM scan_session_tracks sst
     JOIN tracks t ON t.id = sst.track_id
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
     WHERE sst.session_id = ?
     ORDER BY sst.position ASC`,
    [userId, sessionId]
  );

  const tracks = trackRows.map(mapTrackRow);
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    mood: (row.mood as MoodType) || 'neutral',
    emotion: (row.emotion as EmotionType) || null,
    confidence: Number(row.confidence || 0),
    snapshotUri: row.snapshot_uri || null,
    deviceLabel: String(row.device_label || 'iPhone 16 Pro'),
    trackCount: tracks.length,
    createdAt: String(row.created_at),
    tracks,
  };
}

export async function deleteScanSession(sessionId: number, userId: number): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ snapshot_uri: string | null }>(
    'SELECT snapshot_uri FROM scan_sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  );
  if (existing?.snapshot_uri) {
    deleteSandboxFileQuietly(existing.snapshot_uri);
  }
  await db.runAsync('DELETE FROM scan_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
}

export async function getDashboardStats(userId: number): Promise<DashboardStats> {
  const db = await getDatabase();
  const scanCountRow = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM scan_sessions WHERE user_id = ?',
    [userId]
  );
  const domMoodRow = await db.getFirstAsync<{ mood: MoodType; emotion: EmotionType | null }>(
    `SELECT mood, emotion, COUNT(*) AS cnt
     FROM scan_sessions
     WHERE user_id = ?
     GROUP BY mood, emotion
     ORDER BY cnt DESC
     LIMIT 1`,
    [userId]
  );
  const favCountRow = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM favorites WHERE user_id = ?',
    [userId]
  );
  const catalogRow = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM tracks');

  return {
    totalScans: Number(scanCountRow?.cnt || 0),
    dominantMood: (domMoodRow?.mood as MoodType) || null,
    dominantEmotion: (domMoodRow?.emotion as EmotionType) || null,
    favoriteCount: Number(favCountRow?.cnt || 0),
    catalogTotal: Number(catalogRow?.cnt || 0),
  };
}
