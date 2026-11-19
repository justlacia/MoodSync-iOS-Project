export type MoodType = 'positive' | 'neutral' | 'negative';
export type EmotionType = 'happy' | 'surprise' | 'neutral' | 'sad' | 'angry';

export const Colors = {
  canvas: '#FAF8F4',
  surface: '#FFFFFF',
  subtle: '#F1EDE6',
  elevated: '#FCFBF9',
  inkPrimary: '#181D25',
  inkSecondary: '#5A6270',
  inkMuted: '#8B93A1',
  hairline: 'rgba(24, 29, 37, 0.08)',
  hairlineStrong: 'rgba(24, 29, 37, 0.15)',

  brand: '#E25834',
  brandDark: '#C84726',
  brandSoft: 'rgba(226, 88, 52, 0.12)',

  moodPositive: '#E07A1F',
  moodPositiveSoft: 'rgba(224, 122, 31, 0.14)',
  moodNeutral: '#1F8A7C',
  moodNeutralSoft: 'rgba(31, 138, 124, 0.13)',
  moodNegative: '#3B6E9C',
  moodNegativeSoft: 'rgba(59, 110, 156, 0.14)',
  moodAngry: '#D93829',
  moodAngrySoft: 'rgba(217, 56, 41, 0.14)',

  danger: '#D93829',
  dangerSoft: 'rgba(217, 56, 41, 0.10)',
  cameraBg: '#0E1014',
  hudGlass: 'rgba(14, 16, 22, 0.78)',
};

export interface MoodVisualMeta {
  shortTr: string;
  fullTr: string;
  color: string;
  softColor: string;
  dotColor: string;
  subtitle: string;
}

export const MoodMeta: Record<MoodType, MoodVisualMeta> = {
  positive: {
    shortTr: 'Mutlu',
    fullTr: 'Mutlu & Enerjik',
    color: Colors.moodPositive,
    softColor: Colors.moodPositiveSoft,
    dotColor: '#FF9F43',
    subtitle: 'Yüksek enerjili, neşeli ve ritmik seçki',
  },
  neutral: {
    shortTr: 'Dingin',
    fullTr: 'Dingin & Dengeli',
    color: Colors.moodNeutral,
    softColor: Colors.moodNeutralSoft,
    dotColor: '#2EC4B6',
    subtitle: 'Odaklanmaya ve akışta kalmaya uygun dingin parçalar',
  },
  negative: {
    shortTr: 'Üzgün',
    fullTr: 'Üzgün & Melankolik',
    color: Colors.moodNegative,
    softColor: Colors.moodNegativeSoft,
    dotColor: '#4F86F7',
    subtitle: 'İçsel, akustik ve ruhu dinlendiren melodiler',
  },
};

export const EmotionMeta: Record<EmotionType, MoodVisualMeta> = {
  happy: {
    shortTr: 'Mutlu',
    fullTr: 'Mutlu & Enerjik',
    color: Colors.moodPositive,
    softColor: Colors.moodPositiveSoft,
    dotColor: '#FF9F43',
    subtitle: 'Yüksek enerjili, neşeli ve ritmik seçki',
  },
  surprise: {
    shortTr: 'Heyecanlı',
    fullTr: 'Heyecanlı & Dinamik',
    color: '#EA580C',
    softColor: 'rgba(234, 88, 12, 0.14)',
    dotColor: '#FB923C',
    subtitle: 'Yüksek tempolu, heyecan verici ve hareketli parçalar',
  },
  neutral: {
    shortTr: 'Dingin',
    fullTr: 'Dingin & Dengeli',
    color: Colors.moodNeutral,
    softColor: Colors.moodNeutralSoft,
    dotColor: '#2EC4B6',
    subtitle: 'Odaklanmaya ve akışta kalmaya uygun dingin parçalar',
  },
  sad: {
    shortTr: 'Üzgün',
    fullTr: 'Üzgün & Melankolik',
    color: Colors.moodNegative,
    softColor: Colors.moodNegativeSoft,
    dotColor: '#4F86F7',
    subtitle: 'Duygusal, akustik ve melankolik şarkı seçkisi',
  },
  angry: {
    shortTr: 'Kızgın',
    fullTr: 'Kızgın & Deşarj',
    color: Colors.moodAngry,
    softColor: Colors.moodAngrySoft,
    dotColor: '#EF4444',
    subtitle: 'Stres attıran yüksek enerjili Rock, Rap ve Alternatif parçalar',
  },
};

export function emotionToMood(emotion: EmotionType): MoodType {
  if (emotion === 'happy' || emotion === 'surprise') return 'positive';
  if (emotion === 'neutral') return 'neutral';
  return 'negative';
}

export function resolveMoodVisual(mood: MoodType, emotion?: EmotionType | string | null): MoodVisualMeta {
  if (emotion && emotion in EmotionMeta) {
    return EmotionMeta[emotion as EmotionType];
  }
  return MoodMeta[mood] || MoodMeta.neutral;
}
