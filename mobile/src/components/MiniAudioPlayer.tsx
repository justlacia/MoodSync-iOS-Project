import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TrackRecord } from '../database/iosDatabase';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { LiquidGlassSurface } from './LiquidGlassSurface';
import { SpringPressable } from './MotionPrimitives';

export interface MiniBarFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  track: TrackRecord | null;
  isPlaying: boolean;
  progressRatio: number;
  canPrevious: boolean;
  canNext: boolean;
  expandAnim: Animated.Value;
  barTopY: number;
  dockCatchSignal?: { tick: number; speed: number };
  onMeasureFrame?: (frame: MiniBarFrame) => void;
  onDragStart: () => void;
  onDragProgress: (progress: number) => void;
  onDragEnd: (target: 0 | 1, velocity?: number) => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export const MiniAudioPlayer: React.FC<Props> = ({
  track,
  isPlaying,
  progressRatio,
  canPrevious,
  canNext,
  expandAnim,
  barTopY,
  dockCatchSignal,
  onMeasureFrame,
  onDragStart,
  onDragProgress,
  onDragEnd,
  onTogglePlay,
  onPrevious,
  onNext,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const anchorRef = useRef<React.ComponentRef<typeof View>>(null);
  const slideY = useRef(new Animated.Value(28)).current;
  const dockCatchY = useRef(new Animated.Value(0)).current;
  const dockCatchScaleX = useRef(new Animated.Value(1)).current;
  const dockCatchScaleY = useRef(new Animated.Value(1)).current;
  const cardScale = useRef(new Animated.Value(0.94)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const hasShownRef = useRef(false);
  const hasTrackRef = useRef(Boolean(track));
  hasTrackRef.current = Boolean(track);
  const eqBars = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.85),
    new Animated.Value(0.5),
  ]).current;

  const barTopYRef = useRef(barTopY);
  barTopYRef.current = barTopY;
  const onMeasureFrameRef = useRef(onMeasureFrame);
  onMeasureFrameRef.current = onMeasureFrame;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragProgressRef = useRef(onDragProgress);
  onDragProgressRef.current = onDragProgress;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const measureBarFrame = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 100 && height > 30 && y > 80) {
        onMeasureFrameRef.current?.({ x, y, width, height });
      }
    });
  }, []);

  useEffect(() => {
    if (!track?.id) return;
    const rafId = requestAnimationFrame(() => {
      measureBarFrame();
    });
    return () => cancelAnimationFrame(rafId);
  }, [track?.id, measureBarFrame]);

  useEffect(() => {
    if (!dockCatchSignal || dockCatchSignal.tick <= 0 || !hasTrackRef.current) return;
    const s = Math.max(0, Math.min(1, dockCatchSignal.speed));
    Haptics.impactAsync(
      s > 0.55 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
    ).catch(() => {});

    dockCatchY.stopAnimation();
    dockCatchScaleX.stopAnimation();
    dockCatchScaleY.stopAnimation();

    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(dockCatchY, {
          toValue: 4 + s * 6,
          duration: 70,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(dockCatchScaleX, {
          toValue: 1 + 0.025 + s * 0.032,
          duration: 70,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(dockCatchScaleY, {
          toValue: 1 - (0.04 + s * 0.055),
          duration: 70,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(dockCatchY, {
          toValue: 0,
          damping: 12,
          stiffness: 280,
          mass: 0.68,
          useNativeDriver: true,
        }),
        Animated.spring(dockCatchScaleX, {
          toValue: 1,
          damping: 12,
          stiffness: 280,
          mass: 0.68,
          useNativeDriver: true,
        }),
        Animated.spring(dockCatchScaleY, {
          toValue: 1,
          damping: 12,
          stiffness: 280,
          mass: 0.68,
          useNativeDriver: true,
        }),
      ]),
    ]);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [dockCatchSignal, dockCatchScaleX, dockCatchScaleY, dockCatchY]);

  const dragLiftY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.25, 1],
        outputRange: [8, 0, -10, -14],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const dragScale = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.22, 1],
        outputRange: [0.98, 1, 0.97, 0.95],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const dragOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.03, 0.16, 1],
        outputRange: [1, 0.82, 0, 0],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const handleTapOpen = () => {
    Haptics.selectionAsync().catch(() => {});
    onDragStartRef.current();
    onDragEndRef.current(1, 4.4);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy < -6 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.15,
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        gs.dy < -6 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.15,
      onPanResponderGrant: () => {
        Haptics.selectionAsync().catch(() => {});
        onDragStartRef.current();
      },
      onPanResponderMove: (_, gs) => {
        const travel = Math.max(280, barTopYRef.current * 0.72);
        const progress =
          gs.dy <= 0
            ? Math.min(1.12, -gs.dy / travel)
            : -Math.min(0.05, (gs.dy / travel) * 0.35);
        onDragProgressRef.current(progress);
      },
      onPanResponderRelease: (_, gs) => {
        const travel = Math.max(280, barTopYRef.current * 0.72);
        const normVel = Math.min(9.5, (Math.abs(gs.vy) * 1000) / travel);
        const shouldOpen = -gs.dy > 95 || (-gs.dy > 32 && gs.vy < -0.48);
        onDragEndRef.current(shouldOpen ? 1 : 0, normVel);
      },
      onPanResponderTerminate: () => {
        onDragEndRef.current(0, 0);
      },
    })
  ).current;

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
      <View
        ref={anchorRef}
        onLayout={measureBarFrame}
        style={styles.wrapperAnchor}
        pointerEvents="box-none"
      >
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.wrapper,
            {
              opacity: dragOpacity,
              transform: [{ translateY: dragLiftY }, { scale: dragScale }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.wrapperInner,
              {
                transform: [
                  { translateY: Animated.add(slideY, dockCatchY) },
                  { scale: cardScale },
                  { scaleX: dockCatchScaleX },
                  { scaleY: dockCatchScaleY },
                ],
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

            {/* Subtle upward drag indicator pill */}
            <View pointerEvents="none" style={styles.grabberRow}>
              <View style={styles.grabberPill} />
            </View>

            <Animated.View style={[styles.row, { opacity: contentOpacity }]}>
          <Pressable onPress={handleTapOpen} style={styles.infoTapArea}>
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
          </Pressable>

          <View style={styles.controls}>
            <SpringPressable
              haptic
              scaleTo={0.88}
              disabled={!canPrevious}
              onPress={onPrevious}
              style={[styles.auxBtn, !canPrevious && { opacity: 0.32 }]}
              hitSlop={6}
            >
              <Ionicons name="play-skip-back" size={16} color={colors.inkPrimary} />
            </SpringPressable>
            <SpringPressable
              haptic
              scaleTo={0.88}
              onPress={onTogglePlay}
              style={styles.playBtn}
              hitSlop={6}
            >
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={15} color="#FFFFFF" />
            </SpringPressable>
            <SpringPressable
              haptic
              scaleTo={0.88}
              disabled={!canNext}
              onPress={onNext}
              style={[styles.auxBtn, !canNext && { opacity: 0.32 }]}
              hitSlop={6}
            >
              <Ionicons name="play-skip-forward" size={16} color={colors.inkPrimary} />
            </SpringPressable>
            <SpringPressable haptic scaleTo={0.88} onPress={onClose} style={styles.closeBtn} hitSlop={6}>
              <Ionicons name="close" size={16} color={colors.inkMuted} />
            </SpringPressable>
          </View>
        </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>
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
    wrapperAnchor: {
      width: '100%',
      maxWidth: 376,
      overflow: 'visible',
    },
    wrapper: {
      width: '100%',
      minHeight: 56,
      borderRadius: 28,
      backgroundColor: 'transparent',
      position: 'relative',
      overflow: 'visible',
    },
    wrapperInner: {
      width: '100%',
      minHeight: 56,
      borderRadius: 28,
      position: 'relative',
      overflow: 'visible',
    },
    grabberRow: {
      position: 'absolute',
      top: 5,
      left: 0,
      right: 0,
      alignItems: 'center',
      zIndex: 5,
    },
    grabberPill: {
      width: 30,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(24,29,37,0.22)',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingTop: 12,
      paddingBottom: 9,
      gap: 8,
    },
    infoTapArea: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      minWidth: 0,
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
      gap: 2,
    },
    playBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    auxBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBtn: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
