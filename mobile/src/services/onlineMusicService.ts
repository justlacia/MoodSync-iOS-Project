import { TrackRecord } from '../database/iosDatabase';
import { pcServerFetch } from './moodAiService';
import { EmotionType, MoodType } from '../theme/colors';

/**
 * Expands the song catalog directly on the PC server (MoodSync-iOS-Project/webapp/data/moodsync.db)
 * from Apple iTunes & Deezer APIs so zero song rows are stored on the iPhone.
 */
export async function fetchAndStoreOnlineSongs(params: {
  mood: MoodType;
  emotion?: EmotionType | null;
  language?: 'all' | 'tr' | 'global';
  customQuery?: string;
}): Promise<number> {
  const res = await pcServerFetch<{ tracks: any[]; catalog?: { total?: number } }>(
    '/api/music/expand',
    {
      method: 'POST',
      body: {
        mood: params.mood,
        emotion: params.emotion || null,
        language: params.language || 'all',
        query: params.customQuery?.trim() || null,
        limit: 18,
      },
      timeoutMs: 14000,
    }
  );
  return Array.isArray(res?.tracks) ? res.tracks.length : 0;
}

export async function resolvePlayablePreviewUrl(track: TrackRecord): Promise<string | null> {
  if (track.externalSource === 'deezer' && /^\d+$/.test(track.externalId)) {
    try {
      const resp = await fetch(`https://api.deezer.com/track/${track.externalId}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.preview) {
          return String(data.preview);
        }
      }
    } catch {
      // Fall back to stored previewUrl
    }
  }
  if (track.previewUrl) return track.previewUrl;

  try {
    const q = encodeURIComponent(`${track.artist} ${track.title}`);
    const resp = await fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.results?.[0]?.previewUrl) {
        return String(data.results[0].previewUrl);
      }
    }
  } catch {
    // Ignore
  }
  return null;
}
