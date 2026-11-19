import { EmotionType, MoodType } from '../theme/colors';

export interface OnlineTrackPayload {
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
}

const LIVE_DISCOVERY_KEYWORDS: Record<MoodType, Record<'tr' | 'global', string[]>> = {
  positive: {
    tr: [
      'Tarkan',
      'Mabel Matiz',
      'Edis',
      'Sertab Erener',
      'Kenan Doğulu',
      'Hadise',
      'Zeynep Bastık',
      'Athena',
      'Yalın',
      'Evdeki Saat',
      'Simge',
      'Gülşen',
    ],
    global: [
      'Dua Lipa',
      'The Weeknd',
      'Bruno Mars',
      'Calvin Harris',
      'Daft Punk',
      'Harry Styles',
      'Sabrina Carpenter',
      'Pharrell Williams Happy',
      'Coldplay Viva La Vida',
      'Avicii',
      'Queen',
      'Jungle',
    ],
  },
  neutral: {
    tr: [
      'Kalben',
      'Melike Şahin',
      'Jakuzi',
      'Büyük Ev Ablukada',
      'Fazıl Say',
      'Birsen Tezer',
      'Bülent Ortaçgil',
      'Sedef Sebüktekin',
      'Can Kazaz',
      'Palmiyeler',
    ],
    global: [
      'Tycho',
      'Bonobo',
      'Khruangbin',
      'Norah Jones',
      'Ludovico Einaudi',
      'Olafur Arnalds',
      'Men I Trust',
      'FKJ',
      'Beach House',
      'Nujabes',
      'Mac DeMarco',
    ],
  },
  negative: {
    tr: [
      'Sezen Aksu',
      'Teoman',
      'Şebnem Ferah',
      'Duman',
      'Cem Adrian',
      'Dedublüman',
      'Can Ozan',
      'Emir Can İğrek',
      'Madrigal',
      'Semicenk',
      'Dolu Kadehi Ters Tut',
    ],
    global: [
      'Adele',
      'Billie Eilish',
      'Lana Del Rey',
      'Radiohead',
      'Cigarettes After Sex',
      'Bon Iver',
      'Joji',
      'Coldplay Fix You',
      'Hans Zimmer',
      'Lewis Capaldi',
      'Jeff Buckley',
    ],
  },
};

const ANGRY_DISCOVERY_KEYWORDS: Record<'tr' | 'global', string[]> = {
  tr: [
    'maNga',
    'Mor ve Ötesi',
    'Şebnem Ferah',
    'Duman',
    'Ceza',
    'Sagopa Kajmer',
    'Pentagram',
    'Hayko Cepkin',
    'Athena',
  ],
  global: [
    'Linkin Park',
    'Eminem',
    'Arctic Monkeys',
    'Imagine Dragons',
    'Muse',
    'Nirvana',
    'Bring Me The Horizon',
    'Royal Blood',
  ],
};

const SURPRISE_DISCOVERY_KEYWORDS: Record<'tr' | 'global', string[]> = {
  tr: ['Edis', 'Tarkan', 'Hadise', 'Gülşen', 'Murda', 'Köfn', 'Athena'],
  global: ['Calvin Harris', 'David Guetta', 'Daft Punk', 'Avicii', 'Disclosure', 'Dua Lipa'],
};

function pickRandom<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function buildYoutubeUrl(artist: string, title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${title}`)}`;
}

async function fetchItunesTracks(
  term: string,
  mood: MoodType,
  language: 'tr' | 'global',
  energyTag: string,
  limit = 8
): Promise<OnlineTrackPayload[]> {
  const country = language === 'tr' ? 'TR' : 'US';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&country=${country}&limit=${limit}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const parsed: OnlineTrackPayload[] = [];

    for (const item of results) {
      const trackId = item?.trackId;
      const title = String(item?.trackName || '').trim();
      const artist = String(item?.artistName || '').trim();
      const preview = String(item?.previewUrl || '').trim();
      if (!trackId || !title || !artist || !preview) continue;

      const lowered = `${title} ${artist}`.toLowerCase();
      if (
        lowered.includes('karaoke') ||
        lowered.includes('ringtone') ||
        lowered.includes('tribute') ||
        lowered.includes('8-bit')
      ) {
        continue;
      }

      const artwork = String(item?.artworkUrl100 || '').replace('100x100bb.jpg', '600x600bb.jpg');
      parsed.push({
        externalSource: 'itunes',
        externalId: String(trackId),
        title,
        artist,
        album: String(item?.collectionName || ''),
        genre: String(item?.primaryGenreName || (language === 'tr' ? 'Türkçe Pop' : 'Pop')),
        mood,
        energyTag,
        language,
        artworkUrl: artwork,
        previewUrl: preview,
        storeUrl: String(item?.trackViewUrl || ''),
        youtubeUrl: buildYoutubeUrl(artist, title),
        durationMs: Number(item?.trackTimeMillis || 30000),
        popularity: 75,
      });
    }
    return parsed;
  } catch {
    return [];
  }
}

async function fetchDeezerTracks(
  term: string,
  mood: MoodType,
  language: 'tr' | 'global',
  energyTag: string,
  limit = 6
): Promise<OnlineTrackPayload[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=${limit}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = Array.isArray(data?.data) ? data.data : [];
    const parsed: OnlineTrackPayload[] = [];

    for (const item of results) {
      const trackId = item?.id;
      const title = String(item?.title || '').trim();
      const artist = String(item?.artist?.name || '').trim();
      const preview = String(item?.preview || '').trim();
      if (!trackId || !title || !artist || !preview) continue;

      parsed.push({
        externalSource: 'deezer',
        externalId: String(trackId),
        title,
        artist,
        album: String(item?.album?.title || ''),
        genre: language === 'tr' ? 'Türkçe' : 'Pop',
        mood,
        energyTag,
        language,
        artworkUrl: String(item?.album?.cover_big || item?.album?.cover_medium || ''),
        previewUrl: preview,
        storeUrl: String(item?.link || ''),
        youtubeUrl: buildYoutubeUrl(artist, title),
        durationMs: Number(item?.duration || 30) * 1000,
        popularity: Math.min(100, Math.max(50, Math.round(Number(item?.rank || 500000) / 10000))),
      });
    }
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Fetches fresh songs directly from Apple iTunes & Deezer APIs on the iPhone
 * (zero dependency on any PC server).
 */
export async function fetchOnlineTracksDirect(params: {
  mood: MoodType;
  emotion?: EmotionType | null;
  language?: 'all' | 'tr' | 'global';
  customQuery?: string;
}): Promise<OnlineTrackPayload[]> {
  const mood = params.mood;
  const emotion = params.emotion || null;
  const lang = params.language || 'all';
  const energyTag =
    emotion === 'angry'
      ? 'angry-rock'
      : emotion === 'surprise'
      ? 'energetic'
      : mood === 'positive'
      ? 'upbeat'
      : mood === 'neutral'
      ? 'chill'
      : 'emotional';

  const jobs: Promise<OnlineTrackPayload[]>[] = [];

  if (params.customQuery && params.customQuery.trim()) {
    const q = params.customQuery.trim();
    const targetLang: 'tr' | 'global' = lang === 'global' ? 'global' : 'tr';
    jobs.push(fetchItunesTracks(q, mood, targetLang, energyTag, 10));
    jobs.push(fetchDeezerTracks(q, mood, targetLang, energyTag, 8));
  } else {
    const keywordBank =
      emotion === 'angry'
        ? ANGRY_DISCOVERY_KEYWORDS
        : emotion === 'surprise'
        ? SURPRISE_DISCOVERY_KEYWORDS
        : LIVE_DISCOVERY_KEYWORDS[mood];

    const langsToQuery: Array<'tr' | 'global'> =
      lang === 'all' ? ['tr', 'global'] : [lang];

    for (const targetLang of langsToQuery) {
      const terms = pickRandom(keywordBank[targetLang], lang === 'all' ? 2 : 3);
      for (const term of terms) {
        jobs.push(fetchItunesTracks(term, mood, targetLang, energyTag, 6));
      }
      if (terms[0]) {
        jobs.push(fetchDeezerTracks(terms[0], mood, targetLang, energyTag, 4));
      }
    }
  }

  const settled = await Promise.all(jobs);
  const flat = settled.flat();

  // Deduplicate by normalized artist + title
  const seen = new Set<string>();
  const unique: OnlineTrackPayload[] = [];
  for (const t of flat) {
    const key = `${t.artist.toLowerCase().trim()}::${t.title.toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }
  return unique;
}

export async function resolvePlayablePreviewUrl(track: {
  externalSource: string;
  externalId: string;
  previewUrl: string;
  artist: string;
  title: string;
}): Promise<string | null> {
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
