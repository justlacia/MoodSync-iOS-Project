import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import path from 'path';
import {
  AuthenticatedRequest,
  hashBiometricToken,
  requireAdmin,
  requireAuth,
  signAuthToken,
} from './auth';
import {
  cleanOrphanSnapshotBlobs,
  deleteSnapshotBlob,
  getBlobStorageStats,
  getSnapshotReadUrl,
  listSnapshotBlobs,
  uploadSnapshotBlob,
} from './blobStorage';
import { config } from './config';
import {
  getPool,
  initDatabase,
  mapScanSessionFields,
  mapTrackRow,
  resolveRole,
} from './db';
import {
  fetchOnlineTracksBatch,
  seedFullCloudCatalog,
  selectPlaylistForMood,
  upsertTracksPg,
} from './musicCatalog';
import {
  AdminTableName,
  EmotionType,
  MoodStrategy,
  MoodType,
  PlaylistRecord,
  ScanSessionRecord,
  UserRecord,
} from './types';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const ADMIN_ALLOWED_TABLES: Record<AdminTableName, true> = {
  users: true,
  scan_sessions: true,
  tracks: true,
  favorites: true,
  scan_session_tracks: true,
  disliked_tracks: true,
  playlists: true,
  playlist_tracks: true,
  biometric_tokens: true,
  user_settings: true,
};

function toUserRecord(row: any): UserRecord {
  const uname = String(row.username);
  return {
    id: Number(row.id),
    username: uname,
    displayName: String(row.display_name || uname),
    role: resolveRole(uname, row.role),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function maskSensitiveRow(row: Record<string, unknown>): Record<string, unknown> {
  let next = row;
  if ('password_hash' in next) {
    const val = next.password_hash;
    next = {
      ...next,
      password_hash: typeof val === 'string' ? `bcrypt:${val.slice(0, 12)}…` : val,
    };
  }
  if ('token_hash' in next) {
    const val = next.token_hash;
    next = {
      ...next,
      token_hash: typeof val === 'string' ? `sha256:${val.slice(0, 12)}…` : val,
    };
  }
  return next;
}

async function getScanSessionWithTracks(
  sessionId: number,
  userId?: number
): Promise<(ScanSessionRecord & { username?: string; displayName?: string }) | null> {
  const db = getPool();
  const res = userId
    ? await db.query('SELECT * FROM scan_sessions WHERE id = $1 AND user_id = $2', [
        sessionId,
        userId,
      ])
    : await db.query(
        `SELECT s.*, u.username, u.display_name
         FROM scan_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1`,
        [sessionId]
      );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const ownerId = Number(row.user_id);

  const trackRes = await db.query(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM scan_session_tracks sst
     JOIN tracks t ON t.id = sst.track_id
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = $1
     WHERE sst.session_id = $2
     ORDER BY sst.position ASC`,
    [ownerId, sessionId]
  );

  const tracks = trackRes.rows.map(mapTrackRow);
  return {
    ...mapScanSessionFields({ ...row, track_count: tracks.length }),
    ...(row.username
      ? {
          username: String(row.username),
          displayName: String(row.display_name || row.username),
        }
      : {}),
    tracks,
  };
}

async function getPlaylistWithTracks(
  playlistId: number,
  userId: number
): Promise<PlaylistRecord | null> {
  const db = getPool();
  const res = await db.query('SELECT * FROM playlists WHERE id = $1 AND user_id = $2', [
    playlistId,
    userId,
  ]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];

  const trackRes = await db.query(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = $1
     WHERE pt.playlist_id = $2
     ORDER BY pt.position ASC`,
    [userId, playlistId]
  );

  const tracks = trackRes.rows.map(mapTrackRow);
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: String(row.name || ''),
    description: String(row.description || ''),
    mood: (row.mood as MoodType) || null,
    colorHex: row.color_hex ? String(row.color_hex) : null,
    trackCount: tracks.length,
    coverArtworks: tracks
      .map((t) => t.artworkUrl)
      .filter(Boolean)
      .slice(0, 4),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    tracks,
  };
}

// ───────────────────────── Health ─────────────────────────

async function handleHealthCheck(_req: express.Request, res: express.Response) {
  try {
    await initDatabase();
    const db = getPool();
    const r = await db.query('SELECT COUNT(*)::int AS tracks FROM tracks');
    res.json({
      ok: true,
      service: 'moodsync-cloud-api',
      catalogTracks: Number(r.rows[0]?.tracks || 0),
      region: process.env.WEBSITE_SITE_NAME || 'azure',
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'DB error' });
  }
}

app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

// ───────────────────────── Auth & Biometrics ─────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    await initDatabase();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur.' });
      return;
    }

    const db = getPool();
    const r = await db.query(
      'SELECT id, username, display_name, password_hash, role, created_at FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    if (r.rows.length === 0) {
      res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
      return;
    }
    const row = r.rows[0];
    const ok = await bcrypt.compare(password, String(row.password_hash));
    if (!ok) {
      res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
      return;
    }

    const user = toUserRecord(row);
    const token = signAuthToken(user);
    res.json({ token, user });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Giriş yapılamadı.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    await initDatabase();
    const username = String(req.body?.username || '').trim();
    const displayName = String(req.body?.displayName || '').trim() || username;
    const password = String(req.body?.password || '');

    if (username.length < 3) {
      res.status(400).json({ error: 'Kullanıcı adı en az 3 karakter olmalıdır.' });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır.' });
      return;
    }

    const db = getPool();
    const existing = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [
      username,
    ]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı.' });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const ins = await db.query(
      `INSERT INTO users (username, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, username, display_name, role, created_at`,
      [username, displayName, hash]
    );
    const user = toUserRecord(ins.rows[0]);
    const token = signAuthToken(user);
    res.status(201).json({ token, user });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Kayıt olunamadı.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const db = getPool();
    const r = await db.query(
      'SELECT id, username, display_name, role, created_at FROM users WHERE id = $1',
      [req.authUser!.id]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }
    res.json({ user: toUserRecord(r.rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Profil okunamadı.' });
  }
});

app.post('/api/auth/biometric/enroll', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const rawToken = String(req.body?.biometricToken || '').trim();
    if (rawToken.length < 16) {
      res.status(400).json({ error: 'Geçersiz biyometrik anahtar.' });
      return;
    }
    const tokenHash = hashBiometricToken(rawToken);
    const db = getPool();
    await db.query('DELETE FROM biometric_tokens WHERE user_id = $1', [req.authUser!.id]);
    await db.query('INSERT INTO biometric_tokens (user_id, token_hash) VALUES ($1, $2)', [
      req.authUser!.id,
      tokenHash,
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Face ID sunucuya kaydedilemedi.' });
  }
});

app.delete('/api/auth/biometric', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const db = getPool();
    await db.query('DELETE FROM biometric_tokens WHERE user_id = $1', [req.authUser!.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Face ID kaydı silinemedi.' });
  }
});

app.post('/api/auth/biometric/login', async (req, res) => {
  try {
    await initDatabase();
    const rawToken = String(req.body?.biometricToken || '').trim();
    if (!rawToken) {
      res.status(400).json({ error: 'Biyometrik anahtar eksik.' });
      return;
    }
    const tokenHash = hashBiometricToken(rawToken);
    const db = getPool();
    const r = await db.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.created_at
       FROM biometric_tokens bt
       JOIN users u ON u.id = bt.user_id
       WHERE bt.token_hash = $1`,
      [tokenHash]
    );
    if (r.rows.length === 0) {
      res.status(401).json({ error: 'Face ID kaydı sunucuda bulunamadı.' });
      return;
    }
    const user = toUserRecord(r.rows[0]);
    const token = signAuthToken(user);
    res.json({ token, user });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Face ID girişi başarısız.' });
  }
});

// ───────────────────────── Dashboard & Storage Summary ─────────────────────────

app.get('/api/dashboard/stats', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const db = getPool();
    const [scanCountRes, domMoodRes, favCountRes, catalogRes] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS cnt FROM scan_sessions WHERE user_id = $1', [uid]),
      db.query(
        `SELECT mood, emotion, COUNT(*)::int AS cnt
         FROM scan_sessions
         WHERE user_id = $1
         GROUP BY mood, emotion
         ORDER BY cnt DESC
         LIMIT 1`,
        [uid]
      ),
      db.query('SELECT COUNT(*)::int AS cnt FROM favorites WHERE user_id = $1', [uid]),
      db.query('SELECT COUNT(*)::int AS cnt FROM tracks'),
    ]);

    res.json({
      totalScans: Number(scanCountRes.rows[0]?.cnt || 0),
      dominantMood: (domMoodRes.rows[0]?.mood as MoodType) || null,
      dominantEmotion: (domMoodRes.rows[0]?.emotion as EmotionType) || null,
      favoriteCount: Number(favCountRes.rows[0]?.cnt || 0),
      catalogTotal: Number(catalogRes.rows[0]?.cnt || 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'İstatistikler alınamadı.' });
  }
});

app.get('/api/storage/summary', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const db = getPool();
    const isAdmin = req.authUser!.role === 'admin';
    const [trackRes, scanRes, blobStats] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS cnt FROM tracks'),
      isAdmin
        ? db.query('SELECT COUNT(*)::int AS cnt FROM scan_sessions')
        : db.query('SELECT COUNT(*)::int AS cnt FROM scan_sessions WHERE user_id = $1', [
            req.authUser!.id,
          ]),
      isAdmin
        ? getBlobStorageStats()
        : db
            .query(
              'SELECT COUNT(*)::int AS cnt FROM scan_sessions WHERE user_id = $1 AND snapshot_uri IS NOT NULL',
              [req.authUser!.id]
            )
            .then((r) => ({ photoCount: Number(r.rows[0]?.cnt || 0), photoBytes: 0 })),
    ]);

    res.json({
      photoCount: blobStats.photoCount,
      trackCount: Number(trackRes.rows[0]?.cnt || 0),
      scanCount: Number(scanRes.rows[0]?.cnt || 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Depolama özeti alınamadı.' });
  }
});

// ───────────────────────── Tracks, Favorites, Dislikes ─────────────────────────

app.get('/api/tracks', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const mood = String(req.query.mood || '').trim();
    const language = String(req.query.language || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const favoritesOnly = req.query.favoritesOnly === 'true' || req.query.favoritesOnly === '1';
    const includeDisliked = req.query.includeDisliked === 'true';

    const hasPage = req.query.page !== undefined && String(req.query.page).trim() !== '';
    const page = hasPage ? Math.max(1, Number(req.query.page || 1)) : 1;
    const pageSize = hasPage
      ? Math.min(100, Math.max(1, Number(req.query.pageSize || 30)))
      : Math.min(2000, Math.max(1, Number(req.query.limit || 600)));
    const offset = hasPage ? (page - 1) * pageSize : 0;

    const whereParts: string[] = ['1 = 1'];
    const baseParams: any[] = [uid, uid];
    let pIdx = 3;

    if (!includeDisliked) whereParts.push('dt.track_id IS NULL');
    if (mood) {
      whereParts.push(`t.mood = $${pIdx++}`);
      baseParams.push(mood);
    }
    if (language === 'tr' || language === 'global') {
      whereParts.push(`t.language = $${pIdx++}`);
      baseParams.push(language);
    }
    if (search) {
      whereParts.push(
        `(LOWER(t.title) LIKE $${pIdx} OR LOWER(t.artist) LIKE $${pIdx} OR LOWER(t.genre) LIKE $${pIdx})`
      );
      baseParams.push(`%${search}%`);
      pIdx++;
    }
    if (favoritesOnly) {
      whereParts.push('f.track_id IS NOT NULL');
    }

    const whereSql = whereParts.join(' AND ');
    const db = getPool();

    const countQuery = db.query(
      `SELECT COUNT(*)::int AS total
       FROM tracks t
       LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = $1
       LEFT JOIN disliked_tracks dt ON dt.track_id = t.id AND dt.user_id = $2
       WHERE ${whereSql}`,
      baseParams
    );

    const dataParams = [...baseParams, pageSize, offset];
    const limitIdx = pIdx;
    const offsetIdx = pIdx + 1;
    const dataQuery = db.query(
      `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
       FROM tracks t
       LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = $1
       LEFT JOIN disliked_tracks dt ON dt.track_id = t.id AND dt.user_id = $2
       WHERE ${whereSql}
       ORDER BY is_favorite DESC, t.popularity DESC, t.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataParams
    );

    const [countRes, dataRes] = await Promise.all([countQuery, dataQuery]);

    res.json({
      tracks: dataRes.rows.map(mapTrackRow),
      totalCount: Number(countRes.rows[0]?.total || 0),
      page,
      pageSize,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şarkılar yüklenemedi.' });
  }
});

app.post('/api/tracks/pull-online', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const mood = (req.body?.mood as MoodType) || 'positive';
    const emotion = (req.body?.emotion as EmotionType | null) || null;
    const language = (req.body?.language as 'all' | 'tr' | 'global') || 'all';
    const customQuery = req.body?.customQuery ? String(req.body.customQuery) : undefined;

    const fetched = await fetchOnlineTracksBatch({
      mood,
      emotion,
      language,
      customQuery,
    });
    const added = await upsertTracksPg(fetched);
    res.json({ added });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Online şarkı çekilemedi.' });
  }
});

app.get('/api/tracks/:trackId/preview', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const trackId = Number(req.params.trackId);
    const db = getPool();
    const r = await db.query(
      'SELECT external_source, external_id, preview_url, artist, title FROM tracks WHERE id = $1',
      [trackId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'Şarkı bulunamadı.' });
      return;
    }
    const row = r.rows[0];
    let previewUrl = String(row.preview_url || '').trim();

    if (row.external_source === 'deezer' && /^\d+$/.test(String(row.external_id || ''))) {
      try {
        const dzResp = await fetch(`https://api.deezer.com/track/${row.external_id}`);
        if (dzResp.ok) {
          const dzData: any = await dzResp.json();
          if (dzData?.preview) {
            previewUrl = String(dzData.preview);
          }
        }
      } catch {
        // Fall back to stored preview_url
      }
    }

    if (!previewUrl) {
      try {
        const q = encodeURIComponent(`${row.artist || ''} ${row.title || ''}`.trim());
        const itResp = await fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`);
        if (itResp.ok) {
          const itData: any = await itResp.json();
          if (itData?.results?.[0]?.previewUrl) {
            previewUrl = String(itData.results[0].previewUrl);
          }
        }
      } catch {
        // Ignore fallback lookup error
      }
    }

    res.json({ previewUrl: previewUrl || null });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Önizleme URL alınamadı.' });
  }
});

app.post('/api/tracks/:trackId/favorite', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const trackId = Number(req.params.trackId);
    const db = getPool();

    const existing = await db.query(
      'SELECT 1 FROM favorites WHERE user_id = $1 AND track_id = $2',
      [uid, trackId]
    );
    if (existing.rows.length > 0) {
      await db.query('DELETE FROM favorites WHERE user_id = $1 AND track_id = $2', [uid, trackId]);
      res.json({ liked: false });
      return;
    }
    await db.query(
      'INSERT INTO favorites (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [uid, trackId]
    );
    res.json({ liked: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Favori güncellenemedi.' });
  }
});

app.post('/api/tracks/:trackId/dislike', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const trackId = Number(req.params.trackId);
    const db = getPool();

    await db.query(
      'INSERT INTO disliked_tracks (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [uid, trackId]
    );
    await db.query('DELETE FROM favorites WHERE user_id = $1 AND track_id = $2', [uid, trackId]);
    await db.query(
      `DELETE FROM scan_session_tracks
       WHERE track_id = $1
         AND session_id IN (SELECT id FROM scan_sessions WHERE user_id = $2)`,
      [trackId, uid]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şarkı gizlenemedi.' });
  }
});

app.get('/api/tracks/disliked', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const db = getPool();
    const r = await db.query(
      `SELECT t.*, 0 AS is_favorite
       FROM disliked_tracks dt
       JOIN tracks t ON t.id = dt.track_id
       WHERE dt.user_id = $1
       ORDER BY dt.created_at DESC`,
      [uid]
    );
    res.json({ tracks: r.rows.map(mapTrackRow) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gizlenen şarkılar alınamadı.' });
  }
});

app.delete('/api/tracks/:trackId/dislike', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const db = getPool();
    await db.query('DELETE FROM disliked_tracks WHERE user_id = $1 AND track_id = $2', [
      req.authUser!.id,
      Number(req.params.trackId),
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şarkı geri alınamadı.' });
  }
});

// ───────────────────────── Scan Sessions & Blob Snapshots ─────────────────────────

app.post('/api/scans', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const mood = (req.body?.mood as MoodType) || 'neutral';
    const emotion = (req.body?.emotion as EmotionType | null) || null;
    const confidence = Number(req.body?.confidence ?? 0.82);
    const emotionScores = req.body?.emotionScores || null;
    const deviceLabel = String(req.body?.deviceLabel || 'iPhone 16 Pro');
    const language = (req.body?.language as 'all' | 'tr' | 'global') || 'all';
    const moodStrategy: MoodStrategy = req.body?.moodStrategy === 'uplift' ? 'uplift' : 'match';
    const imageBase64 = req.body?.imageBase64 ? String(req.body.imageBase64) : '';

    const snapshotBlob = imageBase64 ? await uploadSnapshotBlob(uid, imageBase64) : null;

    const tracks = await selectPlaylistForMood(mood, uid, 16, language, emotion, moodStrategy);
    const db = getPool();
    const scoresJson = emotionScores ? JSON.stringify(emotionScores) : null;

    const ins = await db.query(
      `INSERT INTO scan_sessions (
        user_id, mood, emotion, confidence, emotion_scores_json,
        note, tags_json, mood_strategy, is_manual_override,
        snapshot_uri, device_label
      ) VALUES ($1, $2, $3, $4, $5, '', '[]', $6, 0, $7, $8)
      RETURNING *`,
      [uid, mood, emotion, confidence, scoresJson, moodStrategy, snapshotBlob, deviceLabel]
    );

    const sessionId = Number(ins.rows[0].id);
    for (let i = 0; i < tracks.length; i++) {
      await db.query(
        'INSERT INTO scan_session_tracks (session_id, track_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [sessionId, tracks[i].id, i]
      );
    }

    const full = await getScanSessionWithTracks(sessionId, uid);
    res.status(201).json({ session: full });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tarama kaydedilemedi.' });
  }
});

app.get('/api/scans', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const db = getPool();
    const r = await db.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM scan_session_tracks sst WHERE sst.session_id = s.id) AS track_count
       FROM scan_sessions s
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 60`,
      [req.authUser!.id]
    );
    res.json({ sessions: r.rows.map(mapScanSessionFields) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Taramalar alınamadı.' });
  }
});

app.get('/api/scans/:sessionId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const session = await getScanSessionWithTracks(
      Number(req.params.sessionId),
      req.authUser!.id
    );
    if (!session) {
      res.status(404).json({ error: 'Tarama bulunamadı.' });
      return;
    }
    res.json({ session });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tarama detayı alınamadı.' });
  }
});

app.patch('/api/scans/:sessionId/mood', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const sessionId = Number(req.params.sessionId);
    const db = getPool();

    const cur = await db.query('SELECT * FROM scan_sessions WHERE id = $1 AND user_id = $2', [
      sessionId,
      uid,
    ]);
    if (cur.rows.length === 0) {
      res.status(404).json({ error: 'Tarama bulunamadı.' });
      return;
    }
    const row = cur.rows[0];
    const reqEmotion = req.body?.emotion as EmotionType | undefined;
    const reqStrategy = req.body?.strategy as MoodStrategy | undefined;
    const reqLanguage = (req.body?.language as 'all' | 'tr' | 'global') || 'all';
    const isManualOverride = req.body?.isManualOverride;

    const nextEmotion: EmotionType | null = reqEmotion ?? ((row.emotion as EmotionType) || null);
    const nextMood: MoodType = reqEmotion
      ? reqEmotion === 'happy' || reqEmotion === 'surprise'
        ? 'positive'
        : reqEmotion === 'neutral'
          ? 'neutral'
          : 'negative'
      : (row.mood as MoodType) || 'neutral';
    const nextStrategy: MoodStrategy =
      reqStrategy ?? (row.mood_strategy === 'uplift' ? 'uplift' : 'match');
    const nextOverride =
      isManualOverride !== undefined ? (isManualOverride ? 1 : 0) : Number(row.is_manual_override || 0);

    const freshTracks = await selectPlaylistForMood(
      nextMood,
      uid,
      16,
      reqLanguage,
      nextEmotion,
      nextStrategy
    );

    await db.query(
      'UPDATE scan_sessions SET mood = $1, emotion = $2, mood_strategy = $3, is_manual_override = $4 WHERE id = $5 AND user_id = $6',
      [nextMood, nextEmotion, nextStrategy, nextOverride, sessionId, uid]
    );
    await db.query('DELETE FROM scan_session_tracks WHERE session_id = $1', [sessionId]);
    for (let i = 0; i < freshTracks.length; i++) {
      await db.query(
        'INSERT INTO scan_session_tracks (session_id, track_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [sessionId, freshTracks[i].id, i]
      );
    }

    const updated = await getScanSessionWithTracks(sessionId, uid);
    res.json({ session: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tarama modu güncellenemedi.' });
  }
});

app.patch('/api/scans/:sessionId/journal', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const sessionId = Number(req.params.sessionId);
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const tags = Array.isArray(req.body?.tags)
      ? Array.from(new Set(req.body.tags.map((t: unknown) => String(t).trim()).filter(Boolean))).slice(0, 12)
      : [];

    const db = getPool();
    await db.query(
      'UPDATE scan_sessions SET note = $1, tags_json = $2 WHERE id = $3 AND user_id = $4',
      [note, JSON.stringify(tags), sessionId, uid]
    );
    const updated = await getScanSessionWithTracks(sessionId, uid);
    res.json({ session: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Günlük notu kaydedilemedi.' });
  }
});

app.post('/api/scans/:sessionId/expand', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const sessionId = Number(req.params.sessionId);
    const addCount = Math.max(1, Math.min(30, Number(req.body?.addCount ?? 8)));
    const language = (req.body?.language as 'all' | 'tr' | 'global') || 'all';
    const db = getPool();

    const cur = await db.query('SELECT * FROM scan_sessions WHERE id = $1 AND user_id = $2', [
      sessionId,
      uid,
    ]);
    if (cur.rows.length === 0) {
      res.status(404).json({ error: 'Tarama bulunamadı.' });
      return;
    }
    const row = cur.rows[0];

    const existingRes = await db.query(
      `SELECT sst.track_id, sst.position,
              LOWER(TRIM(t.artist)) AS norm_artist,
              LOWER(TRIM(t.title)) AS norm_title
       FROM scan_session_tracks sst
       JOIN tracks t ON t.id = sst.track_id
       WHERE sst.session_id = $1`,
      [sessionId]
    );

    const existingIds = new Set<number>();
    const existingSignatures = new Set<string>();
    let maxPos = -1;
    for (const er of existingRes.rows) {
      existingIds.add(Number(er.track_id));
      if (er.position !== null && er.position !== undefined) {
        maxPos = Math.max(maxPos, Number(er.position));
      }
      const sig = `${String(er.norm_artist || '').trim()}::${String(er.norm_title || '').trim()}`;
      if (sig !== '::') existingSignatures.add(sig);
    }

    const baseMood = (row.mood as MoodType) || 'neutral';
    const baseEmotion = (row.emotion as EmotionType) || null;
    const strategy: MoodStrategy = row.mood_strategy === 'uplift' ? 'uplift' : 'match';

    const selected = await selectPlaylistForMood(
      baseMood,
      uid,
      addCount,
      language,
      baseEmotion,
      strategy,
      existingIds,
      existingSignatures
    );

    let nextPos = maxPos + 1;
    let addedCount = 0;
    for (const tr of selected) {
      const ins = await db.query(
        'INSERT INTO scan_session_tracks (session_id, track_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [sessionId, tr.id, nextPos]
      );
      if ((ins.rowCount || 0) > 0) {
        nextPos++;
        addedCount++;
      }
    }

    const updated = await getScanSessionWithTracks(sessionId, uid);
    res.json({ session: updated, addedCount });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şarkılar genişletilemedi.' });
  }
});

app.delete('/api/scans/:sessionId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const sessionId = Number(req.params.sessionId);
    const db = getPool();

    const cur = await db.query(
      'SELECT snapshot_uri FROM scan_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, uid]
    );
    if (cur.rows[0]?.snapshot_uri) {
      await deleteSnapshotBlob(cur.rows[0].snapshot_uri);
    }
    await db.query('DELETE FROM scan_sessions WHERE id = $1 AND user_id = $2', [sessionId, uid]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tarama silinemedi.' });
  }
});

app.delete('/api/scans', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const db = getPool();
    const cur = await db.query('SELECT snapshot_uri FROM scan_sessions WHERE user_id = $1', [uid]);
    for (const r of cur.rows) {
      if (r.snapshot_uri) await deleteSnapshotBlob(r.snapshot_uri);
    }
    await db.query('DELETE FROM scan_sessions WHERE user_id = $1', [uid]);
    res.json({ removed: cur.rows.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Geçmiş temizlenemedi.' });
  }
});

// ───────────────────────── Playlists ─────────────────────────

app.get('/api/playlists', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const db = getPool();
    const r = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
       FROM playlists p
       WHERE p.user_id = $1
       ORDER BY p.updated_at DESC, p.id DESC`,
      [uid]
    );

    const playlists: PlaylistRecord[] = [];
    for (const row of r.rows) {
      const pid = Number(row.id);
      const artRes = await db.query(
        `SELECT t.artwork_url
         FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = $1 AND t.artwork_url <> ''
         ORDER BY pt.position ASC
         LIMIT 4`,
        [pid]
      );
      playlists.push({
        id: pid,
        userId: Number(row.user_id),
        name: String(row.name || ''),
        description: String(row.description || ''),
        mood: (row.mood as MoodType) || null,
        colorHex: row.color_hex ? String(row.color_hex) : null,
        trackCount: Number(row.track_count || 0),
        coverArtworks: artRes.rows.map((a) => String(a.artwork_url)).filter(Boolean),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      });
    }
    res.json({ playlists });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Listeler yüklenemedi.' });
  }
});

app.get('/api/playlists/:playlistId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const playlist = await getPlaylistWithTracks(
      Number(req.params.playlistId),
      req.authUser!.id
    );
    if (!playlist) {
      res.status(404).json({ error: 'Çalma listesi bulunamadı.' });
      return;
    }
    res.json({ playlist });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Liste detayı alınamadı.' });
  }
});

app.post('/api/playlists', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Çalma listesi adı boş olamaz.' });
      return;
    }
    const description = String(req.body?.description || '').trim();
    const mood = (req.body?.mood as MoodType | null) || null;
    const colorHex = req.body?.colorHex ? String(req.body.colorHex) : null;
    const initialTrackIds: number[] = Array.isArray(req.body?.initialTrackIds)
      ? Array.from(new Set(req.body.initialTrackIds.map(Number).filter(Number.isFinite)))
      : [];

    const db = getPool();
    const ins = await db.query(
      `INSERT INTO playlists (user_id, name, description, mood, color_hex)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [uid, name, description, mood, colorHex]
    );
    const playlistId = Number(ins.rows[0].id);

    for (let i = 0; i < initialTrackIds.length; i++) {
      await db.query(
        'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [playlistId, initialTrackIds[i], i]
      );
    }

    const playlist = await getPlaylistWithTracks(playlistId, uid);
    res.status(201).json({ playlist });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Liste oluşturulamadı.' });
  }
});

app.patch('/api/playlists/:playlistId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const playlistId = Number(req.params.playlistId);
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Çalma listesi adı boş olamaz.' });
      return;
    }
    const db = getPool();
    if (req.body?.description !== undefined) {
      await db.query(
        'UPDATE playlists SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
        [name, String(req.body.description).trim(), playlistId, uid]
      );
    } else {
      await db.query(
        'UPDATE playlists SET name = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [name, playlistId, uid]
      );
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Liste güncellenemedi.' });
  }
});

app.delete('/api/playlists/:playlistId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const db = getPool();
    await db.query('DELETE FROM playlists WHERE id = $1 AND user_id = $2', [
      Number(req.params.playlistId),
      req.authUser!.id,
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Liste silinemedi.' });
  }
});

app.post('/api/playlists/:playlistId/tracks', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await initDatabase();
    const uid = req.authUser!.id;
    const playlistId = Number(req.params.playlistId);
    const trackIds: number[] = Array.isArray(req.body?.trackIds)
      ? Array.from(new Set(req.body.trackIds.map(Number).filter(Number.isFinite)))
      : [];
    const db = getPool();

    const owner = await db.query('SELECT id FROM playlists WHERE id = $1 AND user_id = $2', [
      playlistId,
      uid,
    ]);
    if (owner.rows.length === 0) {
      res.status(404).json({ error: 'Çalma listesi bulunamadı.' });
      return;
    }

    const maxRes = await db.query(
      'SELECT MAX(position)::int AS max_pos FROM playlist_tracks WHERE playlist_id = $1',
      [playlistId]
    );
    let nextPos = Number(maxRes.rows[0]?.max_pos ?? -1) + 1;
    let added = 0;

    for (const tid of trackIds) {
      const ins = await db.query(
        'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [playlistId, tid, nextPos]
      );
      if ((ins.rowCount || 0) > 0) {
        nextPos++;
        added++;
      }
    }

    await db.query('UPDATE playlists SET updated_at = NOW() WHERE id = $1', [playlistId]);
    res.json({ added });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şarkılar listeye eklenemedi.' });
  }
});

app.delete(
  '/api/playlists/:playlistId/tracks/:trackId',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      await initDatabase();
      const uid = req.authUser!.id;
      const playlistId = Number(req.params.playlistId);
      const trackId = Number(req.params.trackId);
      const db = getPool();

      const owner = await db.query('SELECT id FROM playlists WHERE id = $1 AND user_id = $2', [
        playlistId,
        uid,
      ]);
      if (owner.rows.length === 0) {
        res.json({ ok: true });
        return;
      }
      await db.query('DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2', [
        playlistId,
        trackId,
      ]);
      await db.query('UPDATE playlists SET updated_at = NOW() WHERE id = $1', [playlistId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Şarkı listeden çıkarılamadı.' });
    }
  }
);

// ───────────────────────── Admin Endpoints ─────────────────────────

app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await initDatabase();
    const db = getPool();

    const [
      userRow,
      adminRow,
      scanRow,
      trackRow,
      favRow,
      linkRow,
      dislikedRow,
      playlistRow,
      playlistTrackRow,
      biometricTokenRow,
      userSettingRow,
      dbSizeRow,
      emotionRows,
      moodRows,
      langRows,
      sourceRows,
      blobStats,
    ] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS cnt FROM users'),
      db.query("SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'admin' OR LOWER(username) = 'haluk'"),
      db.query('SELECT COUNT(*)::int AS cnt FROM scan_sessions'),
      db.query('SELECT COUNT(*)::int AS cnt FROM tracks'),
      db.query('SELECT COUNT(*)::int AS cnt FROM favorites'),
      db.query('SELECT COUNT(*)::int AS cnt FROM scan_session_tracks'),
      db.query('SELECT COUNT(*)::int AS cnt FROM disliked_tracks'),
      db.query('SELECT COUNT(*)::int AS cnt FROM playlists'),
      db.query('SELECT COUNT(*)::int AS cnt FROM playlist_tracks'),
      db.query('SELECT COUNT(*)::int AS cnt FROM biometric_tokens'),
      db.query('SELECT COUNT(*)::int AS cnt FROM user_settings'),
      db.query('SELECT pg_database_size(current_database())::bigint AS bytes'),
      db.query(
        `SELECT COALESCE(NULLIF(emotion, ''), mood) AS emotion, COUNT(*)::int AS count
         FROM scan_sessions
         GROUP BY COALESCE(NULLIF(emotion, ''), mood)
         ORDER BY count DESC`
      ),
      db.query(
        `SELECT mood, COUNT(*)::int AS count
         FROM scan_sessions
         GROUP BY mood
         ORDER BY count DESC`
      ),
      db.query(
        `SELECT language, COUNT(*)::int AS count
         FROM tracks
         GROUP BY language
         ORDER BY count DESC`
      ),
      db.query(
        `SELECT external_source AS source, COUNT(*)::int AS count
         FROM tracks
         GROUP BY external_source
         ORDER BY count DESC`
      ),
      getBlobStorageStats(),
    ]);

    const userCount = Number(userRow.rows[0]?.cnt || 0);
    const adminCount = Number(adminRow.rows[0]?.cnt || 0);
    const scanCount = Number(scanRow.rows[0]?.cnt || 0);
    const trackCount = Number(trackRow.rows[0]?.cnt || 0);
    const favoriteCount = Number(favRow.rows[0]?.cnt || 0);
    const sessionTrackLinkCount = Number(linkRow.rows[0]?.cnt || 0);
    const dislikedCount = Number(dislikedRow.rows[0]?.cnt || 0);
    const playlistCount = Number(playlistRow.rows[0]?.cnt || 0);
    const playlistTrackCount = Number(playlistTrackRow.rows[0]?.cnt || 0);
    const biometricTokenCount = Number(biometricTokenRow.rows[0]?.cnt || 0);
    const userSettingCount = Number(userSettingRow.rows[0]?.cnt || 0);

    res.json({
      userCount,
      adminCount,
      scanCount,
      trackCount,
      favoriteCount,
      sessionTrackLinkCount,
      photoCount: blobStats.photoCount,
      photoBytes: blobStats.photoBytes,
      dbBytes: Number(dbSizeRow.rows[0]?.bytes || 0),
      emotionBreakdown: emotionRows.rows.map((r) => ({
        emotion: String(r.emotion || 'neutral'),
        count: Number(r.count || 0),
      })),
      moodBreakdown: moodRows.rows.map((r) => ({
        mood: (r.mood as MoodType) || 'neutral',
        count: Number(r.count || 0),
      })),
      languageBreakdown: langRows.rows.map((r) => ({
        language: String(r.language || 'global'),
        count: Number(r.count || 0),
      })),
      sourceBreakdown: sourceRows.rows.map((r) => ({
        source: String(r.source || 'itunes'),
        count: Number(r.count || 0),
      })),
      tables: [
        { name: 'users', rowCount: userCount },
        { name: 'scan_sessions', rowCount: scanCount },
        { name: 'tracks', rowCount: trackCount },
        { name: 'favorites', rowCount: favoriteCount },
        { name: 'scan_session_tracks', rowCount: sessionTrackLinkCount },
        { name: 'disliked_tracks', rowCount: dislikedCount },
        { name: 'playlists', rowCount: playlistCount },
        { name: 'playlist_tracks', rowCount: playlistTrackCount },
        { name: 'biometric_tokens', rowCount: biometricTokenCount },
        { name: 'user_settings', rowCount: userSettingCount },
      ],
      prefs: {},
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Admin özeti alınamadı.' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await initDatabase();
    const db = getPool();
    const r = await db.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.created_at,
              (SELECT COUNT(*)::int FROM scan_sessions s WHERE s.user_id = u.id) AS scan_count,
              (SELECT COUNT(*)::int FROM favorites f WHERE f.user_id = u.id) AS favorite_count,
              (SELECT MAX(s.created_at) FROM scan_sessions s WHERE s.user_id = u.id) AS last_scan_at
       FROM users u
       ORDER BY CASE WHEN LOWER(u.username) = 'haluk' OR u.role = 'admin' THEN 0 ELSE 1 END, u.created_at DESC`
    );

    res.json({
      users: r.rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name || row.username),
        role: resolveRole(String(row.username), row.role),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        scanCount: Number(row.scan_count || 0),
        favoriteCount: Number(row.favorite_count || 0),
        lastScanAt: row.last_scan_at
          ? row.last_scan_at instanceof Date
            ? row.last_scan_at.toISOString()
            : String(row.last_scan_at)
          : null,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Kullanıcılar alınamadı.' });
  }
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const username = String(req.body?.username || '').trim();
    const displayName = String(req.body?.displayName || '').trim() || username;
    const password = String(req.body?.password || '');

    if (username.length < 3) {
      res.status(400).json({ error: 'Kullanıcı adı en az 3 karakter olmalıdır.' });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır.' });
      return;
    }

    const db = getPool();
    const existing = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [
      username,
    ]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı.' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const ins = await db.query(
      `INSERT INTO users (username, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, username, display_name, role, created_at`,
      [username, displayName, hash]
    );
    res.status(201).json({ user: toUserRecord(ins.rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Kullanıcı oluşturulamadı.' });
  }
});

app.patch('/api/admin/users/:userId/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 4) {
      res.status(400).json({ error: 'Yeni şifre en az 4 karakter olmalıdır.' });
      return;
    }
    const db = getPool();
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      hash,
      Number(req.params.userId),
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şifre güncellenemedi.' });
  }
});

app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const targetId = Number(req.params.userId);
    const db = getPool();
    const targetRes = await db.query('SELECT id, username, role FROM users WHERE id = $1', [
      targetId,
    ]);
    if (targetRes.rows.length === 0) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }
    const target = targetRes.rows[0];
    if (resolveRole(String(target.username), target.role) === 'admin') {
      res.status(400).json({ error: 'Admin hesabı silinemez.' });
      return;
    }

    const scanRows = await db.query('SELECT snapshot_uri FROM scan_sessions WHERE user_id = $1', [
      targetId,
    ]);
    for (const r of scanRows.rows) {
      if (r.snapshot_uri) await deleteSnapshotBlob(r.snapshot_uri);
    }

    await db.query('DELETE FROM users WHERE id = $1', [targetId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Kullanıcı silinemedi.' });
  }
});

app.get('/api/admin/scans', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const filterUserId = req.query.userId ? Number(req.query.userId) : null;
    const hasFilter = Number.isFinite(filterUserId) && (filterUserId as number) > 0;
    const db = getPool();

    const r = await db.query(
      `SELECT s.*, u.username, u.display_name,
              (SELECT COUNT(*)::int FROM scan_session_tracks sst WHERE sst.session_id = s.id) AS track_count
       FROM scan_sessions s
       JOIN users u ON u.id = s.user_id
       ${hasFilter ? 'WHERE s.user_id = $1' : ''}
       ORDER BY s.created_at DESC
       LIMIT ${hasFilter ? '$2' : '$1'}`,
      hasFilter ? [filterUserId, limit] : [limit]
    );

    res.json({
      scans: r.rows.map((row) => ({
        ...mapScanSessionFields(row),
        username: String(row.username || ''),
        displayName: String(row.display_name || row.username || ''),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Taramalar alınamadı.' });
  }
});

app.get('/api/admin/scans/:sessionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const session = await getScanSessionWithTracks(Number(req.params.sessionId));
    if (!session) {
      res.status(404).json({ error: 'Tarama bulunamadı.' });
      return;
    }
    res.json({ session });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tarama detayı alınamadı.' });
  }
});

app.delete('/api/admin/scans/:sessionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const sessionId = Number(req.params.sessionId);
    const db = getPool();
    const cur = await db.query('SELECT snapshot_uri FROM scan_sessions WHERE id = $1', [sessionId]);
    if (cur.rows[0]?.snapshot_uri) {
      await deleteSnapshotBlob(cur.rows[0].snapshot_uri);
    }
    await db.query('DELETE FROM scan_sessions WHERE id = $1', [sessionId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tarama silinemedi.' });
  }
});

app.get('/api/admin/favorites', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const db = getPool();
    const r = await db.query(
      `SELECT f.user_id, f.track_id, f.created_at,
              u.username, u.display_name,
              t.title, t.artist, t.mood, t.language
       FROM favorites f
       JOIN users u ON u.id = f.user_id
       JOIN tracks t ON t.id = f.track_id
       ORDER BY f.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({
      favorites: r.rows.map((row) => ({
        userId: Number(row.user_id),
        username: String(row.username || ''),
        displayName: String(row.display_name || row.username || ''),
        trackId: Number(row.track_id),
        title: String(row.title || ''),
        artist: String(row.artist || ''),
        mood: (row.mood as MoodType) || 'neutral',
        language: row.language === 'tr' ? 'tr' : 'global',
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Favoriler alınamadı.' });
  }
});

const ALLOWED_TRACK_MOODS = new Set<MoodType>(['positive', 'neutral', 'negative']);
const ALLOWED_ENERGY_TAGS = new Set<string>([
  'upbeat',
  'energetic',
  'chill',
  'emotional',
  'angry-rock',
]);

app.patch('/api/admin/tracks/bulk', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const rawUpdates = req.body?.updates;
    const rawDeleteIds = req.body?.deleteIds;

    if (rawUpdates !== undefined && !Array.isArray(rawUpdates)) {
      res.status(400).json({ error: 'updates alanı bir dizi olmalıdır.' });
      return;
    }
    if (rawDeleteIds !== undefined && !Array.isArray(rawDeleteIds)) {
      res.status(400).json({ error: 'deleteIds alanı bir dizi olmalıdır.' });
      return;
    }

    const updates: Array<{ id: number; mood: MoodType; energyTag: string }> = [];
    for (const item of rawUpdates || []) {
      const id = Number(item?.id);
      const mood = String(item?.mood || '').trim() as MoodType;
      const energyTag = String(item?.energyTag || '').trim();
      if (
        !Number.isInteger(id) ||
        id <= 0 ||
        !ALLOWED_TRACK_MOODS.has(mood) ||
        !ALLOWED_ENERGY_TAGS.has(energyTag)
      ) {
        res.status(400).json({ error: `Geçersiz güncelleme kaydı: id=${item?.id}` });
        return;
      }
      updates.push({ id, mood, energyTag });
    }

    const deleteIds: number[] = [];
    for (const rawId of rawDeleteIds || []) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: `Geçersiz silinecek track id: ${rawId}` });
        return;
      }
      deleteIds.push(id);
    }

    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      let updatedCount = 0;
      if (updates.length > 0) {
        const ids = updates.map((u) => u.id);
        const moods = updates.map((u) => u.mood);
        const tags = updates.map((u) => u.energyTag);
        const updRes = await client.query(
          `UPDATE tracks AS t
           SET mood = v.mood, energy_tag = v.energy_tag
           FROM UNNEST($1::int[], $2::text[], $3::text[]) AS v(id, mood, energy_tag)
           WHERE t.id = v.id`,
          [ids, moods, tags]
        );
        updatedCount = Number(updRes.rowCount || 0);
      }

      let deletedCount = 0;
      if (deleteIds.length > 0) {
        const delRes = await client.query(
          'DELETE FROM tracks WHERE id = ANY($1::int[])',
          [deleteIds]
        );
        deletedCount = Number(delRes.rowCount || 0);
      }

      const cntRes = await client.query('SELECT COUNT(*)::int AS cnt FROM tracks');
      await client.query('COMMIT');
      res.json({
        ok: true,
        updatedCount,
        deletedCount,
        totalCatalog: Number(cntRes.rows[0]?.cnt || 0),
      });
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Toplu şarkı güncellemesi başarısız.' });
  }
});

app.patch('/api/admin/tracks/:trackId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const trackId = Number(req.params.trackId);
    if (!Number.isInteger(trackId) || trackId <= 0) {
      res.status(400).json({ error: 'Geçersiz trackId.' });
      return;
    }

    const setParts: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    if (req.body?.mood !== undefined) {
      const mood = String(req.body.mood || '').trim() as MoodType;
      if (!ALLOWED_TRACK_MOODS.has(mood)) {
        res.status(400).json({ error: 'Geçersiz mood değeri.' });
        return;
      }
      setParts.push(`mood = $${pIdx++}`);
      params.push(mood);
    }

    if (req.body?.energyTag !== undefined) {
      const energyTag = String(req.body.energyTag || '').trim();
      if (!ALLOWED_ENERGY_TAGS.has(energyTag)) {
        res.status(400).json({ error: 'Geçersiz energyTag değeri.' });
        return;
      }
      setParts.push(`energy_tag = $${pIdx++}`);
      params.push(energyTag);
    }

    if (req.body?.language !== undefined) {
      const lang = String(req.body.language || '').trim();
      if (lang !== 'tr' && lang !== 'global') {
        res.status(400).json({ error: 'Geçersiz language değeri.' });
        return;
      }
      setParts.push(`language = $${pIdx++}`);
      params.push(lang);
    }

    if (setParts.length === 0) {
      res.status(400).json({ error: 'Güncellenecek alan belirtilmedi.' });
      return;
    }

    params.push(trackId);
    const db = getPool();
    const upd = await db.query(
      `UPDATE tracks SET ${setParts.join(', ')} WHERE id = $${pIdx} RETURNING *`,
      params
    );
    if (upd.rows.length === 0) {
      res.status(404).json({ error: 'Şarkı bulunamadı.' });
      return;
    }
    res.json({ ok: true, track: mapTrackRow(upd.rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şarkı güncellenemedi.' });
  }
});

app.delete('/api/admin/tracks/:trackId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const db = getPool();
    await db.query('DELETE FROM tracks WHERE id = $1', [Number(req.params.trackId)]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Şarkı silinemedi.' });
  }
});

app.post('/api/admin/clean-orphans', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await initDatabase();
    const db = getPool();
    const r = await db.query(
      'SELECT snapshot_uri FROM scan_sessions WHERE snapshot_uri IS NOT NULL'
    );
    const active = new Set(r.rows.map((x) => String(x.snapshot_uri)).filter(Boolean));
    const removed = await cleanOrphanSnapshotBlobs(active);
    res.json({ removed });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Temizlik başarısız.' });
  }
});

app.post('/api/admin/seed-catalog', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const tracksPerArtist = Math.min(25, Math.max(5, Number(req.body?.tracksPerArtist || 15)));
    const result = await seedFullCloudCatalog(tracksPerArtist, 60);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Katalog doldurulamadı.' });
  }
});

app.get('/api/admin/blobs', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await initDatabase();
    const db = getPool();
    const [blobs, scanRows] = await Promise.all([
      listSnapshotBlobs(300),
      db.query(
        `SELECT s.id, s.snapshot_uri, s.mood, s.emotion, s.created_at, u.username
         FROM scan_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.snapshot_uri IS NOT NULL`
      ),
    ]);

    const scanByBlob = new Map<
      string,
      {
        scanId: number;
        username: string;
        mood: string;
        emotion: string | null;
        createdAt: string;
      }
    >();

    for (const r of scanRows.rows) {
      const key = String(r.snapshot_uri || '').trim();
      if (!key) continue;
      scanByBlob.set(key, {
        scanId: Number(r.id),
        username: String(r.username || ''),
        mood: String(r.mood || 'neutral'),
        emotion: r.emotion ? String(r.emotion) : null,
        createdAt:
          r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      });
    }

    res.json({
      blobs: blobs.map((b) => {
        const linked = scanByBlob.get(b.name);
        return {
          ...b,
          scanId: linked?.scanId ?? null,
          username: linked?.username ?? null,
          mood: linked?.mood ?? null,
          emotion: linked?.emotion ?? null,
          createdAt: linked?.createdAt ?? b.lastModified,
          isOrphan: !linked,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Blob fotoğraflar listelenemedi.' });
  }
});

app.get('/api/admin/tables/:tableName', requireAuth, requireAdmin, async (req, res) => {
  try {
    await initDatabase();
    const tableName = String(req.params.tableName) as AdminTableName;
    if (!ADMIN_ALLOWED_TABLES[tableName]) {
      res.status(400).json({ error: 'Geçersiz tablo adı.' });
      return;
    }
    const hasPage = req.query.page !== undefined && String(req.query.page).trim() !== '';
    const page = hasPage ? Math.max(1, Number(req.query.page || 1)) : 1;
    const pageSize = hasPage
      ? Math.min(100, Math.max(1, Number(req.query.pageSize || 50)))
      : Math.min(200, Math.max(1, Number(req.query.limit || 60)));
    const offset = hasPage ? (page - 1) * pageSize : 0;
    const db = getPool();

    const [colRes, countRes, rowsRes] = await Promise.all([
      db.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position ASC`,
        [tableName]
      ),
      db.query(`SELECT COUNT(*)::int AS cnt FROM ${tableName}`),
      db.query(`SELECT * FROM ${tableName} ORDER BY ctid DESC LIMIT $1 OFFSET $2`, [
        pageSize,
        offset,
      ]),
    ]);

    const columns = colRes.rows.map((c) => String(c.column_name));
    if (tableName === 'scan_sessions' && !columns.includes('snapshot_preview_url')) {
      columns.push('snapshot_preview_url');
    }

    const mappedRows = rowsRes.rows.map((row) => {
      const masked = maskSensitiveRow(row);
      if (tableName === 'scan_sessions') {
        masked.snapshot_preview_url = getSnapshotReadUrl(
          typeof row.snapshot_uri === 'string' ? row.snapshot_uri : null
        );
      }
      return masked;
    });

    res.json({
      columns,
      rows: mappedRows,
      totalCount: Number(countRes.rows[0]?.cnt || 0),
      page,
      pageSize,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Tablo okunamadı.' });
  }
});

app.post('/api/admin/sql', requireAuth, requireAdmin, async (req, res) => {
  const cleaned = String(req.body?.sql || '').trim().replace(/;+\s*$/, '');
  if (!cleaned) {
    res.status(400).json({ error: 'Çalıştırmak için bir SQL sorgusu yazın.' });
    return;
  }
  if (cleaned.includes(';')) {
    res.status(400).json({
      error: 'Güvenlik nedeniyle tek seferde yalnızca bir salt-okunur sorgu çalıştırılabilir.',
    });
    return;
  }
  if (!/^(select|explain|with)\b/i.test(cleaned)) {
    res.status(400).json({
      error: 'Bulut SQL konsolu yalnızca SELECT, WITH ve EXPLAIN sorgularını destekler.',
    });
    return;
  }

  const db = getPool();
  const client = await db.connect();
  try {
    await initDatabase();
    const started = Date.now();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '4000ms'");
    const qRes = await client.query(cleaned);
    await client.query('COMMIT');
    const elapsedMs = Math.max(1, Date.now() - started);

    const maskedRows = (qRes.rows || []).slice(0, 100).map(maskSensitiveRow);
    const columns =
      maskedRows.length > 0
        ? Object.keys(maskedRows[0])
        : (qRes.fields || []).map((f) => f.name);

    res.json({
      columns,
      rows: maskedRows,
      totalRows: qRes.rows?.length || 0,
      elapsedMs,
    });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err?.message || 'SQL sorgusu çalıştırılamadı.' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/wipe-all', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await initDatabase();
    const db = getPool();
    const scanRows = await db.query('SELECT snapshot_uri FROM scan_sessions WHERE snapshot_uri IS NOT NULL');
    for (const r of scanRows.rows) {
      if (r.snapshot_uri) await deleteSnapshotBlob(r.snapshot_uri);
    }
    await db.query(
      'TRUNCATE TABLE playlist_tracks, playlists, scan_session_tracks, scan_sessions, favorites, disliked_tracks, biometric_tokens, user_settings RESTART IDENTITY CASCADE'
    );
    await db.query("DELETE FROM users WHERE LOWER(username) <> 'haluk'");
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Veritabanı sıfırlanamadı.' });
  }
});

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(['/', '/admin'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API uç noktası bulunamadı.' });
});

app.listen(config.port, () => {
  console.log(`MoodSync Cloud API listening on port ${config.port}`);
  initDatabase()
    .then(() => console.log('PostgreSQL schema initialized'))
    .catch((err) => console.error('Initial DB init error:', err));
});
