import Constants from 'expo-constants';
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
}

let cachedWorkingBaseUrl: string | null = null;

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
    // 1. Primary: Metro built-in /api/* proxy on the EXACT host:port (or tunnel) Expo Go is connected to!
    const isTunnel =
      hostUri.includes('exp.direct') ||
      hostUri.includes('ngrok') ||
      hostUri.includes('trycloudflare');
    pushUnique(`${isTunnel ? 'https' : 'http'}://${hostUri}`);

    // 2. Direct FastAPI port 8000 on the same LAN host
    const hostOnly = hostUri.split(':')[0];
    if (hostOnly && !isTunnel) {
      pushUnique(`http://${hostOnly}:8000`);
    }
  }

  // 3. All LAN IPv4 addresses written by start_ios.py at launch
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
 * Shared HTTP client that connects to the MoodSync PC server inside MoodSync-iOS-Project
 * (via Metro's port-8081 reverse proxy or direct port-8000 LAN endpoint).
 */
export async function pcServerFetch<T = any>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: any;
    token?: string | null;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const custom = await getSetting('ai_server_url');
  const candidates = getCandidateServerUrls(custom);
  const authToken = options.token !== undefined ? options.token : await getSetting('auth_token');
  const method = options.method || 'GET';
  const timeoutMs = options.timeoutMs || 9000;

  let lastHttpError: Error | null = null;

  for (const baseUrl of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const resp = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 502 / 504 means Metro proxy could not reach Python on 127.0.0.1:8000 yet — try next candidate
      if (resp.status === 502 || resp.status === 504) {
        if (cachedWorkingBaseUrl === baseUrl) {
          cachedWorkingBaseUrl = null;
        }
        continue;
      }

      cachedWorkingBaseUrl = baseUrl;
      const text = await resp.text();
      let parsed: any = {};
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { detail: text };
        }
      }

      if (!resp.ok) {
        const msg = parsed?.detail || parsed?.error || `Sunucu hatası (${resp.status})`;
        const err: any = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        err.status = resp.status;
        throw err;
      }

      return parsed as T;
    } catch (err: any) {
      if (err?.status && err.status >= 400 && err.status < 500) {
        // Explicit application-level response (400 / 401 / 404 / 422) — surface immediately
        throw err;
      }
      lastHttpError = err;
      if (cachedWorkingBaseUrl === baseUrl) {
        cachedWorkingBaseUrl = null;
      }
    }
  }

  throw (
    lastHttpError ||
    new Error(
      'Bilgisayarınızdaki MoodSync sunucusuna ulaşılamadı. Bilgisayarda start_ios.bat penceresinin açık olduğundan emin olun.'
    )
  );
}

/**
 * Sends a base64 JPEG camera frame to the YOLOv8 + AffectNet 7-emotion engine
 * via Metro's port-8081 proxy or direct port-8000 LAN endpoint.
 */
export async function analyzeCameraFrame(
  base64Jpeg: string,
  isFinalCapture = false
): Promise<LiveDetectionResult> {
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
