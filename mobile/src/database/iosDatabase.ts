import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { pcServerFetch } from '../services/moodAiService';
import { EmotionType, MoodType } from '../theme/colors';

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

const PREFS_FILENAME = 'moodsync_client_prefs.json';
let memoryPrefs: Record<string, string> | null = null;
let phoneStoragePurged = false;

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
    file.writeSync(JSON.stringify(next));
  } catch {
    // Ignore if filesystem write fails
  }
}

/**
 * Deletes any legacy on-device SQLite databases & temporary camera cache files
 * from the iPhone so 100% of data (users, songs, photos, scan history) lives ONLY
 * inside MoodSync-iOS-Project/webapp/data/moodsync.db on the PC!
 */
export async function purgePhoneLocalStorage(): Promise<void> {
  if (phoneStoragePurged) return;
  phoneStoragePurged = true;

  for (const legacyDbName of ['moodsync_ios_v2.db', 'moodsync_ios.db']) {
    try {
      await SQLite.deleteDatabaseAsync(legacyDbName);
    } catch {
      // Already deleted or never created on this device
    }
  }

  // Also clean up leftover Camera / ImagePicker temporary JPEG files in app cache
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

export async function getDatabase(): Promise<void> {
  await purgePhoneLocalStorage();
}

// ───────────────────────── Tiny Client Token & URL Preferences (< 150 bytes) ─────────────────────────

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

// ───────────────────────── Mappers (PC Server JSON -> Mobile Records) ─────────────────────────

function mapServerUser(u: any): UserRecord {
  return {
    id: Number(u.id),
    username: String(u.username),
    displayName: String(u.displayName || u.username),
    createdAt: String(u.createdAt || new Date().toISOString()),
  };
}

function mapServerTrack(t: any): TrackRecord {
  return {
    id: Number(t.id),
    externalSource: String(t.source || t.externalSource || 'itunes'),
    externalId: String(t.externalId || ''),
    title: String(t.title || ''),
    artist: String(t.artist || ''),
    album: String(t.album || ''),
    genre: String(t.genre || 'Pop'),
    mood: (t.mood as MoodType) || 'neutral',
    energyTag: String(t.energyTag || 'balanced'),
    language: t.language === 'tr' ? 'tr' : 'global',
    artworkUrl: String(t.artworkUrl || ''),
    previewUrl: String(t.previewUrl || ''),
    storeUrl: String(t.storeUrl || ''),
    youtubeUrl: String(t.youtubeUrl || ''),
    durationMs: Number(t.durationMs || 0),
    popularity: Number(t.popularity || 65),
    isFavorite: Boolean(t.isFavorite),
  };
}

function mapServerSession(s: any, fallbackUserId: number): ScanSessionRecord {
  const tracks = Array.isArray(s.tracks) ? s.tracks.map(mapServerTrack) : undefined;
  return {
    id: Number(s.id),
    userId: Number(s.userId || fallbackUserId),
    mood: (s.mood as MoodType) || 'neutral',
    emotion: (s.emotion as EmotionType) || null,
    confidence: Number(s.confidence || 0),
    snapshotUri: s.snapshotDataUrl || s.snapshotUri || null,
    deviceLabel: String(s.deviceLabel || 'iPhone Kamera'),
    trackCount: tracks ? tracks.length : Number(s.trackCount || 0),
    createdAt: String(s.createdAt || new Date().toISOString()),
    tracks,
  };
}

function mapServerStats(st: any): DashboardStats {
  return {
    totalScans: Number(st?.totalScans || 0),
    dominantMood: (st?.dominantMood as MoodType) || null,
    dominantEmotion: (st?.dominantEmotion as EmotionType) || null,
    favoriteCount: Number(st?.favoriteTracksCount ?? st?.favoriteCount ?? 0),
    catalogTotal: Number(st?.catalog?.total ?? st?.catalogTotal ?? 644),
  };
}

// ───────────────────────── Auth (Stored in PC's webapp/data/moodsync.db) ─────────────────────────

export async function loginUser(username: string, password: string): Promise<UserRecord | null> {
  const clean = username.trim();
  if (!clean || !password) return null;
  try {
    const res = await pcServerFetch<{ token: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: { username: clean, password },
    });
    if (!res?.token || !res?.user) return null;
    await setSetting('auth_token', res.token);
    return mapServerUser(res.user);
  } catch (err: any) {
    if (err?.status === 401) {
      return null;
    }
    throw err;
  }
}

export async function registerUser(
  displayName: string,
  username: string,
  password: string
): Promise<UserRecord> {
  const res = await pcServerFetch<{ token: string; user: any }>('/api/auth/register', {
    method: 'POST',
    body: {
      username: username.trim(),
      password,
      displayName: displayName.trim() || username.trim(),
    },
  });
  await setSetting('auth_token', res.token);
  return mapServerUser(res.user);
}

export async function restoreActiveUser(): Promise<UserRecord | null> {
  const token = await getSetting('auth_token');
  if (!token) return null;
  try {
    const res = await pcServerFetch<{ user: any }>('/api/auth/me', {
      method: 'GET',
      token,
      timeoutMs: 4500,
    });
    return res?.user ? mapServerUser(res.user) : null;
  } catch (err: any) {
    if (err?.status === 401) {
      await setSetting('auth_token', null);
    }
    return null;
  }
}

export async function logoutActiveUser(): Promise<void> {
  const token = await getSetting('auth_token');
  await setSetting('auth_token', null);
  if (token) {
    try {
      await pcServerFetch('/api/auth/logout', { method: 'POST', token, timeoutMs: 3000 });
    } catch {
      // Ignore network error during logout
    }
  }
}

// ───────────────────────── Music Catalog & Favorites on PC Server ─────────────────────────

export async function selectPlaylistForMood(
  mood: MoodType,
  _userId: number,
  count = 16,
  language: 'all' | 'tr' | 'global' = 'all',
  emotion?: EmotionType | null
): Promise<TrackRecord[]> {
  const res = await pcServerFetch<{ tracks: any[] }>('/api/music/expand', {
    method: 'POST',
    body: {
      mood,
      emotion: emotion || null,
      language,
      limit: count,
    },
    timeoutMs: 14000,
  });
  return Array.isArray(res?.tracks) ? res.tracks.map(mapServerTrack) : [];
}

export async function queryCatalogTracks(options: {
  userId: number;
  mood?: MoodType | '';
  language?: 'tr' | 'global' | '';
  search?: string;
  favoritesOnly?: boolean;
  limit?: number;
}): Promise<TrackRecord[]> {
  const qParams: string[] = [`limit=${options.limit || 140}`];
  if (options.mood) qParams.push(`mood=${encodeURIComponent(options.mood)}`);
  if (options.language) qParams.push(`language=${encodeURIComponent(options.language)}`);
  if (options.search && options.search.trim()) {
    qParams.push(`q=${encodeURIComponent(options.search.trim())}`);
  }
  if (options.favoritesOnly) {
    qParams.push('favoritesOnly=true');
  }

  const res = await pcServerFetch<{ tracks: any[] }>(`/api/tracks?${qParams.join('&')}`, {
    method: 'GET',
  });
  return Array.isArray(res?.tracks) ? res.tracks.map(mapServerTrack) : [];
}

export async function toggleFavoriteTrack(_userId: number, trackId: number): Promise<boolean> {
  const res = await pcServerFetch<{ trackId: number; isFavorite: boolean }>(
    `/api/tracks/${trackId}/favorite`,
    { method: 'POST' }
  );
  return Boolean(res?.isFavorite);
}

// ───────────────────────── Camera Capture & Scan Sessions on PC Server ─────────────────────────

/**
 * Sends the captured JPEG directly to the PC server (/api/scans/capture), which runs
 * YOLOv8 + AffectNet, builds the personalized playlist, and saves the thumbnail + session
 * exclusively inside MoodSync-iOS-Project/webapp/data/moodsync.db on the PC!
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
  const dataUrl = params.imageBase64.startsWith('data:')
    ? params.imageBase64
    : `data:image/jpeg;base64,${params.imageBase64}`;

  const res = await pcServerFetch<{ session: any }>('/api/scans/capture', {
    method: 'POST',
    body: {
      imageDataUrl: dataUrl,
      fallbackMood: params.fallbackMood || 'neutral',
      fallbackEmotion: params.fallbackEmotion || 'neutral',
      fallbackConfidence: params.fallbackConfidence || 0.82,
      deviceLabel: params.deviceLabel,
      captureSource: params.captureSource || 'camera',
      language: params.language || 'all',
      fetchFreshOnline: false,
    },
    timeoutMs: 14000,
  });

  return mapServerSession(res.session, params.userId);
}

export async function listScanSessions(userId: number): Promise<ScanSessionRecord[]> {
  const res = await pcServerFetch<{ scans: any[] }>('/api/scans?limit=60', {
    method: 'GET',
  });
  return Array.isArray(res?.scans)
    ? res.scans.map((s) => mapServerSession(s, userId))
    : [];
}

export async function getScanSessionWithTracks(
  sessionId: number,
  userId: number
): Promise<ScanSessionRecord | null> {
  try {
    const res = await pcServerFetch<{ session: any }>(`/api/scans/${sessionId}`, {
      method: 'GET',
    });
    return res?.session ? mapServerSession(res.session, userId) : null;
  } catch {
    return null;
  }
}

export async function deleteScanSession(sessionId: number, _userId: number): Promise<void> {
  await pcServerFetch(`/api/scans/${sessionId}`, { method: 'DELETE' });
}

export async function getDashboardStats(_userId: number): Promise<DashboardStats> {
  const res = await pcServerFetch<{ stats: any }>('/api/scans?limit=1', {
    method: 'GET',
  });
  return mapServerStats(res?.stats);
}
