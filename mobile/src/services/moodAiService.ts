import {
  analyzeFrameOnDevice,
  getNativeEngineInfo,
  isNativeVisionAvailable,
  warmupVisionEngine,
} from '../../modules/moodsync-vision';
import { EmotionType, MoodType } from '../theme/colors';

export interface LiveDetectionResult {
  detected: boolean;
  mood: MoodType | null;
  emotion: EmotionType | null;
  emotionLabel: string | null;
  confidence: number;
  faceBox: [number, number, number, number] | null;
  serverConnected: boolean;
  engine?: string;
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
      return {
        detected: Boolean(nativeRes.detected),
        mood: (nativeRes.mood as MoodType) || null,
        emotion: validEmotion,
        emotionLabel: nativeRes.emotionLabel || null,
        confidence: Number(nativeRes.confidence || 0),
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
    faceBox: null,
    serverConnected: true,
    engine: 'apple-vision',
  };
}
