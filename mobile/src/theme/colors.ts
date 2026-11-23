export type MoodType = 'positive' | 'neutral' | 'negative';
export type EmotionType = 'happy' | 'surprise' | 'neutral' | 'sad' | 'angry';
export type ThemeId = 'oled' | 'obsidian' | 'midnight' | 'light';

export interface ThemePalette {
  id: ThemeId;
  nameTr: string;
  descTr: string;
  isDark: boolean;
  swatchBg: string;
  swatchAccent: string;

  canvas: string;
  surface: string;
  subtle: string;
  elevated: string;
  dockBg: string;
  inkPrimary: string;
  inkSecondary: string;
  inkMuted: string;
  hairline: string;
  hairlineStrong: string;

  brand: string;
  brandDark: string;
  brandSoft: string;

  moodPositive: string;
  moodPositiveSoft: string;
  moodNeutral: string;
  moodNeutralSoft: string;
  moodNegative: string;
  moodNegativeSoft: string;
  moodAngry: string;
  moodAngrySoft: string;

  danger: string;
  dangerSoft: string;
  cameraBg: string;
  hudGlass: string;
  shadowColor: string;
}

export const Themes: Record<ThemeId, ThemePalette> = {
  oled: {
    id: 'oled',
    nameTr: 'OLED Simsiyah',
    descTr: 'iPhone 16 Pro OLED için saf #000000 siyah',
    isDark: true,
    swatchBg: '#000000',
    swatchAccent: '#FF6242',

    canvas: '#000000',
    surface: '#090B0E',
    subtle: '#13161C',
    elevated: '#0E1116',
    dockBg: 'rgba(0, 0, 0, 0.92)',
    inkPrimary: '#F7F8FA',
    inkSecondary: '#A4ACB9',
    inkMuted: '#68707E',
    hairline: 'rgba(255, 255, 255, 0.09)',
    hairlineStrong: 'rgba(255, 255, 255, 0.16)',

    brand: '#FF6242',
    brandDark: '#E54B2B',
    brandSoft: 'rgba(255, 98, 66, 0.16)',

    moodPositive: '#FFA047',
    moodPositiveSoft: 'rgba(255, 160, 71, 0.17)',
    moodNeutral: '#2ED1BF',
    moodNeutralSoft: 'rgba(46, 209, 191, 0.16)',
    moodNegative: '#639BFF',
    moodNegativeSoft: 'rgba(99, 155, 255, 0.17)',
    moodAngry: '#FF4D4D',
    moodAngrySoft: 'rgba(255, 77, 77, 0.18)',

    danger: '#FF5252',
    dangerSoft: 'rgba(255, 82, 82, 0.15)',
    cameraBg: '#000000',
    hudGlass: 'rgba(0, 0, 0, 0.80)',
    shadowColor: '#000000',
  },
  obsidian: {
    id: 'obsidian',
    nameTr: 'Obsidyen Karbon',
    descTr: 'Derin grafit yüzeyler ve sıcak mercan',
    isDark: true,
    swatchBg: '#12161F',
    swatchAccent: '#F45D3A',

    canvas: '#0C0F14',
    surface: '#151A23',
    subtle: '#1F2633',
    elevated: '#19202B',
    dockBg: 'rgba(12, 15, 20, 0.94)',
    inkPrimary: '#F3F5F8',
    inkSecondary: '#9EA8B8',
    inkMuted: '#6C7687',
    hairline: 'rgba(255, 255, 255, 0.08)',
    hairlineStrong: 'rgba(255, 255, 255, 0.15)',

    brand: '#F45D3A',
    brandDark: '#D84827',
    brandSoft: 'rgba(244, 93, 58, 0.16)',

    moodPositive: '#FF9E44',
    moodPositiveSoft: 'rgba(255, 158, 68, 0.16)',
    moodNeutral: '#2EC4B6',
    moodNeutralSoft: 'rgba(46, 196, 182, 0.16)',
    moodNegative: '#5E92F3',
    moodNegativeSoft: 'rgba(94, 146, 243, 0.16)',
    moodAngry: '#F24C4C',
    moodAngrySoft: 'rgba(242, 76, 76, 0.17)',

    danger: '#F24C4C',
    dangerSoft: 'rgba(242, 76, 76, 0.15)',
    cameraBg: '#080A0E',
    hudGlass: 'rgba(12, 15, 20, 0.82)',
    shadowColor: '#000000',
  },
  midnight: {
    id: 'midnight',
    nameTr: 'Gece İndigo',
    descTr: 'Koyu lacivert atmosfer ve neon vurgu',
    isDark: true,
    swatchBg: '#0F1529',
    swatchAccent: '#7C6BFF',

    canvas: '#080B16',
    surface: '#11162A',
    subtle: '#1B223D',
    elevated: '#151C34',
    dockBg: 'rgba(8, 11, 22, 0.94)',
    inkPrimary: '#F4F6FF',
    inkSecondary: '#9CA6C9',
    inkMuted: '#687399',
    hairline: 'rgba(165, 180, 252, 0.12)',
    hairlineStrong: 'rgba(165, 180, 252, 0.22)',

    brand: '#7C6BFF',
    brandDark: '#6351EB',
    brandSoft: 'rgba(124, 107, 255, 0.18)',

    moodPositive: '#FFB057',
    moodPositiveSoft: 'rgba(255, 176, 87, 0.17)',
    moodNeutral: '#34D9C7',
    moodNeutralSoft: 'rgba(52, 217, 199, 0.16)',
    moodNegative: '#6BA2FF',
    moodNegativeSoft: 'rgba(107, 162, 255, 0.18)',
    moodAngry: '#FF5768',
    moodAngrySoft: 'rgba(255, 87, 104, 0.18)',

    danger: '#FF5768',
    dangerSoft: 'rgba(255, 87, 104, 0.16)',
    cameraBg: '#05070E',
    hudGlass: 'rgba(8, 11, 22, 0.82)',
    shadowColor: '#000000',
  },
  light: {
    id: 'light',
    nameTr: 'Klasik Fildişi',
    descTr: 'Aydınlık, sıcak ve ferah görünüm',
    isDark: false,
    swatchBg: '#FAF8F4',
    swatchAccent: '#E25834',

    canvas: '#FAF8F4',
    surface: '#FFFFFF',
    subtle: '#F1EDE6',
    elevated: '#FCFBF9',
    dockBg: 'rgba(255, 255, 255, 0.94)',
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
    shadowColor: '#181D25',
  },
};

export const THEME_LIST: ThemePalette[] = [
  Themes.oled,
  Themes.obsidian,
  Themes.midnight,
  Themes.light,
];

// Default fallback export for static references
export const Colors = Themes.oled;

export interface MoodVisualMeta {
  shortTr: string;
  fullTr: string;
  color: string;
  softColor: string;
  dotColor: string;
  subtitle: string;
}

export function resolveMoodVisual(
  mood: MoodType,
  emotion?: EmotionType | string | null,
  palette: ThemePalette = Themes.oled
): MoodVisualMeta {
  const emotionMap: Record<EmotionType, MoodVisualMeta> = {
    happy: {
      shortTr: 'Mutlu',
      fullTr: 'Mutlu & Enerjik',
      color: palette.moodPositive,
      softColor: palette.moodPositiveSoft,
      dotColor: '#FF9F43',
      subtitle: 'Yüksek enerjili, neşeli ve ritmik seçki',
    },
    surprise: {
      shortTr: 'Heyecanlı',
      fullTr: 'Heyecanlı & Dinamik',
      color: '#FB923C',
      softColor: 'rgba(251, 146, 60, 0.16)',
      dotColor: '#FB923C',
      subtitle: 'Yüksek tempolu, heyecan verici ve hareketli parçalar',
    },
    neutral: {
      shortTr: 'Dingin',
      fullTr: 'Dingin & Dengeli',
      color: palette.moodNeutral,
      softColor: palette.moodNeutralSoft,
      dotColor: '#2EC4B6',
      subtitle: 'Odaklanmaya ve akışta kalmaya uygun dingin parçalar',
    },
    sad: {
      shortTr: 'Üzgün',
      fullTr: 'Üzgün & Melankolik',
      color: palette.moodNegative,
      softColor: palette.moodNegativeSoft,
      dotColor: '#4F86F7',
      subtitle: 'Duygusal, akustik ve melankolik şarkı seçkisi',
    },
    angry: {
      shortTr: 'Kızgın',
      fullTr: 'Kızgın & Deşarj',
      color: palette.moodAngry,
      softColor: palette.moodAngrySoft,
      dotColor: '#EF4444',
      subtitle: 'Stres attıran yüksek enerjili Rock, Rap ve Alternatif parçalar',
    },
  };

  if (emotion && emotion in emotionMap) {
    return emotionMap[emotion as EmotionType];
  }
  if (mood === 'positive') return emotionMap.happy;
  if (mood === 'negative') return emotionMap.sad;
  return emotionMap.neutral;
}

export function emotionToMood(emotion: EmotionType): MoodType {
  if (emotion === 'happy' || emotion === 'surprise') return 'positive';
  if (emotion === 'neutral') return 'neutral';
  return 'negative';
}

export type EmotionScores = Record<EmotionType, number>;

export const ALL_EMOTIONS: EmotionType[] = ['happy', 'surprise', 'neutral', 'sad', 'angry'];

export type MoodStrategy = 'match' | 'uplift';

export const JOURNAL_QUICK_TAGS = [
  'Kahve',
  'İş',
  'Spor',
  'Gece',
  'Arkadaşlar',
  'Yürüyüş',
  'Ders',
  'Yolculuk',
] as const;

export function resolveTargetMoodForStrategy(
  detectedEmotion: EmotionType | null | undefined,
  detectedMood: MoodType,
  strategy: MoodStrategy
): {
  targetMood: MoodType;
  targetEmotion: EmotionType;
  titleTr: string;
  descriptionTr: string;
} {
  const baseEmotion: EmotionType =
    detectedEmotion && ALL_EMOTIONS.includes(detectedEmotion)
      ? detectedEmotion
      : detectedMood === 'positive'
        ? 'happy'
        : detectedMood === 'negative'
          ? 'sad'
          : 'neutral';

  if (strategy === 'match') {
    const visual = resolveMoodVisual(detectedMood, baseEmotion);
    return {
      targetMood: detectedMood,
      targetEmotion: baseEmotion,
      titleTr: 'Moduma Eşlik Et',
      descriptionTr: visual.subtitle,
    };
  }

  switch (baseEmotion) {
    case 'sad':
      return {
        targetMood: 'positive',
        targetEmotion: 'happy',
        titleTr: 'Modumu Yükselt',
        descriptionTr: 'Modunu nazikçe pozitife ve enerjiye taşıyan parçalar',
      };
    case 'angry':
      return {
        targetMood: 'neutral',
        targetEmotion: 'neutral',
        titleTr: 'Modumu Yükselt',
        descriptionTr: 'Gerginliği azaltıp zihnini dengeleyen dingin seçki',
      };
    case 'neutral':
      return {
        targetMood: 'positive',
        targetEmotion: 'happy',
        titleTr: 'Modumu Yükselt',
        descriptionTr: 'Dinginlikten neşeli ve enerjik ritme geçiren seçki',
      };
    case 'happy':
      return {
        targetMood: 'positive',
        targetEmotion: 'surprise',
        titleTr: 'Modumu Yükselt',
        descriptionTr: 'Yüksek enerjini zirvede tutan tempolu ve dinamik seçki',
      };
    case 'surprise':
      return {
        targetMood: 'positive',
        targetEmotion: 'happy',
        titleTr: 'Modumu Yükselt',
        descriptionTr: 'Heyecanını neşeli ve akıcı ritimle besleyen seçki',
      };
  }
}
