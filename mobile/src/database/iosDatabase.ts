import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import {
  authenticateBiometricToken,
  clearBiometricToken,
  enrollBiometricToken,
  excludeAppDataFromBackup,
  hasBiometricToken,
} from '../../modules/moodsync-vision';
import {
  CloudApiError,
  cloudRequest,
  cloudUploadRequest,
  configureCloudAuthHooks,
  warmupCloudApi,
} from '../services/cloudApi';
import { analyzeCameraFrame } from '../services/moodAiService';
import {
  EmotionScores,
  emotionToMood,
  EmotionType,
  MoodStrategy,
  MoodType,
} from '../theme/colors';

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
  | 'scan_session_tracks'
  | 'disliked_tracks'
  | 'playlists'
  | 'playlist_tracks';

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
  emotionScores?: EmotionScores | null;
  note?: string;
  tags?: string[];
  moodStrategy?: MoodStrategy;
  isManualOverride?: boolean;
  snapshotUri: string | null;
  deviceLabel: string;
  trackCount: number;
  createdAt: string;
  tracks?: TrackRecord[];
}

export interface PlaylistRecord {
  id: number;
  userId: number;
  name: string;
  description: string;
  mood: MoodType | null;
  colorHex: string | null;
  trackCount: number;
  coverArtworks: string[];
  createdAt: string;
  updatedAt: string;
  tracks?: TrackRecord[];
}

export interface BiometricBindingInfo {
  userId: number;
  username: string;
  displayName: string;
  role: UserRole;
  enabledAt: string;
  appLockEnabled: boolean;
  adminLockEnabled: boolean;
  keychainPresent: boolean;
}

export interface DashboardStats {
  totalScans: number;
  dominantMood: MoodType | null;
  dominantEmotion?: EmotionType | null;
  favoriteCount: number;
  catalogTotal: number;
}

const PREFS_FILENAME = 'moodsync_client_prefs.json';
const PREF_AUTH_TOKEN = 'cloud_auth_token';
const PREF_ACTIVE_USER_JSON = 'cloud_active_user_json';

let memoryPrefs: Record<string, string> | null = null;

// ───────────────────────── Tiny Client Preferences & Temp Cleanup ─────────────────────────

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
    excludeAppDataFromBackup();
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

function persistAuthSession(token: string, user: UserRecord): void {
  const next = { ...readPrefs() };
  next[PREF_AUTH_TOKEN] = token;
  next[PREF_ACTIVE_USER_JSON] = JSON.stringify(user);
  writePrefs(next);
}

function clearAuthSessionPrefs(): void {
  const next = { ...readPrefs() };
  delete next[PREF_AUTH_TOKEN];
  delete next[PREF_ACTIVE_USER_JSON];
  writePrefs(next);
}

configureCloudAuthHooks(
  () => readPrefs()[PREF_AUTH_TOKEN] || null,
  () => clearAuthSessionPrefs()
);

// ───────────────────────── Lifecycle & Cloud Bootstrap ─────────────────────────

export async function getDatabase(): Promise<boolean> {
  cleanTempCameraCaches();
  excludeAppDataFromBackup();
  void warmupCloudApi();
  return true;
}

export async function wipeAllLocalData(): Promise<void> {
  try {
    await cloudRequest('/api/admin/wipe-all', { method: 'POST' });
  } finally {
    clearBiometricToken();
    const prefs = readPrefs();
    const preservedTheme = prefs.app_theme;
    const resetPrefs: Record<string, string> = preservedTheme ? { app_theme: preservedTheme } : {};
    writePrefs(resetPrefs);
    cleanTempCameraCaches();
  }
}

export async function getSandboxStorageSummary(): Promise<{
  photoCount: number;
  trackCount: number;
  scanCount: number;
}> {
  try {
    return await cloudRequest('/api/storage/summary');
  } catch {
    return { photoCount: 0, trackCount: 0, scanCount: 0 };
  }
}

// ───────────────────────── Auth (Azure Cloud + JWT) ─────────────────────────

export async function loginUser(username: string, password: string): Promise<UserRecord | null> {
  const clean = username.trim();
  if (!clean || !password) return null;

  try {
    const res = await cloudRequest<{ token: string; user: UserRecord }>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { username: clean, password },
    });
    persistAuthSession(res.token, res.user);
    return res.user;
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 401) {
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
  const cleanUser = username.trim();
  const cleanName = displayName.trim() || cleanUser;
  if (cleanUser.length < 3) {
    throw new Error('Kullanıcı adı en az 3 karakter olmalıdır.');
  }
  if (password.length < 4) {
    throw new Error('Şifre en az 4 karakter olmalıdır.');
  }

  const res = await cloudRequest<{ token: string; user: UserRecord }>('/api/auth/register', {
    method: 'POST',
    auth: false,
    body: { displayName: cleanName, username: cleanUser, password },
  });
  persistAuthSession(res.token, res.user);
  return res.user;
}

export async function restoreActiveUser(): Promise<UserRecord | null> {
  const prefs = readPrefs();
  const token = prefs[PREF_AUTH_TOKEN];
  if (!token) return null;

  try {
    const res = await cloudRequest<{ user: UserRecord }>('/api/auth/me', {
      method: 'GET',
      timeoutMs: 12000,
    });
    persistAuthSession(token, res.user);
    return res.user;
  } catch (err) {
    if (err instanceof CloudApiError && (err.status === 401 || err.status === 404)) {
      clearAuthSessionPrefs();
      return null;
    }
    const cachedRaw = prefs[PREF_ACTIVE_USER_JSON];
    if (cachedRaw) {
      try {
        const parsed = JSON.parse(cachedRaw) as UserRecord;
        if (parsed && parsed.id && parsed.username) {
          return parsed;
        }
      } catch {
        // Ignore malformed cache
      }
    }
    return null;
  }
}

export async function logoutActiveUser(): Promise<void> {
  clearAuthSessionPrefs();
}

// ───────────────────────── Account-Bound Face ID (Azure + Keychain .biometryCurrentSet) ─────────────────────────

const PREF_BIO_USER_ID = 'biometric_user_id';
const PREF_BIO_USERNAME = 'biometric_username';
const PREF_BIO_DISPLAY_NAME = 'biometric_display_name';
const PREF_BIO_ROLE = 'biometric_user_role';
const PREF_BIO_ENABLED_AT = 'biometric_enabled_at';
const PREF_BIO_APP_LOCK = 'biometric_app_lock';
const PREF_BIO_ADMIN_LOCK = 'biometric_admin_lock';

function clearLocalBiometricPrefs(): void {
  const next = { ...readPrefs() };
  delete next[PREF_BIO_USER_ID];
  delete next[PREF_BIO_USERNAME];
  delete next[PREF_BIO_DISPLAY_NAME];
  delete next[PREF_BIO_ROLE];
  delete next[PREF_BIO_ENABLED_AT];
  delete next[PREF_BIO_APP_LOCK];
  delete next[PREF_BIO_ADMIN_LOCK];
  writePrefs(next);
}

export async function disableBiometricBinding(): Promise<void> {
  if (readPrefs()[PREF_AUTH_TOKEN]) {
    try {
      await cloudRequest('/api/auth/biometric', { method: 'DELETE' });
    } catch {
      // Best-effort remote cleanup
    }
  }
  clearBiometricToken();
  clearLocalBiometricPrefs();
}

export async function getBiometricBinding(): Promise<BiometricBindingInfo | null> {
  const prefs = readPrefs();
  const rawUid = prefs[PREF_BIO_USER_ID];
  const username = prefs[PREF_BIO_USERNAME];
  if (!rawUid || !username) return null;

  const uid = Number(rawUid);
  if (!Number.isFinite(uid) || uid <= 0 || !hasBiometricToken()) {
    clearBiometricToken();
    clearLocalBiometricPrefs();
    return null;
  }

  return {
    userId: uid,
    username,
    displayName: prefs[PREF_BIO_DISPLAY_NAME] || username,
    role: prefs[PREF_BIO_ROLE] === 'admin' || username.toLowerCase() === 'haluk' ? 'admin' : 'user',
    enabledAt: prefs[PREF_BIO_ENABLED_AT] || '',
    appLockEnabled: false,
    adminLockEnabled: false,
    keychainPresent: true,
  };
}

export async function enableBiometricBindingForUser(
  user: UserRecord,
  options?: { appLockEnabled?: boolean; adminLockEnabled?: boolean }
): Promise<{ ok: boolean; binding?: BiometricBindingInfo; cancelled?: boolean; error?: string }> {
  const randomBytes = Crypto.getRandomBytes(32);
  let token = '';
  for (let i = 0; i < randomBytes.length; i++) {
    token += randomBytes[i].toString(16).padStart(2, '0');
  }

  const enrollRes = await enrollBiometricToken(
    token,
    `Face ID’yi @${user.username} hesabıyla eşleştirmek için doğrulayın`
  );
  if (!enrollRes.success) {
    return {
      ok: false,
      cancelled: enrollRes.cancelled,
      error: enrollRes.error || 'Face ID eşleştirmesi tamamlanamadı.',
    };
  }

  try {
    await cloudRequest('/api/auth/biometric/enroll', {
      method: 'POST',
      body: { biometricToken: token },
    });
  } catch (err: any) {
    clearBiometricToken();
    return {
      ok: false,
      error: err?.message || 'Face ID Azure sunucusuna kaydedilemedi.',
    };
  }

  const now = new Date().toISOString();
  const next = { ...readPrefs() };
  next[PREF_BIO_USER_ID] = String(user.id);
  next[PREF_BIO_USERNAME] = user.username;
  next[PREF_BIO_DISPLAY_NAME] = user.displayName;
  next[PREF_BIO_ROLE] = user.role;
  next[PREF_BIO_ENABLED_AT] = now;
  next[PREF_BIO_APP_LOCK] = options?.appLockEnabled ? '1' : '0';
  next[PREF_BIO_ADMIN_LOCK] = options?.adminLockEnabled ? '1' : '0';
  writePrefs(next);

  const binding = await getBiometricBinding();
  return { ok: true, binding: binding || undefined };
}

export async function updateBiometricLockOptions(opts: {
  appLockEnabled?: boolean;
  adminLockEnabled?: boolean;
}): Promise<BiometricBindingInfo | null> {
  const next = { ...readPrefs() };
  if (opts.appLockEnabled !== undefined) {
    next[PREF_BIO_APP_LOCK] = opts.appLockEnabled ? '1' : '0';
  }
  if (opts.adminLockEnabled !== undefined) {
    next[PREF_BIO_ADMIN_LOCK] = opts.adminLockEnabled ? '1' : '0';
  }
  writePrefs(next);
  return getBiometricBinding();
}

export async function authenticateWithBiometric(reason?: string): Promise<{
  user: UserRecord | null;
  cancelled?: boolean;
  invalidated?: boolean;
  error?: string;
}> {
  const binding = await getBiometricBinding();
  if (!binding) {
    return { user: null, error: 'Face ID ile eşleştirilmiş hesap bulunamadı.' };
  }

  const authRes = await authenticateBiometricToken(
    reason || 'MoodSync hesabınıza giriş yapmak için Face ID doğrulayın'
  );

  if (authRes.invalidated) {
    await disableBiometricBinding();
    return {
      user: null,
      invalidated: true,
      error:
        authRes.error ||
        'Cihazın Face ID ayarları değiştiği için eşleştirme güvenlik nedeniyle sıfırlandı.',
    };
  }

  if (!authRes.success || !authRes.token) {
    return {
      user: null,
      cancelled: authRes.cancelled,
      error: authRes.error || 'Face ID doğrulaması başarısız oldu.',
    };
  }

  try {
    const res = await cloudRequest<{ token: string; user: UserRecord }>('/api/auth/biometric/login', {
      method: 'POST',
      auth: false,
      body: { biometricToken: authRes.token },
    });
    persistAuthSession(res.token, res.user);
    return { user: res.user };
  } catch (err: any) {
    if (err instanceof CloudApiError && err.status === 401) {
      clearBiometricToken();
      clearLocalBiometricPrefs();
      return {
        user: null,
        invalidated: true,
        error: err.message || 'Face ID eşleştirmesi sunucuda geçersiz kaldı.',
      };
    }
    return {
      user: null,
      error: err?.message || 'Face ID ile bulut girişi yapılamadı.',
    };
  }
}

// ───────────────────────── Cloud Music Catalog & Preferences ─────────────────────────

export async function ensureRichCatalogSeeded(_minTracks = 180): Promise<number> {
  // Catalog already lives permanently in Azure PostgreSQL (thousands of tracks)
  return 0;
}

export async function fetchAndStoreOnlineSongs(params: {
  mood: MoodType;
  emotion?: EmotionType | null;
  language?: 'all' | 'tr' | 'global';
  customQuery?: string;
}): Promise<number> {
  const res = await cloudRequest<{ added: number }>('/api/tracks/pull-online', {
    method: 'POST',
    body: params,
  });
  return Number(res.added || 0);
}

export async function queryCatalogTracksPage(options: {
  userId: number;
  mood?: MoodType | '';
  language?: 'tr' | 'global' | '';
  search?: string;
  favoritesOnly?: boolean;
  includeDisliked?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ tracks: TrackRecord[]; totalCount: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (options.mood) params.set('mood', options.mood);
  if (options.language) params.set('language', options.language);
  if (options.search && options.search.trim()) params.set('search', options.search.trim());
  if (options.favoritesOnly) params.set('favoritesOnly', 'true');
  if (options.includeDisliked) params.set('includeDisliked', 'true');
  params.set('page', String(options.page || 1));
  params.set('pageSize', String(options.pageSize || 30));

  const res = await cloudRequest<{
    tracks: TrackRecord[];
    totalCount: number;
    page: number;
    pageSize: number;
  }>(`/api/tracks?${params.toString()}`);

  return {
    tracks: Array.isArray(res.tracks) ? res.tracks : [],
    totalCount: Number(res.totalCount || 0),
    page: Number(res.page || 1),
    pageSize: Number(res.pageSize || 30),
  };
}

export async function queryCatalogTracks(options: {
  userId: number;
  mood?: MoodType | '';
  language?: 'tr' | 'global' | '';
  search?: string;
  favoritesOnly?: boolean;
  includeDisliked?: boolean;
  limit?: number;
}): Promise<TrackRecord[]> {
  const params = new URLSearchParams();
  if (options.mood) params.set('mood', options.mood);
  if (options.language) params.set('language', options.language);
  if (options.search && options.search.trim()) params.set('search', options.search.trim());
  if (options.favoritesOnly) params.set('favoritesOnly', 'true');
  if (options.includeDisliked) params.set('includeDisliked', 'true');
  params.set('limit', String(options.limit || 400));

  const res = await cloudRequest<{ tracks: TrackRecord[] }>(`/api/tracks?${params.toString()}`);
  return Array.isArray(res.tracks) ? res.tracks : [];
}

export async function toggleFavoriteTrack(_userId: number, trackId: number): Promise<boolean> {
  const res = await cloudRequest<{ liked: boolean }>(`/api/tracks/${trackId}/favorite`, {
    method: 'POST',
  });
  return Boolean(res.liked);
}

export async function dislikeTrack(_userId: number, trackId: number): Promise<void> {
  await cloudRequest(`/api/tracks/${trackId}/dislike`, { method: 'POST' });
}

export async function listDislikedTracks(_userId: number): Promise<TrackRecord[]> {
  const res = await cloudRequest<{ tracks: TrackRecord[] }>('/api/tracks/disliked');
  return Array.isArray(res.tracks) ? res.tracks : [];
}

export async function undislikeTrack(_userId: number, trackId: number): Promise<void> {
  await cloudRequest(`/api/tracks/${trackId}/dislike`, { method: 'DELETE' });
}

// ───────────────────────── On-Device AI + Azure Scan Sessions & Private Blob Photos ─────────────────────────

export async function captureAndSaveSessionOnServer(params: {
  userId: number;
  imageBase64: string;
  fallbackMood?: MoodType | null;
  fallbackEmotion?: EmotionType | null;
  fallbackConfidence?: number | null;
  deviceLabel: string;
  captureSource?: 'camera' | 'upload';
  language?: 'all' | 'tr' | 'global';
  moodStrategy?: MoodStrategy;
}): Promise<ScanSessionRecord> {
  // 1. Run AffectNet + Apple Vision emotion detection 100% on-device
  const det = await analyzeCameraFrame(params.imageBase64, true);

  const finalEmotion: EmotionType =
    det.detected && det.emotion ? det.emotion : params.fallbackEmotion || 'neutral';
  const finalMood: MoodType =
    det.detected && det.mood ? det.mood : params.fallbackMood || emotionToMood(finalEmotion);
  const finalConfidence =
    det.detected && det.confidence > 0 ? det.confidence : params.fallbackConfidence || 0.82;

  cleanTempCameraCaches();

  // 2. Upload photo to private Azure Blob Storage & save session/tracks in Azure PostgreSQL
  const res = await cloudUploadRequest<{ session: ScanSessionRecord }>('/api/scans', {
    mood: finalMood,
    emotion: finalEmotion,
    confidence: finalConfidence,
    emotionScores: det.emotionScores || null,
    deviceLabel: params.deviceLabel,
    language: params.language || 'all',
    moodStrategy: params.moodStrategy || 'match',
    imageBase64: params.imageBase64,
  });

  return res.session;
}

export async function listScanSessions(_userId: number): Promise<ScanSessionRecord[]> {
  const res = await cloudRequest<{ sessions: ScanSessionRecord[] }>('/api/scans');
  return Array.isArray(res.sessions) ? res.sessions : [];
}

export async function getScanSessionWithTracks(
  sessionId: number,
  _userId: number
): Promise<ScanSessionRecord | null> {
  try {
    const res = await cloudRequest<{ session: ScanSessionRecord }>(`/api/scans/${sessionId}`);
    return res.session || null;
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return null;
    throw err;
  }
}

export async function updateScanSessionMoodOrStrategy(params: {
  sessionId: number;
  userId: number;
  emotion?: EmotionType;
  strategy?: MoodStrategy;
  language?: 'all' | 'tr' | 'global';
  isManualOverride?: boolean;
}): Promise<ScanSessionRecord | null> {
  const res = await cloudRequest<{ session: ScanSessionRecord }>(
    `/api/scans/${params.sessionId}/mood`,
    {
      method: 'PATCH',
      body: {
        emotion: params.emotion,
        strategy: params.strategy,
        language: params.language,
        isManualOverride: params.isManualOverride,
      },
    }
  );
  return res.session || null;
}

export async function updateScanSessionJournal(params: {
  sessionId: number;
  userId: number;
  note: string;
  tags: string[];
}): Promise<ScanSessionRecord | null> {
  const res = await cloudRequest<{ session: ScanSessionRecord }>(
    `/api/scans/${params.sessionId}/journal`,
    {
      method: 'PATCH',
      body: { note: params.note, tags: params.tags },
    }
  );
  return res.session || null;
}

export async function expandScanSessionTracks(params: {
  sessionId: number;
  userId: number;
  addCount?: number;
  language?: 'all' | 'tr' | 'global';
}): Promise<{ session: ScanSessionRecord; addedCount: number } | null> {
  const res = await cloudRequest<{ session: ScanSessionRecord; addedCount: number }>(
    `/api/scans/${params.sessionId}/expand`,
    {
      method: 'POST',
      body: { addCount: params.addCount ?? 8, language: params.language || 'all' },
    }
  );
  if (!res.session) return null;
  return { session: res.session, addedCount: Number(res.addedCount || 0) };
}

export async function deleteScanSession(sessionId: number, _userId: number): Promise<void> {
  await cloudRequest(`/api/scans/${sessionId}`, { method: 'DELETE' });
}

export async function getDashboardStats(_userId: number): Promise<DashboardStats> {
  return cloudRequest<DashboardStats>('/api/dashboard/stats');
}

export async function clearUserScanSessions(_userId: number): Promise<number> {
  const res = await cloudRequest<{ removed: number }>('/api/scans', { method: 'DELETE' });
  return Number(res.removed || 0);
}

// ───────────────────────── Admin Panel & Cloud PostgreSQL Explorer ─────────────────────────

export async function getAdminDatabaseOverview(): Promise<AdminDatabaseOverview> {
  const ov = await cloudRequest<AdminDatabaseOverview>('/api/admin/overview');
  return {
    ...ov,
    prefs: { ...readPrefs() },
  };
}

export async function adminListUsers(): Promise<AdminUserSummary[]> {
  const res = await cloudRequest<{ users: AdminUserSummary[] }>('/api/admin/users');
  return Array.isArray(res.users) ? res.users : [];
}

export async function adminCreateUser(
  displayName: string,
  username: string,
  password: string
): Promise<UserRecord> {
  const res = await cloudRequest<{ user: UserRecord }>('/api/admin/users', {
    method: 'POST',
    body: { displayName, username, password },
  });
  return res.user;
}

export async function adminResetUserPassword(
  targetUserId: number,
  newPassword: string
): Promise<void> {
  await cloudRequest(`/api/admin/users/${targetUserId}/password`, {
    method: 'PATCH',
    body: { newPassword },
  });
}

export async function adminDeleteUser(targetUserId: number): Promise<void> {
  await cloudRequest(`/api/admin/users/${targetUserId}`, { method: 'DELETE' });
  if (String(targetUserId) === readPrefs()[PREF_BIO_USER_ID]) {
    clearBiometricToken();
    clearLocalBiometricPrefs();
  }
}

export async function adminListAllScanSessions(
  limit = 100,
  filterUserId?: number | null
): Promise<AdminScanSessionRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (typeof filterUserId === 'number' && filterUserId > 0) {
    params.set('userId', String(filterUserId));
  }
  const res = await cloudRequest<{ scans: AdminScanSessionRecord[] }>(
    `/api/admin/scans?${params.toString()}`
  );
  return Array.isArray(res.scans) ? res.scans : [];
}

export async function adminGetScanSessionWithTracks(
  sessionId: number
): Promise<AdminScanSessionRecord | null> {
  try {
    const res = await cloudRequest<{ session: AdminScanSessionRecord }>(
      `/api/admin/scans/${sessionId}`
    );
    return res.session || null;
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return null;
    throw err;
  }
}

export async function adminDeleteScanSession(sessionId: number): Promise<void> {
  await cloudRequest(`/api/admin/scans/${sessionId}`, { method: 'DELETE' });
}

export async function adminListFavorites(limit = 100): Promise<AdminFavoriteRecord[]> {
  const res = await cloudRequest<{ favorites: AdminFavoriteRecord[] }>(
    `/api/admin/favorites?limit=${limit}`
  );
  return Array.isArray(res.favorites) ? res.favorites : [];
}

export async function adminDeleteTrack(trackId: number): Promise<void> {
  await cloudRequest(`/api/admin/tracks/${trackId}`, { method: 'DELETE' });
}

export async function adminCleanOrphanSnapshots(): Promise<number> {
  const res = await cloudRequest<{ removed: number }>('/api/admin/clean-orphans', {
    method: 'POST',
  });
  return Number(res.removed || 0);
}

export async function adminSeedCloudCatalog(
  tracksPerArtist = 12
): Promise<{ totalFetched: number; totalCatalog: number }> {
  return cloudRequest<{ totalFetched: number; totalCatalog: number }>('/api/admin/seed-catalog', {
    method: 'POST',
    timeoutMs: 120000,
    body: { tracksPerArtist },
  });
}

export async function adminInspectTable(
  tableName: AdminTableName,
  limit = 60
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; totalCount: number }> {
  return cloudRequest(`/api/admin/tables/${tableName}?limit=${limit}`);
}

export async function adminRunReadOnlyQuery(sql: string): Promise<{
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  elapsedMs: number;
}> {
  return cloudRequest('/api/admin/sql', {
    method: 'POST',
    body: { sql },
  });
}

// ───────────────────────── Custom User Playlists (CRUD) ─────────────────────────

export async function listUserPlaylists(_userId: number): Promise<PlaylistRecord[]> {
  const res = await cloudRequest<{ playlists: PlaylistRecord[] }>('/api/playlists');
  return Array.isArray(res.playlists) ? res.playlists : [];
}

export async function getPlaylistWithTracks(
  playlistId: number,
  _userId: number
): Promise<PlaylistRecord | null> {
  try {
    const res = await cloudRequest<{ playlist: PlaylistRecord }>(`/api/playlists/${playlistId}`);
    return res.playlist || null;
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return null;
    throw err;
  }
}

export async function createPlaylist(params: {
  userId: number;
  name: string;
  description?: string;
  mood?: MoodType | null;
  colorHex?: string | null;
  initialTrackIds?: number[];
}): Promise<PlaylistRecord> {
  const res = await cloudRequest<{ playlist: PlaylistRecord }>('/api/playlists', {
    method: 'POST',
    body: {
      name: params.name,
      description: params.description,
      mood: params.mood,
      colorHex: params.colorHex,
      initialTrackIds: params.initialTrackIds,
    },
  });
  return res.playlist;
}

export async function renamePlaylist(
  playlistId: number,
  _userId: number,
  name: string,
  description?: string
): Promise<void> {
  await cloudRequest(`/api/playlists/${playlistId}`, {
    method: 'PATCH',
    body: { name, description },
  });
}

export async function deletePlaylist(playlistId: number, _userId: number): Promise<void> {
  await cloudRequest(`/api/playlists/${playlistId}`, { method: 'DELETE' });
}

export async function addTracksToPlaylist(
  playlistId: number,
  _userId: number,
  trackIds: number[]
): Promise<number> {
  const res = await cloudRequest<{ added: number }>(`/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: { trackIds },
  });
  return Number(res.added || 0);
}

export async function removeTrackFromPlaylist(
  playlistId: number,
  _userId: number,
  trackId: number
): Promise<void> {
  await cloudRequest(`/api/playlists/${playlistId}/tracks/${trackId}`, {
    method: 'DELETE',
  });
}
