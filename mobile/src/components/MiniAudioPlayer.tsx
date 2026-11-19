import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { TrackRecord } from '../database/iosDatabase';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { LiquidGlassSurface } from './LiquidGlassSurface';
import { SpringPressable } from './MotionPrimitives';

interface Props {
  track: TrackRecord | null;
  isPlaying: boolean;
  progressRatio: number;
  onTogglePlay: () => void;
  onNext: () => void;
  onClose: () => void;
}

export const MiniAudioPlayer: React.FC<Props> = ({
  track,
  isPlaying,
  progressRatio,
  onTogglePlay,
  onNext,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const slideY = useRef(new Animated.Value(28)).current;
  const cardScale = useRef(new Animated.Value(0.94)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const hasShownRef = useRef(false);
  const eqBars = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.85),
    new Animated.Value(0.5),
  ]).current;

  useEffect(() => {
    if (!track) {
      hasShownRef.current = false;
      return;
    }

    if (!hasShownRef.current) {
      hasShownRef.current = true;
      slideY.setValue(28);
      cardScale.setValue(0.94);
      contentOpacity.setValue(1);
      Animated.parallel([
        Animated.spring(slideY, {
          toValue: 0,
          damping: 18,
          stiffness: 190,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          damping: 18,
          stiffness: 200,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    contentOpacity.setValue(0.6);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [track?.id, cardScale, contentOpacity, slideY]);

  useEffect(() => {
    if (!isPlaying || !track) {
      eqBars.forEach((bar) => {
        Animated.timing(bar, {
          toValue: 0.3,
          duration: 180,
          useNativeDriver: true,
        }).start();
      });
      return;
    }

    const loops = eqBars.map((bar, idx) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: 300 + idx * 95,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(bar, {
            toValue: 0.25,
            duration: 300 + idx * 95,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [eqBars, isPlaying, track]);

  if (!track) return null;

  return (
    <View style={styles.outerDock} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.wrapper,
          {
            transform: [{ translateY: slideY }, { scale: cardScale }],
          },
        ]}
      >
        <LiquidGlassSurface
          glassStyle="regular"
          capsule
          interactive
          isDark={isDark}
          showShadow
        />

        <Animated.View style={[styles.row, { opacity: contentOpacity }]}>
          {track.artworkUrl ? (
            <Image source={{ uri: track.artworkUrl }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <Ionicons name="musical-notes" size={17} color={colors.brand} />
            </View>
          )}

          <View style={styles.info}>
            <View style={styles.titleRow}>
              {isPlaying && (
                <View style={styles.eqWrap}>
                  {eqBars.map((bar, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.eqBar,
                        {
                          backgroundColor: colors.brand,
                          transform: [{ scaleY: bar }],
                        },
                      ]}
                    />
                  ))}
                </View>
              )}
              <Text numberOfLines={1} style={styles.title}>
                {track.title}
              </Text>
            </View>
            <Text numberOfLines={1} style={styles.artist}>
              {track.artist}
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, Math.max(2, progressRatio * 100))}%` },
                ]}
              />
            </View>
          </View>

          <View style={styles.controls}>
            <SpringPressable
              haptic
              scaleTo={0.88}
              onPress={onTogglePlay}
              style={styles.playBtn}
              hitSlop={8}
            >
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" />
            </SpringPressable>
            <SpringPressable haptic scaleTo={0.88} onPress={onNext} style={styles.auxBtn} hitSlop={8}>
              <Ionicons name="play-skip-forward" size={18} color={colors.inkPrimary} />
            </SpringPressable>
            <SpringPressable haptic scaleTo={0.88} onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={17} color={colors.inkMuted} />
            </SpringPressable>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    outerDock: {
      width: '100%',
      paddingHorizontal: 20,
      marginBottom: -3,
      alignItems: 'center',
      overflow: 'visible',
    },
    wrapper: {
      width: '100%',
      maxWidth: 376,
      minHeight: 56,
      borderRadius: 28,
      backgroundColor: 'transparent',
      position: 'relative',
      overflow: 'visible',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 10,
      gap: 10,
    },
    cover: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.subtle,
    },
    coverFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    info: {
      flex: 1,
      minWidth: 0,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    eqWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      height: 13,
    },
    eqBar: {
      width: 2.5,
      height: 12,
      borderRadius: 1.5,
    },
    title: {
      flex: 1,
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    artist: {
      fontSize: 11.5,
      color: colors.inkSecondary,
      marginTop: 1,
    },
    progressTrack: {
      height: 2.5,
      borderRadius: 999,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(24,29,37,0.12)',
      width: '100%',
      marginTop: 4,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.brand,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    playBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    auxBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
