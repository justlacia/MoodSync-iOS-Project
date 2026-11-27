export type MoodType = 'positive' | 'neutral' | 'negative';
export type EmotionType = 'happy' | 'surprise' | 'neutral' | 'sad' | 'angry';
export type MoodStrategy = 'match' | 'uplift';
export type UserRole = 'admin' | 'user';
export type EmotionScores = Record<EmotionType, number>;

export const ALL_EMOTIONS: EmotionType[] = ['happy', 'surprise', 'neutral', 'sad', 'angry'];

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
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

export type AdminTableName =
  | 'users'
  | 'scan_sessions'
  | 'tracks'
  | 'favorites'
  | 'scan_session_tracks'
  | 'disliked_tracks'
  | 'playlists'
  | 'playlist_tracks'
  | 'biometric_tokens'
  | 'user_settings';

export function emotionToMood(emotion: EmotionType): MoodType {
  if (emotion === 'happy' || emotion === 'surprise') return 'positive';
  if (emotion === 'neutral') return 'neutral';
  return 'negative';
}

export function resolveTargetMoodForStrategy(
  detectedEmotion: EmotionType | null | undefined,
  detectedMood: MoodType,
  strategy: MoodStrategy
): { targetMood: MoodType; targetEmotion: EmotionType } {
  const baseEmotion: EmotionType =
    detectedEmotion && ALL_EMOTIONS.includes(detectedEmotion)
      ? detectedEmotion
      : detectedMood === 'positive'
        ? 'happy'
        : detectedMood === 'negative'
          ? 'sad'
          : 'neutral';

  if (strategy === 'match') {
    return { targetMood: detectedMood, targetEmotion: baseEmotion };
  }

  switch (baseEmotion) {
    case 'sad':
      return { targetMood: 'positive', targetEmotion: 'happy' };
    case 'angry':
      return { targetMood: 'neutral', targetEmotion: 'neutral' };
    case 'neutral':
      return { targetMood: 'positive', targetEmotion: 'happy' };
    case 'happy':
      return { targetMood: 'positive', targetEmotion: 'surprise' };
    case 'surprise':
      return { targetMood: 'positive', targetEmotion: 'happy' };
  }
}
