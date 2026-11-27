import { getPool, mapTrackRow } from './db';
import {
  EmotionType,
  MoodStrategy,
  MoodType,
  OnlineTrackPayload,
  resolveTargetMoodForStrategy,
  TrackRecord,
} from './types';

export const LIVE_DISCOVERY_KEYWORDS: Record<MoodType, Record<'tr' | 'global', string[]>> = {
  positive: {
    tr: [
      'Tarkan', 'Mabel Matiz', 'Edis', 'Sertab Erener', 'Kenan Doğulu', 'Hadise',
      'Zeynep Bastık', 'Athena', 'Yalın', 'Simge', 'Gülşen', 'Sefo', 'Reynmen',
      'Mirkelam', 'Nil Karaibrahimgil', 'Bedük', 'Hande Yener', 'Mustafa Sandal',
      'Oğuzhan Koç', 'Ajda Pekkan', 'Murat Boz', 'Demet Akalın', 'İrem Derici',
      'KÖFN', 'Buray', 'Ece Seçkin', 'Aleyna Tilki', 'Murat Dalkılıç', 'MFÖ',
    ],
    global: [
      'Dua Lipa', 'Bruno Mars', 'Calvin Harris', 'Daft Punk', 'Harry Styles',
      'Sabrina Carpenter', 'Pharrell Williams', 'Avicii', 'Queen', 'Jungle',
      'Ed Sheeran', 'Taylor Swift', 'Mark Ronson', 'Katy Perry', 'Justin Timberlake',
      'Ariana Grande', 'Lady Gaga', 'Rihanna', 'Beyonce', 'Shakira',
      'Charlie Puth', 'Doja Cat', 'Miley Cyrus', 'Olivia Dean', 'Lizzo',
      'Disclosure', 'Fred again', 'Peggy Gou', 'Kygo', 'Martin Garrix',
      'Clean Bandit', 'Carly Rae Jepsen', 'Maroon 5',
    ],
  },
  neutral: {
    tr: [
      'Kalben', 'Fazıl Say', 'Birsen Tezer', 'Bülent Ortaçgil', 'Sedef Sebüktekin',
      'Can Kazaz', 'Palmiyeler', 'Yüzyüzeyken Konuşuruz', 'Adamlar', 'Pinhani',
      'Nilipek', 'Nova Norda', 'Ceylan Ertem', 'Yaşlı Amca', 'Mavi Gri',
      'Son Feci Bisiklet', 'Karsu', 'Jehan Barbur', 'Ezginin Günlüğü',
      'Yeni Türkü', 'Mazhar Alanson', 'Fikret Kızılok', 'Deniz Tekin',
      'Can Bonomo', 'Gaye Su Akyol', 'Lalalar', 'Flört', 'Peyk',
      'Evdeki Saat', 'Dolu Kadehi Ters Tut',
    ],
    global: [
      'Tycho', 'Bonobo', 'Khruangbin', 'Norah Jones', 'Ludovico Einaudi',
      'Olafur Arnalds', 'Men I Trust', 'FKJ', 'Beach House', 'Nujabes',
      'Mac DeMarco', 'Tame Impala', 'Cigarettes After Sex', 'Parcels', 'Tom Misch',
      'Laufey', 'Max Richter', 'Nils Frahm', 'Yiruma', 'Four Tet',
      'Caribou', 'Jamie xx', 'Bicep', 'RÜFÜS DU SOL', 'ODESZA',
      'London Grammar', 'The xx', 'Rhye', 'Zero 7', 'Air',
      'Portishead', 'Massive Attack', 'Moby', 'Thievery Corporation', 'Arctic Monkeys',
    ],
  },
  negative: {
    tr: [
      'Sezen Aksu', 'Teoman', 'Şebnem Ferah', 'Duman', 'Cem Adrian',
      'Dedublüman', 'Can Ozan', 'Emir Can İğrek', 'Madrigal', 'Semicenk',
      'Müslüm Gürses', 'Yüksek Sadakat', 'Seksendört', 'Halil Sezai', 'Tuğkan',
      'Perdenin Ardındakiler', 'Emre Aydın', 'Barış Akarsu', 'Gripin', 'Feridun Düzağaç',
      'Model', 'Pilli Bebek', 'Zakkum', 'Kolpa', 'Badem', 'Toygar Işıklı',
      'Ahmet Kaya', 'Yıldız Tilbe', 'Ebru Gündeş', 'Güllü', 'Bergen', 'Kıraç',
      'Erkan Oğur', 'Neşet Ertaş', 'Kazım Koyuncu', 'Volkan Konak',
      'Ferhat Göçer', 'Göksel', 'Gökhan Türkmen', 'Melek Mosso', 'Tan Taşçı',
      'Sıla', 'Mert Demir', 'Melike Şahin', 'Sena Şener', 'Jakuzi',
      'Sagopa Kajmer', 'Kargo',
    ],
    global: [
      'Adele', 'Billie Eilish', 'Lana Del Rey', 'Radiohead', 'Cigarettes After Sex',
      'Bon Iver', 'Joji', 'Hans Zimmer', 'Lewis Capaldi', 'Jeff Buckley',
      'Mitski', 'James Blake', 'Olivia Rodrigo', 'Sam Smith', 'Hozier',
      'Amy Winehouse', 'Sia', 'Lord Huron', 'Phoebe Bridgers', 'Frank Ocean',
      'The Neighbourhood', 'Keane', 'Snow Patrol', 'Damien Rice', 'Elliott Smith',
      'Sufjan Stevens', 'FKA twigs', 'Thom Yorke', 'Daughter', 'Kodaline',
      'Sleeping At Last', 'The Weeknd',
    ],
  },
};

export const ANGRY_DISCOVERY_KEYWORDS: Record<'tr' | 'global', string[]> = {
  tr: [
    'maNga', 'Mor ve Ötesi', 'Şebnem Ferah', 'Duman', 'Ceza',
    'Hayko Cepkin', 'Athena', 'Kurban', 'Çilekeş', 'Gazapizm', 'Ezhel',
    'Şehinşah', 'Pilli Bebek', 'Norm Ender', 'Pentagram', 'Motive',
    'Uzi', 'Rota', 'Allame', 'Defkhan', 'Hidra', 'No.1',
  ],
  global: [
    'Linkin Park', 'Eminem', 'Imagine Dragons', 'Muse',
    'Nirvana', 'Bring Me The Horizon', 'Royal Blood', 'Metallica',
    'System of a Down', 'Rage Against The Machine', 'Slipknot', 'Disturbed',
    'Three Days Grace', 'Green Day', 'Deftones', 'Tool',
    'Rammstein', 'Korn', 'Limp Bizkit',
  ],
};

export const SURPRISE_DISCOVERY_KEYWORDS: Record<'tr' | 'global', string[]> = {
  tr: [
    'Edis', 'Tarkan', 'Hadise', 'Gülşen', 'Murda', 'Köfn', 'Athena',
    'Lvbel C5', 'Aleyna Tilki', 'Blok3', 'Çakal', 'Sefo', 'Zeynep Bastık',
  ],
  global: [
    'Calvin Harris', 'David Guetta', 'Daft Punk', 'Avicii', 'Disclosure',
    'Dua Lipa', 'Fred again', 'Peggy Gou', 'Kygo', 'Martin Garrix',
    'Swedish House Mafia', 'Skrillex', 'Fisher', 'Tiesto', 'Travis Scott', 'Foo Fighters',
  ],
};

const COMPOUND_SEARCH_TERMS = new Set<string>();

const NON_LATIN_SCRIPT_REGEX =
  /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0370-\u03FF\u0590-\u05FF]/;
const STRONG_TURKISH_CHAR_REGEX = /[ğışİĞŞ]/;
const SOFT_TURKISH_CHAR_REGEX = /[çöüÇÖÜ]/;
const FOREIGN_DIACRITIC_REGEX = /[éèëàäïôñáíóúýœæøåčžšđłńćźż]/i;

export function normalizeMusicText(value: string): string {
  return String(value || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitArtistTokens(artist: string): string[] {
  const cleaned = String(artist || '').replace(/\s*[\[(]\s*(?:feat|ft)\.?\s+[^)\]]*[\])]/gi, (m) =>
    `, ${m.replace(/^[\[(]\s*(?:feat|ft)\.?\s+/i, '').replace(/[\])]$/, '')}`
  );
  const rawParts = cleaned
    .split(/\s*(?:,|&|\/|\+|;|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*/i)
    .map((part) => normalizeMusicText(part))
    .filter(Boolean);

  const full = normalizeMusicText(artist);
  if (full && !rawParts.includes(full)) {
    rawParts.unshift(full);
  }
  return rawParts;
}

const KNOWN_TURKISH_ARTISTS = new Set<string>(
  [
    ...LIVE_DISCOVERY_KEYWORDS.positive.tr,
    ...LIVE_DISCOVERY_KEYWORDS.neutral.tr,
    ...LIVE_DISCOVERY_KEYWORDS.negative.tr,
    ...ANGRY_DISCOVERY_KEYWORDS.tr,
    ...SURPRISE_DISCOVERY_KEYWORDS.tr,
    'İbrahim Tatlıses', 'Barış Manço', 'Cem Karaca', 'Simge Sağın',
  ].map(normalizeMusicText)
);

const AMBIGUOUS_TR_ARTISTS = new Set<string>(
  ['Athena', 'Madrigal', 'Pentagram', 'Motive', 'Uzi', 'Bade', 'Kargo', 'Model', 'Flört', 'Rota', 'Air'].map(normalizeMusicText)
);

const KNOWN_FOREIGN_ARTISTS = new Set<string>(
  [
    'ADÉLA', 'Adela', 'Kofs', 'Soso Maness', 'Naps', 'Lil Uzi Vert',
    'Stephanie Beatriz', 'Pharrell Williams', 'Coldplay', 'Billie Eilish',
    'Jul', 'SCH', 'Ninho', 'PNL',
    ...LIVE_DISCOVERY_KEYWORDS.positive.global,
    ...LIVE_DISCOVERY_KEYWORDS.neutral.global,
    ...LIVE_DISCOVERY_KEYWORDS.negative.global,
    ...ANGRY_DISCOVERY_KEYWORDS.global,
    ...SURPRISE_DISCOVERY_KEYWORDS.global,
  ].map(normalizeMusicText)
);

const TURKISH_WORDS = new Set<string>([
  'seni', 'beni', 'bende', 'sende', 'benim', 'senin', 'bizim', 'sizin', 'onun',
  'ask', 'askim', 'sevgi', 'sevgilim', 'kalp', 'kalbim', 'gonul', 'gonlum',
  'gece', 'geceler', 'gunduz', 'yildiz', 'yildizlar', 'altinda',
  'gunes', 'yagmur', 'ruzgar', 'deniz', 'dalga', 'gokyuzu', 'bulut',
  'yollar', 'uzak', 'yakin', 'yorgun', 'yalniz', 'yalnizlik', 'hasret',
  'ozlem', 'ozledim', 'huzun', 'veda', 'ayrilik', 'gozyasi', 'gozlerin',
  'gozleri', 'ellerin', 'saclarin', 'sesin', 'kokun', 'nefes', 'hayat',
  'dunya', 'zaman', 'simdi', 'bugun', 'yarin', 'dun', 'belki', 'artik',
  'hic', 'yine', 'yeniden', 'herkes', 'kimse', 'degil', 'gibi', 'kadar',
  'icin', 'neden', 'nasil', 'nerede', 'neredesin', 'gel', 'git', 'gitme',
  'kal', 'kalma', 'bak', 'sev', 'seviyorum', 'sevdim', 'olur', 'olmaz',
  'bitti', 'bitmez', 'gitti', 'kaldik', 'kaldim', 'dert', 'etmeler',
  'unutmam', 'unutma', 'hatirla', 'aglama', 'gulme', 'saril', 'opucuk',
  'kafama', 'gore', 'serseri', 'mayin', 'duser', 'aklima', 'oyle', 'kolaysa',
  'gidiyorum', 'yanimda', 'sensiz', 'bensiz', 'yalan', 'gercek', 'ruyalar',
  'ruya', 'masal', 'hikaye', 'sarki', 'turku', 'siir', 'sokak', 'sokaklar',
  'sehir', 'istanbul', 'ankara', 'izmir', 'bogazici', 'bogaz', 'efkar',
  'kis', 'bahar', 'sonbahar', 'bir', 'iki', 'uc', 'cok', 'biraz', 'butun',
  'hepsi', 'sadece', 'cunku', 'eger', 'hala', 'asik', 'simarik', 'dudu',
  'kuzu', 'antidepresan', 'seninle', 'benimle', 'bizimle', 'uzgunum',
]);

const FOREIGN_WORDS = new Set<string>([
  'the', 'and', 'you', 'your', 'yours', 'youre', 'with', 'for', 'from',
  'that', 'this', 'these', 'those', 'have', 'has', 'had', 'will', 'would',
  'could', 'should', 'cant', 'dont', 'doesnt', 'didnt', 'wont', 'isnt',
  'aint', 'im', 'ive', 'were', 'they', 'their', 'them', 'there', 'here',
  'where', 'when', 'what', 'which', 'who', 'why', 'how', 'she', 'his',
  'him', 'its', 'our', 'ours', 'my', 'mine', 'of', 'la', 'love', 'heart',
  'night', 'nights', 'day', 'days', 'baby', 'girl', 'girls', 'boy', 'boys',
  'man', 'woman', 'life', 'world', 'time', 'never', 'always', 'forever',
  'ever', 'every', 'everything', 'nothing', 'something', 'someone', 'nobody',
  'everybody', 'all', 'out', 'into', 'about', 'over', 'under', 'down',
  'back', 'away', 'home', 'house', 'city', 'street', 'streets', 'light',
  'lights', 'dark', 'black', 'white', 'blue', 'red', 'gold', 'golden',
  'silver', 'fire', 'rain', 'sky', 'stars', 'moon', 'sun', 'dream',
  'dreams', 'eyes', 'mind', 'soul', 'feel', 'feeling', 'feelings', 'know',
  'want', 'need', 'make', 'take', 'give', 'keep', 'hold', 'let', 'go',
  'going', 'gone', 'come', 'coming', 'stay', 'leave', 'run', 'running',
  'fall', 'falling', 'fly', 'cry', 'crying', 'die', 'dying', 'dead',
  'living', 'lost', 'alone', 'lonely', 'broken', 'happy', 'sad', 'crazy',
  'good', 'better', 'best', 'bad', 'little', 'big', 'new', 'old', 'young',
  'high', 'low', 'deep', 'hard', 'easy', 'true', 'real', 'only', 'just',
  'still', 'again', 'now', 'then', 'before', 'after', 'last', 'first',
  'one', 'two', 'three', 'four', 'five', 'midnight', 'morning', 'tonight',
  'today', 'yesterday', 'tomorrow', 'summer', 'winter', 'spring', 'queen',
  'king', 'family', 'madrigal', 'motive', 'anthem', 'song', 'music',
  'dance', 'dancing', 'party', 'kiss', 'touch', 'blood', 'tears', 'pain',
  'angel', 'heaven', 'hell', 'ghost', 'shadow', 'shadows', 'memory',
  'memories', 'beautiful', 'pretty', 'sweet', 'wild', 'free', 'cold',
  'warm', 'wait', 'waiting', 'stop', 'say', 'tell', 'look', 'see', 'hear',
  'think', 'believe', 'forget', 'remember', 'please', 'sorry', 'thank',
  'goodbye', 'hello', 'bye', 'too', 'very', 'more', 'most', 'much',
  'many', 'some', 'any', 'other', 'another', 'same', 'different', 'own',
  'off', 'through', 'without', 'between', 'around', 'against', 'until',
  'while', 'because', 'like', 'than', 'though', 'even', 'way', 'ways',
  'sunset', 'sunrise', 'chill', 'vibe', 'vibes', 'ocean', 'wave', 'waves',
  'silence', 'story', 'peace', 'magic', 'alive',
  'bande', 'organisee', 'les', 'des', 'une', 'est', 'avec', 'pour', 'dans',
  'sur', 'sans', 'tout', 'tous', 'mais', 'mon', 'ton', 'moi', 'toi',
  'vous', 'nous', 'qui', 'que', 'amor', 'corazon', 'vida', 'noche', 'fuego',
  'siempre', 'contigo', 'conmigo', 'quiero', 'chica', 'loco', 'loca', 'bella',
  'amore', 'und', 'ich', 'dich', 'mich', 'nicht', 'kein', 'keine', 'liebe',
  'herz', 'nacht', 'welt',
]);

const EXPLICIT_TURKISH_GENRES = [
  'turkish', 'turkce pop', 'turkce rock', 'turkce rap', 'turk pop', 'turk rock',
  'turk sanat', 'turk halk', 'arabesk', 'halk muzigi', 'anatolian rock',
  'anadolu rock', 'ozgun muzik', 'fantezi',
];

export function artistMatchesQuery(trackArtist: string, query: string): boolean {
  const normQuery = normalizeMusicText(query);
  if (!normQuery) return false;
  const tokens = splitArtistTokens(trackArtist);
  if (tokens.some((t) => t === normQuery)) return true;
  if (normQuery.includes(' ') && normQuery.length >= 6) {
    return tokens.some(
      (t) =>
        t === normQuery ||
        t.startsWith(`${normQuery} `) ||
        (t.length >= 6 && normQuery.startsWith(`${t} `))
    );
  }
  return false;
}

export function classifyTrackLanguage(input: {
  artist: string;
  title: string;
  genre?: string;
  album?: string;
}): 'tr' | 'global' {
  const artist = String(input.artist || '').trim();
  const title = String(input.title || '').trim();
  const album = String(input.album || '').trim();
  const genre = String(input.genre || '').trim();

  if (NON_LATIN_SCRIPT_REGEX.test(`${artist} ${title}`)) return 'global';

  const normGenre = normalizeMusicText(genre);
  const hasExplicitTurkishGenre = EXPLICIT_TURKISH_GENRES.some((g) => normGenre.includes(g));

  const artistTokens = splitArtistTokens(artist);
  const isKnownForeignArtist = artistTokens.some((t) => KNOWN_FOREIGN_ARTISTS.has(t));
  const isKnownTurkishArtist = artistTokens.some((t) => KNOWN_TURKISH_ARTISTS.has(t));
  const isAmbiguousTurkishArtist = artistTokens.some((t) => AMBIGUOUS_TR_ARTISTS.has(t));

  const combinedText = `${artist} ${title}`;
  const hasStrongTurkishChars = STRONG_TURKISH_CHAR_REGEX.test(combinedText);
  const hasSoftTurkishChars = SOFT_TURKISH_CHAR_REGEX.test(combinedText);
  const hasForeignDiacritics = FOREIGN_DIACRITIC_REGEX.test(combinedText);

  const titleWords = normalizeMusicText(`${title} ${album}`).split(' ').filter(Boolean);
  const turkishWordHits = titleWords.filter((w) => TURKISH_WORDS.has(w)).length;
  const foreignWordHits = titleWords.filter((w) => FOREIGN_WORDS.has(w)).length;

  const hasTurkishTitleSignals =
    hasStrongTurkishChars ||
    turkishWordHits > 0 ||
    (hasSoftTurkishChars && !hasForeignDiacritics && foreignWordHits === 0);
  const hasForeignTitleSignals = hasForeignDiacritics || foreignWordHits > 0;

  if (isKnownForeignArtist && !isKnownTurkishArtist) return 'global';
  if (isKnownTurkishArtist && !isKnownForeignArtist) return 'tr';
  if (isKnownTurkishArtist && isKnownForeignArtist) {
    return hasTurkishTitleSignals || !hasForeignTitleSignals ? 'tr' : 'global';
  }
  if (isAmbiguousTurkishArtist) {
    if (hasForeignTitleSignals && !hasStrongTurkishChars && turkishWordHits === 0) return 'global';
    if (hasTurkishTitleSignals || (hasExplicitTurkishGenre && !hasForeignTitleSignals)) return 'tr';
    return 'global';
  }
  if (hasForeignTitleSignals && !hasStrongTurkishChars && turkishWordHits === 0) return 'global';
  if (hasTurkishTitleSignals) return 'tr';
  if (hasExplicitTurkishGenre && !hasForeignTitleSignals) return 'tr';
  return 'global';
}

function buildYoutubeUrl(artist: string, title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${title}`)}`;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

const JUNK_TRACK_PATTERNS = [
  'karaoke',
  'ringtone',
  'tribute',
  '8-bit',
  '(skit)',
  'piano cover',
  'piano version',
  'solo piano',
  'arr. for',
  'originally performed',
  'originally by',
  'kidz bop',
  'nightcore',
  'slowed',
  'studioke',
  'wind ensemble',
  'string quartet',
  '(instrumental)',
  'instrumental version',
  'instrumental radio edit',
];

function isJunkTrack(title: string, artist: string): boolean {
  const lowered = `${title} ${artist}`.toLowerCase();
  if (JUNK_TRACK_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return true;
  }
  return /\bskit\b/.test(lowered);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchItunesTracks(
  term: string,
  mood: MoodType,
  language: 'tr' | 'global',
  energyTag: string,
  limit = 12,
  options?: { isArtistSearch?: boolean; strictLanguage?: boolean }
): Promise<OnlineTrackPayload[]> {
  const country = language === 'tr' ? 'TR' : 'US';
  const attributeParam = options?.isArtistSearch ? '&attribute=artistTerm' : '';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song${attributeParam}&country=${country}&limit=${limit}`;
  try {
    let resp: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.status === 403 || resp.status === 429) {
        await sleep(1800 + attempt * 1200);
        continue;
      }
      break;
    }
    if (!resp || !resp.ok) return [];
    const data: any = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const parsed: OnlineTrackPayload[] = [];

    for (const item of results) {
      const trackId = item?.trackId;
      const title = String(item?.trackName || '').trim();
      const artist = String(item?.artistName || '').trim();
      const preview = String(item?.previewUrl || '').trim();
      if (!trackId || !title || !artist || !preview) continue;

      if (isJunkTrack(title, artist)) {
        continue;
      }

      if (options?.isArtistSearch && !artistMatchesQuery(artist, term)) continue;

      const album = String(item?.collectionName || '');
      const rawGenre = String(item?.primaryGenreName || '').trim();
      const detectedLanguage = classifyTrackLanguage({ artist, title, genre: rawGenre, album });
      if (options?.strictLanguage && detectedLanguage !== language) continue;

      let safeGenre = rawGenre || (detectedLanguage === 'tr' ? 'Türkçe Pop' : 'Pop');
      if (detectedLanguage === 'global' && normalizeMusicText(safeGenre) === 'turkce') {
        safeGenre = 'Pop';
      }

      parsed.push({
        externalSource: 'itunes',
        externalId: String(trackId),
        title,
        artist,
        album,
        genre: safeGenre,
        mood,
        energyTag,
        language: detectedLanguage,
        artworkUrl: String(item?.artworkUrl100 || '').replace('100x100bb.jpg', '600x600bb.jpg'),
        previewUrl: preview,
        storeUrl: String(item?.trackViewUrl || ''),
        youtubeUrl: buildYoutubeUrl(artist, title),
        durationMs: Number(item?.trackTimeMillis || 30000),
        popularity: 76,
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
  limit = 10,
  options?: { isArtistSearch?: boolean; strictLanguage?: boolean }
): Promise<OnlineTrackPayload[]> {
  const queryParam = options?.isArtistSearch ? `artist:"${term.replace(/"/g, '').trim()}"` : term;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(queryParam)}&limit=${limit}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const results = Array.isArray(data?.data) ? data.data : [];
    const parsed: OnlineTrackPayload[] = [];

    for (const item of results) {
      const trackId = item?.id;
      const title = String(item?.title || '').trim();
      const artist = String(item?.artist?.name || '').trim();
      const preview = String(item?.preview || '').trim();
      if (!trackId || !title || !artist || !preview) continue;

      if (isJunkTrack(title, artist)) {
        continue;
      }

      if (options?.isArtistSearch && !artistMatchesQuery(artist, term)) continue;

      const album = String(item?.album?.title || '');
      const detectedLanguage = classifyTrackLanguage({ artist, title, genre: '', album });
      if (options?.strictLanguage && detectedLanguage !== language) continue;

      parsed.push({
        externalSource: 'deezer',
        externalId: String(trackId),
        title,
        artist,
        album,
        genre: detectedLanguage === 'tr' ? 'Türkçe Pop' : 'Pop',
        mood,
        energyTag,
        language: detectedLanguage,
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

export async function fetchOnlineTracksBatch(params: {
  mood: MoodType;
  emotion?: EmotionType | null;
  language?: 'all' | 'tr' | 'global';
  customQuery?: string;
  preferredArtists?: string[];
  artistsPerLang?: number;
  tracksPerQuery?: number;
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
    const customLimit = Math.max(10, params.tracksPerQuery ?? 15);
    const inferredLang = classifyTrackLanguage({ artist: q, title: q, genre: '' });
    const targetLang: 'tr' | 'global' = lang === 'tr' || lang === 'global' ? lang : inferredLang;
    const strict = lang === 'tr' || lang === 'global';
    jobs.push(
      fetchItunesTracks(q, mood, targetLang, energyTag, customLimit, {
        isArtistSearch: false,
        strictLanguage: strict,
      }),
      fetchDeezerTracks(q, mood, targetLang, energyTag, Math.max(8, customLimit), {
        isArtistSearch: false,
        strictLanguage: strict,
      })
    );
  } else {
    const keywordBank =
      emotion === 'angry'
        ? ANGRY_DISCOVERY_KEYWORDS
        : emotion === 'surprise'
          ? SURPRISE_DISCOVERY_KEYWORDS
          : LIVE_DISCOVERY_KEYWORDS[mood];

    const langsToQuery: Array<'tr' | 'global'> = lang === 'all' ? ['tr', 'global'] : [lang];
    const perLangCount = params.artistsPerLang ?? (lang === 'all' ? 3 : 5);
    const itunesLimit = params.tracksPerQuery ?? 12;
    const deezerLimit = Math.max(6, Math.round(itunesLimit * 0.75));

    for (const targetLang of langsToQuery) {
      const terms = pickRandom(keywordBank[targetLang], perLangCount);
      for (const term of terms) {
        const isArtistSearch = !COMPOUND_SEARCH_TERMS.has(term);
        jobs.push(
          fetchItunesTracks(term, mood, targetLang, energyTag, itunesLimit, {
            isArtistSearch,
            strictLanguage: true,
          })
        );
      }
      for (const term of terms.slice(0, 2)) {
        const isArtistSearch = !COMPOUND_SEARCH_TERMS.has(term);
        jobs.push(
          fetchDeezerTracks(term, mood, targetLang, energyTag, deezerLimit, {
            isArtistSearch,
            strictLanguage: true,
          })
        );
      }
    }

    const cleanPreferred = (params.preferredArtists || [])
      .map((a) => a.trim())
      .filter((a) => a.length > 1);
    if (cleanPreferred.length > 0) {
      for (const artist of pickRandom(cleanPreferred, Math.min(2, cleanPreferred.length))) {
        const artistDetectedLang = classifyTrackLanguage({ artist, title: '', genre: '' });
        if (lang === 'tr' && KNOWN_FOREIGN_ARTISTS.has(normalizeMusicText(artist))) continue;
        if (lang === 'global' && KNOWN_TURKISH_ARTISTS.has(normalizeMusicText(artist))) continue;
        const prefLang: 'tr' | 'global' =
          lang === 'tr' || lang === 'global' ? lang : artistDetectedLang;
        jobs.push(
          fetchItunesTracks(artist, mood, prefLang, energyTag, 6, {
            isArtistSearch: true,
            strictLanguage: lang === 'tr' || lang === 'global',
          })
        );
      }
    }
  }

  const flat = (await Promise.all(jobs)).flat();
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

export async function upsertTracksPg(payloads: OnlineTrackPayload[]): Promise<number> {
  if (!payloads.length) return 0;
  const db = getPool();
  let count = 0;

  // Batch upsert in chunks of 50 for fast PostgreSQL execution
  for (let i = 0; i < payloads.length; i += 50) {
    const chunk = payloads.slice(i, i + 50);
    const values: any[] = [];
    const tuples: string[] = [];

    chunk.forEach((t, idx) => {
      const base = idx * 15;
      tuples.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15})`
      );
      values.push(
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
        t.popularity
      );
    });

    const res = await db.query(
      `INSERT INTO tracks (
        external_source, external_id, title, artist, album, genre,
        mood, energy_tag, language, artwork_url, preview_url,
        store_url, youtube_url, duration_ms, popularity
      ) VALUES ${tuples.join(', ')}
      ON CONFLICT (external_source, external_id) DO UPDATE SET
        language = EXCLUDED.language,
        genre = CASE WHEN EXCLUDED.genre <> '' THEN EXCLUDED.genre ELSE tracks.genre END,
        preview_url = EXCLUDED.preview_url,
        artwork_url = CASE WHEN EXCLUDED.artwork_url <> '' THEN EXCLUDED.artwork_url ELSE tracks.artwork_url END,
        popularity = GREATEST(tracks.popularity, EXCLUDED.popularity)`,
      values
    );
    count += res.rowCount || chunk.length;
  }

  return count;
}

/**
 * Seeds thousands of curated Turkish & Global songs into Azure PostgreSQL
 * across all 5 emotions (happy, surprise, neutral, sad, angry) so users
 * immediately have a deep cloud library without local seeding.
 */
export async function seedFullCloudCatalog(
  tracksPerArtist = 20,
  maxQueries?: number
): Promise<{
  totalFetched: number;
  totalCatalog: number;
}> {
  const rawTasks: Array<{
    term: string;
    mood: MoodType;
    lang: 'tr' | 'global';
    energyTag: string;
  }> = [];

  for (const mood of ['negative', 'neutral', 'positive'] as MoodType[]) {
    const energyTag = mood === 'positive' ? 'upbeat' : mood === 'neutral' ? 'chill' : 'emotional';
    for (const lang of ['tr', 'global'] as const) {
      for (const term of LIVE_DISCOVERY_KEYWORDS[mood][lang]) {
        rawTasks.push({ term, mood, lang, energyTag });
      }
    }
  }
  for (const lang of ['tr', 'global'] as const) {
    for (const term of ANGRY_DISCOVERY_KEYWORDS[lang]) {
      rawTasks.push({ term, mood: 'negative', lang, energyTag: 'angry-rock' });
    }
    for (const term of SURPRISE_DISCOVERY_KEYWORDS[lang]) {
      rawTasks.push({ term, mood: 'positive', lang, energyTag: 'energetic' });
    }
  }

  // Interleave angry/negative/neutral/positive and shuffle slightly if maxQueries is capped
  const tasks =
    maxQueries && maxQueries < rawTasks.length
      ? pickRandom(rawTasks, maxQueries)
      : rawTasks;

  const itunesLimit = Math.min(25, Math.max(15, tracksPerArtist));
  const deezerLimit = Math.min(12, tracksPerArtist);
  const globalSeenSig = new Set<string>();
  let totalFetched = 0;

  // Concurrency 2 with gentle pacing so Apple iTunes Search API doesn't rate-limit
  for (let i = 0; i < tasks.length; i += 2) {
    const slice = tasks.slice(i, i + 2);
    const batchResults = await Promise.all(
      slice.map(async (item) => {
        const isArtistSearch = !COMPOUND_SEARCH_TERMS.has(item.term);
        const [it, dz] = await Promise.all([
          fetchItunesTracks(item.term, item.mood, item.lang, item.energyTag, itunesLimit, {
            isArtistSearch,
            strictLanguage: true,
          }),
          fetchDeezerTracks(item.term, item.mood, item.lang, item.energyTag, deezerLimit, {
            isArtistSearch,
            strictLanguage: true,
          }),
        ]);
        // Prioritize iTunes rows (non-expiring m4a previews) over Deezer rows
        return [...it, ...dz];
      })
    );

    const uniqueChunk: OnlineTrackPayload[] = [];
    for (const track of batchResults.flat()) {
      const sig = `${track.artist.toLowerCase().trim()}::${track.title.toLowerCase().trim()}`;
      if (!globalSeenSig.has(sig)) {
        globalSeenSig.add(sig);
        uniqueChunk.push(track);
      }
    }

    if (uniqueChunk.length > 0) {
      totalFetched += await upsertTracksPg(uniqueChunk);
    }

    if (i + 2 < tasks.length) {
      await sleep(750);
    }

    if ((i + 2) % 24 === 0 || i + 2 >= tasks.length) {
      console.log(
        `Seed progress: ${Math.min(i + 2, tasks.length)}/${tasks.length} queries, unique queued=${globalSeenSig.size}`
      );
    }
  }

  const db = getPool();
  const countRes = await db.query('SELECT COUNT(*)::int AS cnt FROM tracks');
  return {
    totalFetched,
    totalCatalog: Number(countRes.rows[0]?.cnt || 0),
  };
}

export interface UserTasteProfile {
  topArtists: string[];
  topGenres: string[];
  topArtistSet: Set<string>;
  topGenreSet: Set<string>;
  dislikedIds: Set<number>;
}

export async function getUserTasteProfile(userId: number): Promise<UserTasteProfile> {
  const db = getPool();
  const [favRes, dislikeRes] = await Promise.all([
    db.query(
      `SELECT t.artist, t.genre
       FROM favorites f
       JOIN tracks t ON t.id = f.track_id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC
       LIMIT 60`,
      [userId]
    ),
    db.query('SELECT track_id FROM disliked_tracks WHERE user_id = $1', [userId]),
  ]);

  const artistCounts = new Map<string, { label: string; count: number }>();
  const genreCounts = new Map<string, { label: string; count: number }>();

  for (const r of favRes.rows) {
    const a = String(r.artist || '').trim();
    if (a) {
      const k = a.toLowerCase();
      const prev = artistCounts.get(k);
      artistCounts.set(k, { label: prev?.label || a, count: (prev?.count || 0) + 1 });
    }
    const g = String(r.genre || '').trim();
    if (g) {
      const k = g.toLowerCase();
      const prev = genreCounts.get(k);
      genreCounts.set(k, { label: prev?.label || g, count: (prev?.count || 0) + 1 });
    }
  }

  const topArtists = Array.from(artistCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((x) => x.label);
  const topGenres = Array.from(genreCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((x) => x.label);

  return {
    topArtists,
    topGenres,
    topArtistSet: new Set(topArtists.map((a) => a.toLowerCase())),
    topGenreSet: new Set(topGenres.map((g) => g.toLowerCase())),
    dislikedIds: new Set(dislikeRes.rows.map((d) => Number(d.track_id))),
  };
}

export function rankAndFilterTracks(
  rawRows: any[],
  taste: UserTasteProfile,
  targetEmotion: EmotionType | null,
  limit: number,
  existingIds?: Set<number>,
  existingSignatures?: Set<string>
): TrackRecord[] {
  const seenIds = new Set<number>(existingIds || []);
  const seenSig = new Set<string>(existingSignatures || []);
  const scored: Array<{ track: TrackRecord; score: number }> = [];

  for (const raw of rawRows) {
    const tr = mapTrackRow(raw);
    if (taste.dislikedIds.has(tr.id) || seenIds.has(tr.id)) continue;
    const sig = `${tr.artist.toLowerCase().trim()}::${tr.title.toLowerCase().trim()}`;
    if (seenSig.has(sig)) continue;

    seenIds.add(tr.id);
    seenSig.add(sig);

    let score = Math.random() * 14;
    if (taste.topArtistSet.has(tr.artist.toLowerCase().trim())) score += 30;
    if (taste.topGenreSet.has(tr.genre.toLowerCase().trim())) score += 12;
    if (targetEmotion === 'angry' && tr.energyTag === 'angry-rock') score += 14;
    if (tr.isFavorite) score += 8;
    scored.push({ track: tr, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.track);
}

export async function selectPlaylistForMood(
  mood: MoodType,
  userId: number,
  count = 16,
  language: 'all' | 'tr' | 'global' = 'all',
  emotion?: EmotionType | null,
  strategy: MoodStrategy = 'match',
  existingIds?: Set<number>,
  existingSignatures?: Set<string>
): Promise<TrackRecord[]> {
  const db = getPool();
  const taste = await getUserTasteProfile(userId);
  const { targetMood, targetEmotion } = resolveTargetMoodForStrategy(emotion, mood, strategy);

  const queryPool = async (): Promise<TrackRecord[]> => {
    const whereParts = ['t.mood = $3', 'dt.track_id IS NULL'];
    const params: any[] = [userId, userId, targetMood];
    let pIdx = 4;

    if (language === 'tr' || language === 'global') {
      whereParts.push(`t.language = $${pIdx++}`);
      params.push(language);
    }

    if (targetEmotion === 'angry') {
      whereParts.push("(t.energy_tag = 'angry-rock' OR t.mood = 'negative')");
    }

    const poolLimit = Math.max(80, count * 6);
    params.push(targetEmotion || '');
    const emotionParamIdx = pIdx++;
    params.push(poolLimit);
    const limitParamIdx = pIdx++;

    const res = await db.query(
      `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
       FROM tracks t
       LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = $1
       LEFT JOIN disliked_tracks dt ON dt.track_id = t.id AND dt.user_id = $2
       WHERE ${whereParts.join(' AND ')}
       ORDER BY
         CASE WHEN $${emotionParamIdx} = 'angry' AND t.energy_tag = 'angry-rock' THEN 0 ELSE 1 END,
         RANDOM()
       LIMIT $${limitParamIdx}`,
      params
    );
    return rankAndFilterTracks(
      res.rows,
      taste,
      targetEmotion,
      count,
      existingIds,
      existingSignatures
    );
  };

  let selected = await queryPool();

  // If the cloud pool happens to run short for a specific filter, top it up from iTunes/Deezer automatically
  if (selected.length < count) {
    try {
      const fresh = await fetchOnlineTracksBatch({
        mood: targetMood,
        emotion: targetEmotion,
        language,
        preferredArtists: taste.topArtists,
      });
      if (fresh.length > 0) {
        await upsertTracksPg(fresh);
        selected = await queryPool();
      }
    } catch {
      // Ignore upstream network error; return available cloud catalog
    }
  }

  if (selected.length > 0) return selected;

  const fallbackRes = await db.query(
    `SELECT t.*, CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
     FROM tracks t
     LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = $1
     LEFT JOIN disliked_tracks dt ON dt.track_id = t.id AND dt.user_id = $2
     WHERE dt.track_id IS NULL
     ORDER BY RANDOM()
     LIMIT $3`,
    [userId, userId, Math.max(60, count * 4)]
  );
  return rankAndFilterTracks(
    fallbackRes.rows,
    taste,
    targetEmotion,
    count,
    existingIds,
    existingSignatures
  );
}
