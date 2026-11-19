import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeVisionResult {
  detected: boolean;
  mood: 'positive' | 'neutral' | 'negative' | null;
  emotion: 'happy' | 'surprise' | 'neutral' | 'sad' | 'angry' | null;
  emotionLabel: string | null;
  confidence: number;
  faceBox: [number, number, number, number] | null;
  engine: string;
  serverConnected: boolean;
}

export interface NativeEngineInfo {
  available: boolean;
  engine: string;
  label: string;
}

interface MoodSyncVisionNativeModule {
  getEngineInfo(): NativeEngineInfo;
  analyzeBase64Frame(base64Input: string, isFinalCapture: boolean): Promise<NativeVisionResult>;
  excludeAppDataFromBackup(): boolean;
}

const nativeModule = requireOptionalNativeModule<MoodSyncVisionNativeModule>('MoodSyncVision');

export function excludeAppDataFromBackup(): void {
  try {
    nativeModule?.excludeAppDataFromBackup();
  } catch {
    // Safe no-op outside native iOS build
  }
}

export function isNativeVisionAvailable(): boolean {
  return nativeModule !== null;
}

export function getNativeEngineInfo(): NativeEngineInfo {
  if (!nativeModule) {
    return {
      available: false,
      engine: 'none',
      label: 'Native iOS Modülü Yüklü Değil (Xcode Build Gerekli)',
    };
  }
  try {
    return nativeModule.getEngineInfo();
  } catch {
    return {
      available: true,
      engine: 'apple-vision',
      label: 'Apple Vision · On-Device Yüz Analizi',
    };
  }
}

export async function analyzeFrameOnDevice(
  base64Jpeg: string,
  isFinalCapture = false
): Promise<NativeVisionResult | null> {
  if (!nativeModule) {
    return null;
  }
  return nativeModule.analyzeBase64Frame(base64Jpeg, isFinalCapture);
}
