import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type * as React from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';

export interface MoodSyncGlassViewProps {
  glassStyle?: 'regular' | 'clear';
  isDark?: boolean;
  interactive?: boolean;
  glassTintColor?: string | null;
  capsule?: boolean;
  cornerRadius?: number;
  showShadow?: boolean;
  pointerEvents?: 'none' | 'auto' | 'box-none' | 'box-only';
  style?: StyleProp<ViewStyle>;
}

let resolvedNativeGlassView: React.ComponentType<MoodSyncGlassViewProps> | null = null;
if (
  Platform.OS === 'ios' &&
  typeof (globalThis as any).expo?.getViewConfig === 'function'
) {
  try {
    if ((globalThis as any).expo.getViewConfig('MoodSyncVision', 'MoodSyncGlassView')) {
      resolvedNativeGlassView = requireNativeViewManager<MoodSyncGlassViewProps>(
        'MoodSyncVision',
        'MoodSyncGlassView'
      );
    } else if ((globalThis as any).expo.getViewConfig('MoodSyncVision')) {
      resolvedNativeGlassView =
        requireNativeViewManager<MoodSyncGlassViewProps>('MoodSyncVision');
    }
  } catch {
    resolvedNativeGlassView = null;
  }
}

export const NativeMoodSyncGlassView = resolvedNativeGlassView;

export interface NativeTabItemConfig {
  key: string;
  label: string;
  sfSymbol: string;
  activeSfSymbol: string;
  showBadgeDot?: boolean;
}

export interface MoodSyncLiquidTabBarProps {
  tabs: NativeTabItemConfig[];
  activeTab: string;
  isDark: boolean;
  accentColor: string;
  onSelectTab?: (event: { nativeEvent: { key: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

let resolvedNativeLiquidTabBar: React.ComponentType<MoodSyncLiquidTabBarProps> | null = null;
if (
  Platform.OS === 'ios' &&
  typeof (globalThis as any).expo?.getViewConfig === 'function' &&
  Boolean((globalThis as any).expo.getViewConfig('MoodSyncVision', 'MoodSyncLiquidTabBarView'))
) {
  try {
    resolvedNativeLiquidTabBar = requireNativeViewManager<MoodSyncLiquidTabBarProps>(
      'MoodSyncVision',
      'MoodSyncLiquidTabBarView'
    );
  } catch {
    resolvedNativeLiquidTabBar = null;
  }
}

export const NativeMoodSyncLiquidTabBar = resolvedNativeLiquidTabBar;

export function isNativeLiquidGlassAvailable(): boolean {
  return NativeMoodSyncGlassView !== null;
}

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
