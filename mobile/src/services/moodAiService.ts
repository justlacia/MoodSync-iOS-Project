import {
  analyzeFrameOnDevice,
  getNativeEngineInfo,
  isNativeVisionAvailable,
  warmupVisionEngine,
} from '../../modules/moodsync-vision';
import { ALL_EMOTIONS, EmotionScores, EmotionType, MoodType } from '../theme/colors';

export interface LiveDetectionResult {
  detected: boolean;
  mood: MoodType | null;
  emotion: EmotionType | null;
  emotionLabel: string | null;
  confidence: number;
  emotionScores: EmotionScores | null;
  faceBox: [number, number, number, number] | null;
  serverConnected: boolean;
  engine?: string;
}

function normalizeEmotionScores(
  raw: Record<string, number> | null | undefined,
  fallbackEmotion: EmotionType | null,
  fallbackConf: number
): EmotionScores | null {
  if (raw && typeof raw === 'object') {
    const out: EmotionScores = {
      happy: 0,
      surprise: 0,
      neutral: 0,
      sad: 0,
      angry: 0,
    };
    let sum = 0;
    for (const em of ALL_EMOTIONS) {
      const val = Number(raw[em] ?? 0);
      const safe = Number.isFinite(val) && val > 0 ? val : 0;
      out[em] = safe;
      sum += safe;
    }
    if (sum > 0) {
      for (const em of ALL_EMOTIONS) {
        out[em] = out[em] / sum;
      }
      return out;
    }
  }
  if (!fallbackEmotion) return null;
  const clamped = Math.max(0.4, Math.min(0.95, fallbackConf || 0.78));
  const rest = (1 - clamped) / (ALL_EMOTIONS.length - 1);
  return {
    happy: fallbackEmotion === 'happy' ? clamped : rest,
    surprise: fallbackEmotion === 'surprise' ? clamped : rest,
    neutral: fallbackEmotion === 'neutral' ? clamped : rest,
    sad: fallbackEmotion === 'sad' ? clamped : rest,
    angry: fallbackEmotion === 'angry' ? clamped : rest,
  };
}

export function getAiEngineSummary(): { onDevice: boolean; engine: string; label: string } {
  const info = getNativeEngineInfo();
  return {
    onDevice: info.available,
    engine: info.engine,
    label: info.label,
  };
}

export async function warmupAiEngine(): Promise<boolean> {
  if (!isNativeVisionAvailable()) {
    return false;
  }
  return warmupVisionEngine();
}

/**
 * Analyzes a base64 JPEG camera frame 100% on-device via Apple Vision + AffectNet ONNX.
 */
export async function analyzeCameraFrame(
  base64Jpeg: string,
  isFinalCapture = false
): Promise<LiveDetectionResult> {
  if (!isNativeVisionAvailable()) {
    return {
      detected: false,
      mood: null,
      emotion: null,
      emotionLabel: null,
      confidence: 0,
      emotionScores: null,
      faceBox: null,
      serverConnected: false,
      engine: 'none',
    };
  }

  try {
    const nativeRes = await analyzeFrameOnDevice(base64Jpeg, isFinalCapture);
    if (nativeRes) {
      const validEmotion =
        nativeRes.emotion &&
        ['happy', 'surprise', 'neutral', 'sad', 'angry'].includes(nativeRes.emotion)
          ? (nativeRes.emotion as EmotionType)
          : null;
      const confidence = Number(nativeRes.confidence || 0);
      return {
        detected: Boolean(nativeRes.detected),
        mood: (nativeRes.mood as MoodType) || null,
        emotion: validEmotion,
        emotionLabel: nativeRes.emotionLabel || null,
        confidence,
        emotionScores: normalizeEmotionScores(
          nativeRes.emotionScores,
          validEmotion,
          confidence
        ),
        faceBox:
          Array.isArray(nativeRes.faceBox) && nativeRes.faceBox.length === 4
            ? nativeRes.faceBox
            : null,
        serverConnected: true,
        engine: nativeRes.engine,
      };
    }
  } catch {
    // Fall through to clean undetected result
  }

  return {
    detected: false,
    mood: null,
    emotion: null,
    emotionLabel: null,
    confidence: 0,
    emotionScores: null,
    faceBox: null,
    serverConnected: true,
    engine: 'apple-vision',
  };
}
