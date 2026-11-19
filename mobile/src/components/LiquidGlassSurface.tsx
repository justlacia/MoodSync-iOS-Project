import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { NativeMoodSyncGlassView } from '../../modules/moodsync-vision';

interface LiquidGlassSurfaceProps {
  glassStyle?: 'regular' | 'clear';
  isDark: boolean;
  interactive?: boolean;
  glassTintColor?: string | null;
  capsule?: boolean;
  cornerRadius?: number;
  showShadow?: boolean;
  rimHighlight?: boolean;
  shimmerOffset?: Animated.Value;
  style?: StyleProp<ViewStyle>;
}

export const LiquidGlassSurface: React.FC<LiquidGlassSurfaceProps> = ({
  glassStyle = 'regular',
  isDark,
  interactive = true,
  glassTintColor = null,
  capsule = true,
  cornerRadius = 24,
  showShadow = true,
  rimHighlight = false,
  shimmerOffset,
  style,
}) => {
  const effectiveRadius = capsule ? 999 : cornerRadius;

  const prismaticColors: readonly [string, string, string] = isDark
    ? ['rgba(120, 220, 255, 0.22)', 'rgba(255, 255, 255, 0.04)', 'rgba(255, 130, 90, 0.16)']
    : ['rgba(120, 200, 255, 0.28)', 'rgba(255, 255, 255, 0.08)', 'rgba(255, 150, 110, 0.22)'];

  if (NativeMoodSyncGlassView) {
    if (!rimHighlight) {
      return (
        <NativeMoodSyncGlassView
          glassStyle={glassStyle}
          isDark={isDark}
          interactive={interactive}
          glassTintColor={glassTintColor}
          capsule={capsule}
          cornerRadius={cornerRadius}
          showShadow={showShadow}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, style]}
        />
      );
    }

    return (
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: effectiveRadius, overflow: 'visible' },
          style,
        ]}
      >
        <NativeMoodSyncGlassView
          glassStyle={glassStyle}
          isDark={isDark}
          interactive={interactive}
          glassTintColor={glassTintColor}
          capsule={capsule}
          cornerRadius={cornerRadius}
          showShadow={showShadow}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: effectiveRadius,
              overflow: 'hidden',
              borderTopWidth: 0.75,
              borderTopColor: 'rgba(255, 255, 255, 0.28)',
            },
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              shimmerOffset ? { transform: [{ translateX: shimmerOffset }] } : null,
            ]}
          >
            <LinearGradient
              colors={prismaticColors}
              start={{ x: 0.08, y: 0 }}
              end={{ x: 0.92, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </View>
    );
  }

  const fallbackBg =
    glassStyle === 'clear'
      ? isDark
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(255, 255, 255, 0.45)'
      : isDark
        ? 'rgba(20, 22, 27, 0.84)'
        : 'rgba(255, 255, 255, 0.86)';

  const gradColors: readonly [string, string, string] =
    glassStyle === 'clear'
      ? isDark
        ? ['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0.12)']
        : ['rgba(255,255,255,0.72)', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.52)']
      : isDark
        ? ['rgba(255,255,255,0.11)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0.06)']
        : ['rgba(255,255,255,0.68)', 'rgba(255,255,255,0.34)', 'rgba(255,255,255,0.58)'];

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: effectiveRadius,
          backgroundColor: fallbackBg,
          overflow: 'hidden',
          borderWidth: rimHighlight ? 1.1 : 0.75,
          borderColor: rimHighlight
            ? isDark
              ? 'rgba(255, 255, 255, 0.32)'
              : 'rgba(255, 255, 255, 0.86)'
            : isDark
              ? 'rgba(255, 255, 255, 0.14)'
              : 'rgba(24, 29, 37, 0.10)',
        },
        style,
      ]}
    >
      <LinearGradient
        colors={gradColors}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {rimHighlight && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            shimmerOffset ? { transform: [{ translateX: shimmerOffset }] } : null,
          ]}
        >
          <LinearGradient
            colors={prismaticColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
};
