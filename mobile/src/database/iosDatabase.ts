import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { excludeAppDataFromBackup } from '../../modules/moodsync-vision';
import { analyzeCameraFrame } from '../services/moodAiService';
import { fetchOnlineTracksDirect, OnlineTrackPayload } from '../services/onlineMusicService';
import { emotionToMood, EmotionType, MoodType } from '../theme/colors';

export type UserRole = 'admin' | 'user';

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export function isAdminUser(user: UserRecord | null | undefined): boolean {
  return Boolean(user && (user.role === 'admin' || user.username.toLowerCase() === 'haluk'));
}

export interface AdminUserSummary {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  scanCount: number;
  favoriteCount: number;
  lastScanAt: string | null;
}

export type AdminScanSessionRecord = ScanSessionRecord & {
  username: string;
  displayName: string;
};

export interface AdminFavoriteRecord {
  userId: number;
  username: string;
  displayName: string;
  trackId: number;
  title: string;
  artist: string;
  mood: MoodType;
  language: 'tr' | 'global';
  createdAt: string;
}

export type AdminTableName =
  | 'users'
  | 'scan_sessions'
  | 'tracks'
  | 'favorites'
  | 'scan_session_tracks';

export interface AdminDatabaseOverview {
  userCount: number;
  adminCount: number;
  scanCount: number;
  trackCount: number;
  favoriteCount: number;
  sessionTrackLinkCount: number;
  photoCount: number;
  photoBytes: number;
  dbBytes: number;
  emotionBreakdown: Array<{ emotion: string; count: number }>;
  moodBreakdown: Array<{ mood: MoodType; count: number }>;
  languageBreakdown: Array<{ language: string; count: number }>;
  sourceBreakdown: Array<{ source: string; count: number }>;
  tables: Array<{ name: AdminTableName; rowCount: number }>;
  prefs: Record<string, string>;
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
      role TEXT NOT NULL DEFAULT 'user',
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

  // Safe migration for existing databases lacking users.role
  const userCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
  if (!userCols.some((c) => c.name === 'role')) {
    await db.execAsync("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';");
  }

  // Remove legacy demo account and ensure default admin account (haluk / haluk) exists locally
  await db.runAsync('DELETE FROM users WHERE lower(username) = ?', ['demo']);
  const halukExists = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM users WHERE lower(username) = ?',
    ['haluk']
  );
  if (!halukExists) {
    const halukHash = await hashPassword('haluk');
    await db.runAsync(
      'INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      ['haluk', 'Haluk', halukHash, 'admin', new Date().toISOString()]
    );
  } else {
    await db.runAsync(
      "UPDATE users SET role = 'admin' WHERE lower(username) = 'haluk' AND role != 'admin'"
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

function resolveRole(username: string, role?: string | null): UserRole {
  return role === 'admin' || username.toLowerCase() === 'haluk' ? 'admin' : 'user';
}

export async function loginUser(username: string, password: string): Promise<UserRecord | null> {
  const clean = username.trim();
  if (!clean || !password) return null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT id, username, display_name, password_hash, role, created_at FROM users WHERE lower(username) = lower(?)',
    [clean]
  );
  if (!row) return null;

  const expectedHash = await hashPassword(password);
  if (row.password_hash !== expectedHash) {
    return null;
  }

  const uname = String(row.username);
  const role = resolveRole(uname, row.role);

  await setSetting('active_user_id', String(row.id));
  return {
    id: Number(row.id),
    username: uname,
    displayName: String(row.display_name || uname),
    role,
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
    'INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    [cleanUser, cleanName, passHash, 'user', now]
  );

  const newId = Number(res.lastInsertRowId);
  await setSetting('active_user_id', String(newId));
  return {
    id: newId,
    username: cleanUser,
    displayName: cleanName,
    role: 'user',
    createdAt: now,
  };
}

export async function restoreActiveUser(): Promise<UserRecord | null> {
  const savedId = await getSetting('active_user_id');
  if (!savedId) return null;
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT id, username, display_name, role, created_at FROM users WHERE id = ?',
    [Number(savedId)]
  );
  if (!row) {
    await setSetting('active_user_id', null);
    return null;
  }
  const uname = String(row.username);
  return {
    id: Number(row.id),
    username: uname,
    displayName: String(row.display_name || uname),
    role: resolveRole(uname, row.role),
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

export async function expandScanSessionTracks(params: {
  sessionId: number;
  userId: number;
  addCount?: number;
  language?: 'all' | 'tr' | 'global';
}): Promise<{ session: ScanSessionRecord; addedCount: number } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM scan_sessions WHERE id = ? AND user_id = ?',
    [params.sessionId, params.userId]
  );
  if (!row) return null;

  const targetAdd = Math.max(1, Math.min(30, params.addCount ?? 8));
  const lang = params.language || 'all';
  const mood = (row.mood as MoodType) || 'neutral';
  const emotion = (row.emotion as EmotionType) || null;

  const existingRows = await db.getAllAsync<{
    track_id: number;
    position: number | null;
    norm_artist: string | null;
    norm_title: string | null;
  }>(
    `SELECT sst.track_id,
            sst.position,
            lower(trim(t.artist)) AS norm_artist,
            lower(trim(t.title)) AS norm_title
     FROM scan_session_tracks sst
     JOIN tracks t ON t.id = sst.track_id
     WHERE sst.session_id = ?`,
    [params.sessionId]
  );

  const existingIds = new Set<number>();
  const existingSignatures = new Set<string>();
  let maxPosition = -1;

  for (const er of existingRows) {
    existingIds.add(Number(er.track_id));
    if (er.position !== null && er.position !== undefined) {
      maxPosition = Math.max(maxPosition, Number(er.position));
    }
    const artist = String(er.norm_artist || '').trim();
    const title = String(er.norm_title || '').trim();
    if (artist || title) {
      existingSignatures.add(`${artist}::${title}`);
    }
  }

  const pickUniqueCandidates = async (): Promise<TrackRecord[]> => {
    const whereParts = ['t.mood = ?'];
    const args: any[] = [params.userId, mood];

    if (lang === 'tr' || lang === 'global') {
      whereParts.push('t.language = ?');
      args.push(lang);
    }

    if (emotion === 'angry') {
      whereParts.push("(t.energy_tag = 'angry-rock' OR t.mood = 'negative')");
    }

    const queryLimit = Math.max(40, targetAdd * 5);
    const rows = await db.getAllAsync<any>(
      `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
       FROM tracks t
       LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
       WHERE ${whereParts.join(' AND ')}
       ORDER BY
         CASE WHEN ? = 'angry' AND t.energy_tag = 'angry-rock' THEN 0 ELSE 1 END,
         RANDOM()
       LIMIT ?`,
      [args[0], ...args.slice(1), emotion || '', queryLimit]
    );

    const unique: TrackRecord[] = [];
    const seenSig = new Set<string>(existingSignatures);
    const seenIds = new Set<number>(existingIds);

    for (const raw of rows) {
      const tr = mapTrackRow(raw);
      const sig = `${tr.artist.toLowerCase().trim()}::${tr.title.toLowerCase().trim()}`;
      if (seenIds.has(tr.id) || seenSig.has(sig)) continue;
      seenIds.add(tr.id);
      seenSig.add(sig);
      unique.push(tr);
      if (unique.length >= targetAdd) break;
    }

    return unique;
  };

  try {
    const fresh = await fetchOnlineTracksDirect({ mood, emotion, language: lang });
    if (fresh.length > 0) {
      await upsertTracks(fresh);
    }
  } catch {
    // Offline fallback: pick directly from existing local catalog
  }

  let selected = await pickUniqueCandidates();

  if (selected.length < targetAdd) {
    try {
      const extraFresh = await fetchOnlineTracksDirect({ mood, emotion: null, language: lang });
      if (extraFresh.length > 0) {
        await upsertTracks(extraFresh);
        selected = await pickUniqueCandidates();
      }
    } catch {
      // Ignore offline fallback error
    }
  }

  let nextPos = maxPosition + 1;
  let addedCount = 0;
  for (const tr of selected) {
    const res = await db.runAsync(
      'INSERT OR IGNORE INTO scan_session_tracks (session_id, track_id, position) VALUES (?, ?, ?)',
      [params.sessionId, tr.id, nextPos]
    );
    if (res.changes > 0) {
      nextPos++;
      addedCount++;
    }
  }

  const updated = await getScanSessionWithTracks(params.sessionId, params.userId);
  if (!updated) return null;
  return { session: updated, addedCount };
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

export async function clearUserScanSessions(userId: number): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: number; snapshot_uri: string | null }>(
    'SELECT id, snapshot_uri FROM scan_sessions WHERE user_id = ?',
    [userId]
  );
  for (const r of rows) {
    if (r.snapshot_uri) {
      deleteSandboxFileQuietly(r.snapshot_uri);
    }
  }
  await db.runAsync('DELETE FROM scan_sessions WHERE user_id = ?', [userId]);
  return rows.length;
}

// ───────────────────────── Admin Panel & Full SQLite Explorer ─────────────────────────

const ADMIN_ALLOWED_TABLES: Record<AdminTableName, true> = {
  users: true,
  scan_sessions: true,
  tracks: true,
  favorites: true,
  scan_session_tracks: true,
};

function maskSensitiveRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!('password_hash' in row)) return row;
  const val = row.password_hash;
  return {
    ...row,
    password_hash: typeof val === 'string' ? `sha256:${val.slice(0, 10)}…` : val,
  };
}

export async function getAdminDatabaseOverview(): Promise<AdminDatabaseOverview> {
  const db = await getDatabase();

  const [
    userRow,
    adminRow,
    scanRow,
    trackRow,
    favRow,
    linkRow,
    pageCountRow,
    pageSizeRow,
    emotionRows,
    moodRows,
    langRows,
    sourceRows,
  ] = await Promise.all([
    db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM users'),
    db.getFirstAsync<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' OR lower(username) = 'haluk'"
    ),
    db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM scan_sessions'),
    db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM tracks'),
    db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM favorites'),
    db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM scan_session_tracks'),
    db.getFirstAsync<Record<string, unknown>>('PRAGMA page_count'),
    db.getFirstAsync<Record<string, unknown>>('PRAGMA page_size'),
    db.getAllAsync<{ emotion: string; count: number }>(
      `SELECT COALESCE(NULLIF(emotion, ''), mood) AS emotion, COUNT(*) AS count
       FROM scan_sessions
       GROUP BY COALESCE(NULLIF(emotion, ''), mood)
       ORDER BY count DESC`
    ),
    db.getAllAsync<{ mood: MoodType; count: number }>(
      `SELECT mood, COUNT(*) AS count
       FROM scan_sessions
       GROUP BY mood
       ORDER BY count DESC`
    ),
    db.getAllAsync<{ language: string; count: number }>(
      `SELECT language, COUNT(*) AS count
       FROM tracks
       GROUP BY language
       ORDER BY count DESC`
    ),
    db.getAllAsync<{ source: string; count: number }>(
      `SELECT external_source AS source, COUNT(*) AS count
       FROM tracks
       GROUP BY external_source
       ORDER BY count DESC`
    ),
  ]);

  const pageCount = pageCountRow ? Number(Object.values(pageCountRow)[0] || 0) : 0;
  const pageSize = pageSizeRow ? Number(Object.values(pageSizeRow)[0] || 0) : 0;
  const dbBytes = Math.max(0, pageCount * pageSize);

  let photoCount = 0;
  let photoBytes = 0;
  try {
    const dir = new Directory(Paths.document, SNAPSHOTS_DIR_NAME);
    if (dir.exists) {
      const entries = dir.list();
      for (const entry of entries) {
        if (entry instanceof File) {
          photoCount++;
          photoBytes += Number(entry.size || 0);
        }
      }
    }
  } catch {
    photoCount = 0;
    photoBytes = 0;
  }

  const userCount = Number(userRow?.cnt || 0);
  const adminCount = Number(adminRow?.cnt || 0);
  const scanCount = Number(scanRow?.cnt || 0);
  const trackCount = Number(trackRow?.cnt || 0);
  const favoriteCount = Number(favRow?.cnt || 0);
  const sessionTrackLinkCount = Number(linkRow?.cnt || 0);

  return {
    userCount,
    adminCount,
    scanCount,
    trackCount,
    favoriteCount,
    sessionTrackLinkCount,
    photoCount,
    photoBytes,
    dbBytes,
    emotionBreakdown: emotionRows.map((r) => ({
      emotion: String(r.emotion || 'neutral'),
      count: Number(r.count || 0),
    })),
    moodBreakdown: moodRows.map((r) => ({
      mood: (r.mood as MoodType) || 'neutral',
      count: Number(r.count || 0),
    })),
    languageBreakdown: langRows.map((r) => ({
      language: String(r.language || 'global'),
      count: Number(r.count || 0),
    })),
    sourceBreakdown: sourceRows.map((r) => ({
      source: String(r.source || 'itunes'),
      count: Number(r.count || 0),
    })),
    tables: [
      { name: 'users', rowCount: userCount },
      { name: 'scan_sessions', rowCount: scanCount },
      { name: 'tracks', rowCount: trackCount },
      { name: 'favorites', rowCount: favoriteCount },
      { name: 'scan_session_tracks', rowCount: sessionTrackLinkCount },
    ],
    prefs: { ...readPrefs() },
  };
}

export async function adminListUsers(): Promise<AdminUserSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT u.id, u.username, u.display_name, u.role, u.created_at,
            (SELECT COUNT(*) FROM scan_sessions s WHERE s.user_id = u.id) AS scan_count,
            (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS favorite_count,
            (SELECT MAX(s.created_at) FROM scan_sessions s WHERE s.user_id = u.id) AS last_scan_at
     FROM users u
     ORDER BY CASE WHEN lower(u.username) = 'haluk' OR u.role = 'admin' THEN 0 ELSE 1 END, u.created_at DESC`
  );

  return rows.map((r) => {
    const uname = String(r.username);
    return {
      id: Number(r.id),
      username: uname,
      displayName: String(r.display_name || uname),
      role: resolveRole(uname, r.role),
      createdAt: String(r.created_at),
      scanCount: Number(r.scan_count || 0),
      favoriteCount: Number(r.favorite_count || 0),
      lastScanAt: r.last_scan_at ? String(r.last_scan_at) : null,
    };
  });
}

export async function adminCreateUser(
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
    'INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    [cleanUser, cleanName, passHash, 'user', now]
  );

  return {
    id: Number(res.lastInsertRowId),
    username: cleanUser,
    displayName: cleanName,
    role: 'user',
    createdAt: now,
  };
}

export async function adminResetUserPassword(
  targetUserId: number,
  newPassword: string
): Promise<void> {
  if (newPassword.length < 4) {
    throw new Error('Yeni şifre en az 4 karakter olmalıdır.');
  }
  const db = await getDatabase();
  const passHash = await hashPassword(newPassword);
  await db.runAsync('UPDATE users SET password_hash = ? WHERE id = ?', [passHash, targetUserId]);
}

export async function adminDeleteUser(targetUserId: number): Promise<void> {
  const db = await getDatabase();
  const target = await db.getFirstAsync<{ id: number; username: string; role: string }>(
    'SELECT id, username, role FROM users WHERE id = ?',
    [targetUserId]
  );
  if (!target) {
    throw new Error('Kullanıcı bulunamadı.');
  }
  if (resolveRole(String(target.username), target.role) === 'admin') {
    throw new Error('Admin hesabı silinemez.');
  }

  const scanRows = await db.getAllAsync<{ snapshot_uri: string | null }>(
    'SELECT snapshot_uri FROM scan_sessions WHERE user_id = ?',
    [targetUserId]
  );
  for (const r of scanRows) {
    if (r.snapshot_uri) {
      deleteSandboxFileQuietly(r.snapshot_uri);
    }
  }

  await db.runAsync('DELETE FROM users WHERE id = ?', [targetUserId]);
}

export async function adminListAllScanSessions(
  limit = 100,
  filterUserId?: number | null
): Promise<AdminScanSessionRecord[]> {
  const db = await getDatabase();
  const hasFilter = typeof filterUserId === 'number' && filterUserId > 0;
  const rows = await db.getAllAsync<any>(
    `SELECT s.*, u.username, u.display_name,
            (SELECT COUNT(*) FROM scan_session_tracks sst WHERE sst.session_id = s.id) AS track_count
     FROM scan_sessions s
     JOIN users u ON u.id = s.user_id
     ${hasFilter ? 'WHERE s.user_id = ?' : ''}
     ORDER BY s.created_at DESC
     LIMIT ?`,
    hasFilter ? [filterUserId, limit] : [limit]
  );

  return rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    username: String(r.username || ''),
    displayName: String(r.display_name || r.username || ''),
    mood: (r.mood as MoodType) || 'neutral',
    emotion: (r.emotion as EmotionType) || null,
    confidence: Number(r.confidence || 0),
    snapshotUri: r.snapshot_uri || null,
    deviceLabel: String(r.device_label || 'iPhone 16 Pro'),
    trackCount: Number(r.track_count || 0),
    createdAt: String(r.created_at),
  }));
}

export async function adminGetScanSessionWithTracks(
  sessionId: number
): Promise<AdminScanSessionRecord | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    `SELECT s.*, u.username, u.display_name
     FROM scan_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [sessionId]
  );
  if (!row) return null;

  const ownerId = Number(row.user_id);
  const trackRows = await db.getAllAsync<any>(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM scan_session_tracks sst
     JOIN tracks t ON t.id = sst.track_id
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
     WHERE sst.session_id = ?
     ORDER BY sst.position ASC`,
    [ownerId, sessionId]
  );

  const tracks = trackRows.map(mapTrackRow);
  return {
    id: Number(row.id),
    userId: ownerId,
    username: String(row.username || ''),
    displayName: String(row.display_name || row.username || ''),
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

export async function adminDeleteScanSession(sessionId: number): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ snapshot_uri: string | null }>(
    'SELECT snapshot_uri FROM scan_sessions WHERE id = ?',
    [sessionId]
  );
  if (existing?.snapshot_uri) {
    deleteSandboxFileQuietly(existing.snapshot_uri);
  }
  await db.runAsync('DELETE FROM scan_sessions WHERE id = ?', [sessionId]);
}

export async function adminListFavorites(limit = 100): Promise<AdminFavoriteRecord[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT f.user_id, f.track_id, f.created_at,
            u.username, u.display_name,
            t.title, t.artist, t.mood, t.language
     FROM favorites f
     JOIN users u ON u.id = f.user_id
     JOIN tracks t ON t.id = f.track_id
     ORDER BY f.created_at DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map((r) => ({
    userId: Number(r.user_id),
    username: String(r.username || ''),
    displayName: String(r.display_name || r.username || ''),
    trackId: Number(r.track_id),
    title: String(r.title || ''),
    artist: String(r.artist || ''),
    mood: (r.mood as MoodType) || 'neutral',
    language: r.language === 'tr' ? 'tr' : 'global',
    createdAt: String(r.created_at),
  }));
}

export async function adminDeleteTrack(trackId: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM tracks WHERE id = ?', [trackId]);
}

export async function adminCleanOrphanSnapshots(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ snapshot_uri: string | null }>(
    'SELECT snapshot_uri FROM scan_sessions WHERE snapshot_uri IS NOT NULL'
  );
  const activeUris = new Set(rows.map((r) => r.snapshot_uri).filter(Boolean) as string[]);

  let removed = 0;
  try {
    const dir = new Directory(Paths.document, SNAPSHOTS_DIR_NAME);
    if (dir.exists) {
      for (const entry of dir.list()) {
        if (entry instanceof File && !activeUris.has(entry.uri)) {
          entry.delete();
          removed++;
        }
      }
    }
  } catch {
    // Ignore filesystem traversal error
  }
  return removed;
}

export async function adminInspectTable(
  tableName: AdminTableName,
  limit = 60
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; totalCount: number }> {
  if (!ADMIN_ALLOWED_TABLES[tableName]) {
    throw new Error('Geçersiz tablo adı.');
  }

  const db = await getDatabase();
  const [colInfos, countRow, rawRows] = await Promise.all([
    db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`),
    db.getFirstAsync<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${tableName}`),
    db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT ?`,
      [limit]
    ),
  ]);

  return {
    columns: colInfos.map((c) => c.name),
    rows: rawRows.map(maskSensitiveRow),
    totalCount: Number(countRow?.cnt || 0),
  };
}

export async function adminRunReadOnlyQuery(sql: string): Promise<{
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  elapsedMs: number;
}> {
  const cleaned = sql.trim().replace(/;+\s*$/, '');
  if (!cleaned) {
    throw new Error('Çalıştırmak için bir SQL sorgusu yazın.');
  }
  if (cleaned.includes(';')) {
    throw new Error('Güvenlik nedeniyle tek seferde yalnızca bir salt-okunur sorgu çalıştırılabilir.');
  }
  if (!/^(select|pragma|explain)\b/i.test(cleaned)) {
    throw new Error('Konsol yalnızca SELECT, PRAGMA ve EXPLAIN sorgularını destekler.');
  }

  const db = await getDatabase();
  const started = Date.now();
  const allRows = await db.getAllAsync<Record<string, unknown>>(cleaned);
  const elapsedMs = Math.max(1, Date.now() - started);

  const maskedRows = allRows.slice(0, 100).map(maskSensitiveRow);
  const columns = maskedRows.length > 0 ? Object.keys(maskedRows[0]) : [];

  return {
    columns,
    rows: maskedRows,
    totalRows: allRows.length,
    elapsedMs,
  };
}
