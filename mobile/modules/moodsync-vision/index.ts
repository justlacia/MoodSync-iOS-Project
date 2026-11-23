import {
  EventSubscription,
  NativeModule,
  requireNativeViewManager,
  requireOptionalNativeModule,
} from 'expo-modules-core';
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
  emotionScores?: Record<'happy' | 'surprise' | 'neutral' | 'sad' | 'angry', number> | null;
  faceBox: [number, number, number, number] | null;
  engine: string;
  serverConnected: boolean;
}

export interface NativeEngineInfo {
  available: boolean;
  engine: string;
  label: string;
}

export interface BiometricCapabilities {
  available: boolean;
  biometryType: 'faceID' | 'touchID' | 'opticID' | 'none';
  label: string;
  errorCode?: number;
}

export interface BiometricEnrollResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface BiometricAuthResult {
  success: boolean;
  token?: string;
  cancelled?: boolean;
  invalidated?: boolean;
  error?: string;
}

type MoodSyncVisionModuleEvents = {
  onRemoteTrackCommand: (event: { direction: 'next' | 'previous' }) => void;
};

declare class MoodSyncVisionNativeModule extends NativeModule<MoodSyncVisionModuleEvents> {
  getEngineInfo(): NativeEngineInfo;
  warmup(): Promise<boolean>;
  analyzeBase64Frame(base64Input: string, isFinalCapture: boolean): Promise<NativeVisionResult>;
  excludeAppDataFromBackup(): boolean;
  getBiometricCapabilities(): BiometricCapabilities;
  enrollBiometricToken(token: string, reason: string): Promise<BiometricEnrollResult>;
  authenticateBiometricToken(reason: string): Promise<BiometricAuthResult>;
  clearBiometricToken(): boolean;
  hasBiometricToken(): boolean;
  configureLockScreenSkipCommands(canPrev: boolean, canNext: boolean): void;
  clearLockScreenSkipCommands(): void;
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

export async function warmupVisionEngine(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }
  try {
    return await nativeModule.warmup();
  } catch {
    return false;
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

export function getBiometricCapabilities(): BiometricCapabilities {
  if (!nativeModule) {
    return { available: false, biometryType: 'none', label: 'Face ID' };
  }
  try {
    return nativeModule.getBiometricCapabilities();
  } catch {
    return { available: false, biometryType: 'none', label: 'Face ID' };
  }
}

export async function enrollBiometricToken(
  token: string,
  reason: string
): Promise<BiometricEnrollResult> {
  if (!nativeModule) {
    return {
      success: false,
      error: 'Biyometrik doğrulama yalnızca iOS cihazda kullanılabilir.',
    };
  }
  try {
    return await nativeModule.enrollBiometricToken(token, reason);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Face ID eşleştirmesi başarısız oldu.',
    };
  }
}

export async function authenticateBiometricToken(
  reason: string
): Promise<BiometricAuthResult> {
  if (!nativeModule) {
    return {
      success: false,
      error: 'Biyometrik doğrulama yalnızca iOS cihazda kullanılabilir.',
    };
  }
  try {
    return await nativeModule.authenticateBiometricToken(reason);
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Face ID doğrulaması başarısız oldu.',
    };
  }
}

export function clearBiometricToken(): boolean {
  try {
    return nativeModule ? nativeModule.clearBiometricToken() : false;
  } catch {
    return false;
  }
}

export function hasBiometricToken(): boolean {
  try {
    return nativeModule ? nativeModule.hasBiometricToken() : false;
  } catch {
    return false;
  }
}

export function configureLockScreenSkipCommands(canPrev: boolean, canNext: boolean): void {
  try {
    nativeModule?.configureLockScreenSkipCommands(canPrev, canNext);
  } catch {
    // Safe no-op outside native iOS build
  }
}

export function clearLockScreenSkipCommands(): void {
  try {
    nativeModule?.clearLockScreenSkipCommands();
  } catch {
    // Safe no-op outside native iOS build
  }
}

export function addRemoteTrackCommandListener(
  listener: (event: { direction: 'next' | 'previous' }) => void
): EventSubscription | null {
  if (!nativeModule) {
    return null;
  }
  try {
    return nativeModule.addListener('onRemoteTrackCommand', listener);
  } catch {
    return null;
  }
}
