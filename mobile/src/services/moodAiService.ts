import Constants from 'expo-constants';
import {
  analyzeFrameOnDevice,
  getNativeEngineInfo,
  isNativeVisionAvailable,
} from '../../modules/moodsync-vision';
import serverEndpoints from '../config/serverEndpoints.json';
import { getSetting, setSetting } from '../database/iosDatabase';
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

let cachedWorkingBaseUrl: string | null = null;

export function getAiEngineSummary(): { onDevice: boolean; engine: string; label: string } {
  const info = getNativeEngineInfo();
  return {
    onDevice: info.available,
    engine: info.engine,
    label: info.label,
  };
}

export function getCandidateServerUrls(customUrl: string | null): string[] {
  const candidates: string[] = [];
  const pushUnique = (u: string | null | undefined) => {
    if (!u) return;
    const trimmed = u.trim().replace(/\/+$/, '');
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  if (customUrl) {
    pushUnique(customUrl);
  }
  if (cachedWorkingBaseUrl) {
    pushUnique(cachedWorkingBaseUrl);
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoClient?.hostUri ||
    null;

  if (hostUri) {
    const isTunnel =
      hostUri.includes('exp.direct') ||
      hostUri.includes('ngrok') ||
      hostUri.includes('trycloudflare');
    pushUnique(`${isTunnel ? 'https' : 'http'}://${hostUri}`);

    const hostOnly = hostUri.split(':')[0];
    if (hostOnly && !isTunnel) {
      pushUnique(`http://${hostOnly}:8000`);
    }
  }

  if (Array.isArray(serverEndpoints?.urls)) {
    for (const u of serverEndpoints.urls) {
      pushUnique(u);
    }
  }

  return candidates;
}

export async function resolveAiServerUrl(): Promise<string | null> {
  const custom = await getSetting('ai_server_url');
  const candidates = getCandidateServerUrls(custom);
  return candidates[0] || null;
}

export async function saveCustomAiServerUrl(url: string | null): Promise<void> {
  cachedWorkingBaseUrl = null;
  await setSetting('ai_server_url', url && url.trim() ? url.trim().replace(/\/+$/, '') : null);
}

/**
 * Analyzes a base64 JPEG camera frame.
 * 1. Primary (Standalone iOS): Runs 100% on-device via Apple Vision + CoreML (zero PC dependency).
 * 2. Fallback (Expo Go dev mode only): Falls back to optional LAN server if native module is absent.
 */
export async function analyzeCameraFrame(
  base64Jpeg: string,
  isFinalCapture = false
): Promise<LiveDetectionResult> {
  if (isNativeVisionAvailable()) {
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
  }

  // Optional fallback only when running inside Expo Go without native Xcode build
  const custom = await getSetting('ai_server_url');
  const candidates = getCandidateServerUrls(custom);
  const payload = JSON.stringify({
    imageBase64: base64Jpeg.startsWith('data:')
      ? base64Jpeg
      : `data:image/jpeg;base64,${base64Jpeg}`,
    live: !isFinalCapture,
  });

  for (const baseUrl of candidates) {
    try {
      const controller = new AbortController();
      const timeoutMs = isFinalCapture ? 5000 : baseUrl === cachedWorkingBaseUrl ? 2200 : 1500;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(`${baseUrl}/api/detect/mobile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        const json = await resp.json();
        cachedWorkingBaseUrl = baseUrl;
        const validEmotion =
          json.emotion && ['happy', 'surprise', 'neutral', 'sad', 'angry'].includes(json.emotion)
            ? (json.emotion as EmotionType)
            : null;
        return {
          detected: Boolean(json.detected),
          mood: (json.mood as MoodType) || null,
          emotion: validEmotion,
          emotionLabel: json.emotionLabel || null,
          confidence: Number(json.confidence || 0),
          faceBox:
            Array.isArray(json.faceBox) && json.faceBox.length === 4 ? json.faceBox : null,
          serverConnected: true,
          engine: 'remote-server',
        };
      }
    } catch {
      if (cachedWorkingBaseUrl === baseUrl) {
        cachedWorkingBaseUrl = null;
      }
    }
  }

  return {
    detected: false,
    mood: null,
    emotion: null,
    emotionLabel: null,
    confidence: 0,
    faceBox: null,
    serverConnected: false,
  };
}
