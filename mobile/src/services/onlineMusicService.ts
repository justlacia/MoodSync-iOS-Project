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
      'Sefo',
      'Reynmen',
      'Dolu Kadehi Ters Tut',
      'Mirkelam',
      'Nil Karaibrahimgil',
      'Bedük',
      'Hande Yener',
      'Mustafa Sandal',
      'Oğuzhan Koç',
      'Melek Mosso',
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
      'Ed Sheeran',
      'Taylor Swift',
      'Billie Eilish Birds of a Feather',
      'Mark Ronson',
      'Katy Perry',
      'Justin Timberlake',
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
      'Yüzyüzeyken Konuşuruz',
      'Adamlar',
      'Mert Demir',
      'Sena Şener',
      'Pinhani',
      'Nilipek',
      'Nova Norda',
      'Ceylan Ertem',
      'Yaşlı Amca',
      'Mavi Gri',
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
      'Tame Impala',
      'Cigarettes After Sex',
      'Parcels',
      'Tom Misch',
      'Laufey',
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
      'Müslüm Gürses',
      'Yüksek Sadakat',
      'Seksendört',
      'Halil Sezai',
      'Tuğkan',
      'Perdenin Ardındakiler',
      'Emre Aydın',
      'Barış Akarsu',
      'Gripin',
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
      'Mitski',
      'James Blake',
      'Olivia Rodrigo',
      'Sam Smith',
      'Hozier',
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
    'Hayko Cepkin',
    'Athena',
    'Kurban',
    'Çilekeş',
    'Gazapizm',
    'Ezhel',
    'Şehinşah',
    'Pilli Bebek',
    'Kargo',
    'Norm Ender',
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
    'Metallica',
    'System of a Down',
    'Foo Fighters',
    'Kendrick Lamar',
    'Twenty One Pilots',
    'Rage Against The Machine',
  ],
};

const SURPRISE_DISCOVERY_KEYWORDS: Record<'tr' | 'global', string[]> = {
  tr: ['Edis', 'Tarkan', 'Hadise', 'Gülşen', 'Murda', 'Köfn', 'Athena', 'Lvbel C5', 'Aleyna Tilki', 'Blok3', 'Çakal', 'Semicenk'],
  global: [
    'Calvin Harris',
    'David Guetta',
    'Daft Punk',
    'Avicii',
    'Disclosure',
    'Dua Lipa',
    'Fred again',
    'Peggy Gou',
    'Kygo',
    'Martin Garrix',
  ],
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

export function buildSpotifySearchUrl(artist: string, title: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`;
}

export function buildYoutubeMusicUrl(artist: string, title: string): string {
  return `https://music.youtube.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
}

export function buildAppleMusicUrl(track: {
  storeUrl?: string;
  artist: string;
  title: string;
}): string {
  if (track.storeUrl && track.storeUrl.trim()) {
    return track.storeUrl.trim();
  }
  return `https://music.apple.com/search?term=${encodeURIComponent(`${track.artist} ${track.title}`)}`;
}

const COMPOUND_SEARCH_TERMS = new Set<string>([
  'Pharrell Williams Happy',
  'Coldplay Viva La Vida',
  'Billie Eilish Birds of a Feather',
  'Coldplay Fix You',
]);

const NON_LATIN_SCRIPT_REGEX =
  /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0370-\u03FF\u0590-\u05FF]/;
const STRONG_TURKISH_CHAR_REGEX = /[ğışİĞŞ]/;
const SOFT_TURKISH_CHAR_REGEX = /[çöüÇÖÜ]/;
const FOREIGN_DIACRITIC_REGEX = /[éèëàäïôñáíóúýœæøåčžšđłńćźż]/i;

/**
 * Normalizes Turkish & accented characters cleanly for artist/title comparisons.
 * Maps 'İ', 'I', and 'ı' before lowercasing so dotless/dotted I fold uniformly.
 */
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
    'Tarkan',
    'Mabel Matiz',
    'Edis',
    'Sertab Erener',
    'Kenan Doğulu',
    'Hadise',
    'Zeynep Bastık',
    'Yalın',
    'Evdeki Saat',
    'Simge',
    'Simge Sağın',
    'Gülşen',
    'Sefo',
    'Reynmen',
    'Dolu Kadehi Ters Tut',
    'Mirkelam',
    'Nil Karaibrahimgil',
    'Bedük',
    'Hande Yener',
    'Mustafa Sandal',
    'Oğuzhan Koç',
    'Melek Mosso',
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
    'Son Feci Bisiklet',
    'Yüzyüzeyken Konuşuruz',
    'Adamlar',
    'Mert Demir',
    'Sena Şener',
    'Pinhani',
    'Nilipek',
    'Nova Norda',
    'Ceylan Ertem',
    'Yaşlı Amca',
    'Mavi Gri',
    'Sezen Aksu',
    'Teoman',
    'Şebnem Ferah',
    'Duman',
    'Cem Adrian',
    'Dedublüman',
    'Can Ozan',
    'Emir Can İğrek',
    'Semicenk',
    'Müslüm Gürses',
    'Yüksek Sadakat',
    'Seksendört',
    'Halil Sezai',
    'Tuğkan',
    'Perdenin Ardındakiler',
    'Emre Aydın',
    'Barış Akarsu',
    'Gripin',
    'maNga',
    'Mor ve Ötesi',
    'Ceza',
    'Sagopa Kajmer',
    'Hayko Cepkin',
    'Kurban',
    'Çilekeş',
    'Gazapizm',
    'Ezhel',
    'Şehinşah',
    'Pilli Bebek',
    'Norm Ender',
    'Murda',
    'Köfn',
    'Lvbel C5',
    'Aleyna Tilki',
    'Blok3',
    'Çakal',
    'Ajda Pekkan',
    'İbrahim Tatlıses',
    'Ahmet Kaya',
    'Barış Manço',
    'Cem Karaca',
    'Yıldız Tilbe',
    'Ebru Gündeş',
    'Sıla',
    'Göksel',
    'Feridun Düzağaç',
  ].map(normalizeMusicText)
);

const AMBIGUOUS_TR_ARTISTS = new Set<string>(
  ['Athena', 'Madrigal', 'Pentagram', 'Motive', 'Uzi', 'Bade', 'Kargo'].map(normalizeMusicText)
);

const KNOWN_FOREIGN_ARTISTS = new Set<string>(
  [
    'ADÉLA',
    'Adela',
    'Kofs',
    'Soso Maness',
    'Naps',
    'Lil Uzi Vert',
    'Ariana Grande',
    'Stephanie Beatriz',
    'Dua Lipa',
    'The Weeknd',
    'Bruno Mars',
    'Calvin Harris',
    'Daft Punk',
    'Harry Styles',
    'Sabrina Carpenter',
    'Pharrell Williams',
    'Coldplay',
    'Avicii',
    'Queen',
    'Jungle',
    'Ed Sheeran',
    'Taylor Swift',
    'Billie Eilish',
    'Mark Ronson',
    'Katy Perry',
    'Justin Timberlake',
    'Tycho',
    'Bonobo',
    'Khruangbin',
    'Norah Jones',
    'Ludovico Einaudi',
    'Ólafur Arnalds',
    'Olafur Arnalds',
    'Men I Trust',
    'FKJ',
    'Beach House',
    'Nujabes',
    'Mac DeMarco',
    'Tame Impala',
    'Cigarettes After Sex',
    'Parcels',
    'Tom Misch',
    'Laufey',
    'Adele',
    'Lana Del Rey',
    'Radiohead',
    'Bon Iver',
    'Joji',
    'Hans Zimmer',
    'Lewis Capaldi',
    'Jeff Buckley',
    'Mitski',
    'James Blake',
    'Olivia Rodrigo',
    'Sam Smith',
    'Hozier',
    'Metallica',
    'Linkin Park',
    'System of a Down',
    'Rage Against the Machine',
    'Nirvana',
    'Slipknot',
    'Disturbed',
    'Three Days Grace',
    'Foo Fighters',
    'Green Day',
    'Red Hot Chili Peppers',
    'David Guetta',
    'Disclosure',
    'Fred again',
    'Peggy Gou',
    'Kygo',
    'Martin Garrix',
    'Eminem',
    'Drake',
    'Kendrick Lamar',
    'Travis Scott',
    'Kanye West',
    'Bad Bunny',
    'Shakira',
    'Rihanna',
    'Beyonce',
    'Lady Gaga',
    'Post Malone',
    'Jul',
    'SCH',
    'Ninho',
    'PNL',
  ].map(normalizeMusicText)
);

const TURKISH_WORDS = new Set<string>([
  'seni', 'beni', 'bende', 'sende', 'benim', 'senin', 'bizim', 'sizin', 'onun',
  'ask', 'askim', 'sevgi', 'sevgilim', 'kalp', 'kalbim', 'gonul', 'gonlum',
  'gece', 'geceler', 'gunduz', 'yildiz', 'yildizlar', 'yildizlarin', 'altinda',
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
  // French / Spanish / German unambiguous words
  'bande', 'organisee', 'les', 'des', 'une', 'est', 'avec', 'pour', 'dans',
  'sur', 'sans', 'tout', 'tous', 'mais', 'mon', 'ton', 'moi', 'toi',
  'vous', 'nous', 'qui', 'que', 'amor', 'corazon', 'vida', 'noche', 'fuego',
  'siempre', 'contigo', 'conmigo', 'quiero', 'chica', 'loco', 'loca', 'bella',
  'amore', 'und', 'ich', 'dich', 'mich', 'nicht', 'kein', 'keine', 'liebe',
  'herz', 'nacht', 'welt',
]);

const EXPLICIT_TURKISH_GENRES = [
  'turkish',
  'turkce pop',
  'turkce rock',
  'turkce rap',
  'turk pop',
  'turk rock',
  'turk sanat',
  'turk halk',
  'arabesk',
  'halk muzigi',
  'anatolian rock',
  'anadolu rock',
  'ozgun muzik',
  'fantezi',
];

export interface TrackLanguageInput {
  artist: string;
  title: string;
  genre?: string;
  album?: string;
  fallbackLanguage?: 'tr' | 'global';
}

/**
 * Verifies that a returned API track artist actually matches an artist search query,
 * preventing fuzzy search false positives (e.g. "Adele" -> "ADÉLA", "Bade" -> "Kofs").
 */
export function artistMatchesQuery(trackArtist: string, query: string): boolean {
  const normQuery = normalizeMusicText(query);
  if (!normQuery) return false;
  const tokens = splitArtistTokens(trackArtist);
  if (tokens.some((t) => t === normQuery)) {
    return true;
  }
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

/**
 * Deterministically classifies a track as 'tr' or 'global' using artist identity,
 * script/character sets, title/album lexical signals, and explicit genre metadata.
 * Fails closed to 'global' on ambiguous metadata so foreign songs never enter the 'tr' catalog.
 */
export function classifyTrackLanguage(input: TrackLanguageInput): 'tr' | 'global' {
  const artist = String(input.artist || '').trim();
  const title = String(input.title || '').trim();
  const album = String(input.album || '').trim();
  const genre = String(input.genre || '').trim();

  if (NON_LATIN_SCRIPT_REGEX.test(`${artist} ${title}`)) {
    return 'global';
  }

  const normGenre = normalizeMusicText(genre);
  // Ignore standalone polluted 'Türkçe' genre from legacy Deezer fetches unless corroborated
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

  if (isKnownForeignArtist && !isKnownTurkishArtist) {
    return 'global';
  }
  if (isKnownTurkishArtist && !isKnownForeignArtist) {
    return 'tr';
  }
  if (isKnownTurkishArtist && isKnownForeignArtist) {
    return hasTurkishTitleSignals || !hasForeignTitleSignals ? 'tr' : 'global';
  }

  if (isAmbiguousTurkishArtist) {
    if (hasForeignTitleSignals && !hasStrongTurkishChars && turkishWordHits === 0) {
      return 'global';
    }
    if (hasTurkishTitleSignals || (hasExplicitTurkishGenre && !hasForeignTitleSignals)) {
      return 'tr';
    }
    return 'global';
  }

  if (hasForeignTitleSignals && !hasStrongTurkishChars && turkishWordHits === 0) {
    return 'global';
  }
  if (hasTurkishTitleSignals) {
    return 'tr';
  }
  if (hasExplicitTurkishGenre && !hasForeignTitleSignals) {
    return 'tr';
  }

  return 'global';
}

interface FetchTrackOptions {
  isArtistSearch?: boolean;
  strictLanguage?: boolean;
}

async function fetchItunesTracks(
  term: string,
  mood: MoodType,
  language: 'tr' | 'global',
  energyTag: string,
  limit = 8,
  options?: FetchTrackOptions
): Promise<OnlineTrackPayload[]> {
  const country = language === 'tr' ? 'TR' : 'US';
  const attributeParam = options?.isArtistSearch ? '&attribute=artistTerm' : '';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song${attributeParam}&country=${country}&limit=${limit}`;
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

      if (options?.isArtistSearch && !artistMatchesQuery(artist, term)) {
        continue;
      }

      const album = String(item?.collectionName || '');
      const rawGenre = String(item?.primaryGenreName || '').trim();
      const detectedLanguage = classifyTrackLanguage({
        artist,
        title,
        genre: rawGenre,
        album,
        fallbackLanguage: language,
      });

      if (options?.strictLanguage && detectedLanguage !== language) {
        continue;
      }

      let safeGenre = rawGenre || (detectedLanguage === 'tr' ? 'Türkçe Pop' : 'Pop');
      if (detectedLanguage === 'global' && normalizeMusicText(safeGenre) === 'turkce') {
        safeGenre = 'Pop';
      }

      const artwork = String(item?.artworkUrl100 || '').replace('100x100bb.jpg', '600x600bb.jpg');
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
  limit = 6,
  options?: FetchTrackOptions
): Promise<OnlineTrackPayload[]> {
  const queryParam = options?.isArtistSearch
    ? `artist:"${term.replace(/"/g, '').trim()}"`
    : term;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(queryParam)}&limit=${limit}`;
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

      const lowered = `${title} ${artist}`.toLowerCase();
      if (
        lowered.includes('karaoke') ||
        lowered.includes('ringtone') ||
        lowered.includes('tribute') ||
        lowered.includes('8-bit')
      ) {
        continue;
      }

      if (options?.isArtistSearch && !artistMatchesQuery(artist, term)) {
        continue;
      }

      const album = String(item?.album?.title || '');
      const detectedLanguage = classifyTrackLanguage({
        artist,
        title,
        genre: '',
        album,
        fallbackLanguage: language,
      });

      if (options?.strictLanguage && detectedLanguage !== language) {
        continue;
      }

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

/**
 * Fetches fresh songs directly from Apple iTunes & Deezer APIs on the iPhone
 * (zero dependency on any PC server).
 */
export async function fetchOnlineTracksDirect(params: {
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
    const customLimit = Math.max(10, params.tracksPerQuery ?? 12);
    const inferredLang = classifyTrackLanguage({ artist: q, title: q, genre: '' });
    const targetLang: 'tr' | 'global' =
      lang === 'tr' || lang === 'global' ? lang : inferredLang;
    const strict = lang === 'tr' || lang === 'global';
    jobs.push(
      fetchItunesTracks(q, mood, targetLang, energyTag, customLimit, {
        isArtistSearch: false,
        strictLanguage: strict,
      })
    );
    jobs.push(
      fetchDeezerTracks(
        q,
        mood,
        targetLang,
        energyTag,
        Math.max(6, Math.round(customLimit * 0.8)),
        { isArtistSearch: false, strictLanguage: strict }
      )
    );
  } else {
    const keywordBank =
      emotion === 'angry'
        ? ANGRY_DISCOVERY_KEYWORDS
        : emotion === 'surprise'
        ? SURPRISE_DISCOVERY_KEYWORDS
        : LIVE_DISCOVERY_KEYWORDS[mood];

    const langsToQuery: Array<'tr' | 'global'> =
      lang === 'all' ? ['tr', 'global'] : [lang];
    const perLangCount = params.artistsPerLang ?? (lang === 'all' ? 3 : 4);
    const itunesLimit = params.tracksPerQuery ?? 10;
    const deezerLimit = Math.max(5, Math.round(itunesLimit * 0.7));

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
      const chosenArtists = pickRandom(cleanPreferred, Math.min(2, cleanPreferred.length));
      for (const artist of chosenArtists) {
        const artistDetectedLang = classifyTrackLanguage({ artist, title: '', genre: '' });
        if (lang === 'tr' && KNOWN_FOREIGN_ARTISTS.has(normalizeMusicText(artist))) {
          continue;
        }
        if (lang === 'global' && KNOWN_TURKISH_ARTISTS.has(normalizeMusicText(artist))) {
          continue;
        }
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
