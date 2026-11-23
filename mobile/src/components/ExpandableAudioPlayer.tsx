import { Ionicons } from '@expo/vector-icons';
import { AudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrackRecord } from '../database/iosDatabase';
import {
  buildAppleMusicUrl,
  buildSpotifySearchUrl,
  buildYoutubeMusicUrl,
} from '../services/onlineMusicService';
import { resolveMoodVisual, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { LiquidGlassSurface } from './LiquidGlassSurface';
import { SpringPressable } from './MotionPrimitives';

export interface MiniBarFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExpandableAudioPlayerHandle {
  collapse: (velocity?: number) => void;
  closeImmediate: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ART_SIZE = 256;
const MINI_ART_SIZE = 38;

interface Props {
  miniBarFrame: MiniBarFrame;
  player: AudioPlayer;
  queue: TrackRecord[];
  queueIdx: number;
  isPlaying: boolean;
  repeatOne: boolean;
  onStopAndDismiss: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onToggleRepeatOne: () => void;
  onSelectQueueIndex: (index: number) => void;
  onToggleFavorite: (trackId: number) => void;
  onAddToPlaylist: (track: TrackRecord) => void;
  onDislike: (track: TrackRecord) => void;
}

function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

interface MiniProgressBarProps {
  player: AudioPlayer;
  styles: ReturnType<typeof createStyles>;
}

const MiniProgressBar: React.FC<MiniProgressBarProps> = React.memo(({ player, styles }) => {
  const status = useAudioPlayerStatus(player);
  const duration = status.duration && status.duration > 0 ? status.duration : 30;
  const ratio = status.currentTime ? Math.max(0, Math.min(1, status.currentTime / duration)) : 0;
  return (
    <View style={styles.miniProgressTrack}>
      <View
        style={[
          styles.miniProgressFill,
          { width: `${Math.min(100, Math.max(2, ratio * 100))}%` },
        ]}
      />
    </View>
  );
});

interface FullScrubberProps {
  player: AudioPlayer;
  active: boolean;
  isScrubbingRef: React.MutableRefObject<boolean>;
  onSeek: (seconds: number) => void;
  styles: ReturnType<typeof createStyles>;
}

const FullScrubber: React.FC<FullScrubberProps> = React.memo(
  ({ player, active, isScrubbingRef, onSeek, styles }) => {
    const status = useAudioPlayerStatus(player);
    const [draggingRatio, setDraggingRatio] = useState<number | null>(null);
    const barWidthRef = useRef(280);
    const grantXRef = useRef(0);
    const dragRatioRef = useRef<number | null>(null);

    const effectiveDuration = status.duration && status.duration > 0 ? status.duration : 30;
    const durationRef = useRef(effectiveDuration);
    durationRef.current = effectiveDuration;
    const onSeekRef = useRef(onSeek);
    onSeekRef.current = onSeek;

    useEffect(() => {
      if (!active) {
        dragRatioRef.current = null;
        setDraggingRatio(null);
      }
    }, [active]);

    const scrubberPanResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          isScrubbingRef.current = true;
          const w = Math.max(1, barWidthRef.current);
          grantXRef.current = evt.nativeEvent.locationX;
          const ratio = Math.max(0, Math.min(1, grantXRef.current / w));
          dragRatioRef.current = ratio;
          setDraggingRatio(ratio);
          Haptics.selectionAsync().catch(() => {});
        },
        onPanResponderMove: (_, gestureState) => {
          const w = Math.max(1, barWidthRef.current);
          const ratio = Math.max(0, Math.min(1, (grantXRef.current + gestureState.dx) / w));
          dragRatioRef.current = ratio;
          setDraggingRatio(ratio);
        },
        onPanResponderRelease: () => {
          isScrubbingRef.current = false;
          const finalRatio = dragRatioRef.current;
          dragRatioRef.current = null;
          setDraggingRatio(null);
          if (finalRatio !== null) {
            onSeekRef.current(finalRatio * durationRef.current);
          }
        },
        onPanResponderTerminate: () => {
          isScrubbingRef.current = false;
          dragRatioRef.current = null;
          setDraggingRatio(null);
        },
      })
    ).current;

    const liveTime = Number(status.currentTime || 0);
    const liveRatio = Math.max(0, Math.min(1, liveTime / effectiveDuration));
    const shownRatio = draggingRatio !== null ? draggingRatio : liveRatio;
    const shownSeconds = shownRatio * effectiveDuration;

    return (
      <View style={styles.scrubberWrap}>
        <View
          style={styles.scrubberTouchArea}
          onLayout={(e) => {
            barWidthRef.current = e.nativeEvent.layout.width;
          }}
          {...scrubberPanResponder.panHandlers}
        >
          <View pointerEvents="none" style={styles.scrubberTrack}>
            <View
              style={[
                styles.scrubberFill,
                { width: `${Math.round(shownRatio * 1000) / 10}%` },
              ]}
            />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.scrubberThumb,
              { left: `${Math.round(shownRatio * 1000) / 10}%` },
            ]}
          />
        </View>

        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>{formatClock(shownSeconds)}</Text>
          <Text style={styles.timeLabel}>{formatClock(effectiveDuration)}</Text>
        </View>
      </View>
    );
  }
);

export const ExpandableAudioPlayer = React.memo(
  React.forwardRef<ExpandableAudioPlayerHandle, Props>(
    (
      {
        miniBarFrame,
        player,
        queue,
        queueIdx,
        isPlaying,
        repeatOne,
        onStopAndDismiss,
        onTogglePlay,
        onPrevious,
        onNext,
        onSeek,
        onToggleRepeatOne,
        onSelectQueueIndex,
        onToggleFavorite,
        onAddToPlaylist,
        onDislike,
      },
      ref
    ) => {
      const { colors, isDark } = useTheme();
      const styles = useMemo(() => createStyles(colors), [colors]);
      const insets = useSafeAreaInsets();

      // Self-contained animation driver & post-settle interaction flag (zero mid-flight re-renders)
      const expandAnim = useRef(new Animated.Value(0)).current;
      const [sheetActive, setSheetActive] = useState(false);
      const sheetActiveRef = useRef(false);
      sheetActiveRef.current = sheetActive;
      const sheetTargetRef = useRef<0 | 1>(0);
      const isSheetOpenRef = useRef(false);
      const isAnimatingRef = useRef(false);
      const isDraggingRef = useRef(false);
      const hasMovedInDragRef = useRef(false);
      const shouldDockCatchRef = useRef(false);
      const closingSpeedRef = useRef(0);
      const currentProgressRef = useRef(0);
      const dragOriginProgressRef = useRef(0);
      const dragStartDyRef = useRef<number | null>(null);
      const lastSentProgressRef = useRef(0);
      const velSamplesRef = useRef<Array<{ t: number; p: number }>>([]);

      const [showQueue, setShowQueue] = useState(false);
      const [fullArtCenter, setFullArtCenter] = useState<{ x: number; y: number }>({
        x: SCREEN_WIDTH / 2,
        y: Math.round(SCREEN_HEIGHT * 0.31),
      });

      const fullContentRef = useRef<React.ComponentRef<typeof View>>(null);
      const artSlotRef = useRef<React.ComponentRef<typeof View>>(null);
      const hasMeasuredArtSlotRef = useRef(false);
      const isScrubbingRef = useRef(false);
      const showQueueRef = useRef(false);
      showQueueRef.current = showQueue;
      const queueScrollYRef = useRef(0);

      const track = queueIdx >= 0 && queueIdx < queue.length ? queue[queueIdx] : null;
      const hasTrackRef = useRef(Boolean(track));
      hasTrackRef.current = Boolean(track);

      // Compute mood visual before early return to respect Rules of Hooks
      const moodMeta = useMemo(
        () => resolveMoodVisual(track?.mood ?? 'neutral', null, colors),
        [colors, track?.mood]
      );
      const moodGradientColors = useMemo(
        () => [moodMeta.softColor, 'transparent'] as const,
        [moodMeta.softColor]
      );

      // Mini bar entry / equalizer / dock-catch animations (all native driver)
      const entryY = useRef(new Animated.Value(28)).current;
      const entryScale = useRef(new Animated.Value(0.94)).current;
      const miniContentOpacity = useRef(new Animated.Value(1)).current;
      const hasShownRef = useRef(false);

      const dockCatchY = useRef(new Animated.Value(0)).current;
      const dockCatchScaleX = useRef(new Animated.Value(1)).current;
      const dockCatchScaleY = useRef(new Animated.Value(1)).current;

      const eqBars = useRef([
        new Animated.Value(0.35),
        new Animated.Value(0.85),
        new Animated.Value(0.5),
      ]).current;

      // Expanded artwork breathe animation (all native driver; zero halo glow)
      const artScale = useRef(new Animated.Value(1)).current;
      const lastArtScaleTargetRef = useRef(1);

      const barLeft = Math.max(0, miniBarFrame.x);
      const barTop = Math.max(120, miniBarFrame.y);
      const barWidth = Math.max(240, Math.min(SCREEN_WIDTH, miniBarFrame.width));
      const barHeight = Math.max(56, miniBarFrame.height);
      const barBottomInset = Math.max(0, SCREEN_HEIGHT - (barTop + barHeight));
      const glassRadius = Math.min(31, Math.round(barHeight / 2));

      const barTopRef = useRef(barTop);
      barTopRef.current = barTop;

      const runDockCatch = useCallback(
        (speedFactor: number) => {
          if (!hasTrackRef.current) return;
          const s = Math.max(0, Math.min(1, speedFactor));
          Haptics.impactAsync(
            s > 0.55 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
          ).catch(() => {});

          dockCatchY.stopAnimation();
          dockCatchScaleX.stopAnimation();
          dockCatchScaleY.stopAnimation();

          Animated.sequence([
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
          ]).start();
        },
        [dockCatchScaleX, dockCatchScaleY, dockCatchY]
      );

      const animateTo = useCallback(
        (target: 0 | 1, signedVelPPerSec = 0) => {
          isDraggingRef.current = false;
          sheetTargetRef.current = target;
          isAnimatingRef.current = true;

          const velMag = Math.max(0, Math.min(12.0, Math.abs(signedVelPPerSec)));
          const speedFactor = Math.min(1, velMag / 4.2);

          let springConfig: Animated.SpringAnimationConfig;
          if (target === 1) {
            const wasOpen = isSheetOpenRef.current;
            isSheetOpenRef.current = true;
            shouldDockCatchRef.current = false;
            if (!wasOpen) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }

            const mass = 0.78 - speedFactor * 0.14;
            const stiffness = 340 + speedFactor * 220;
            const zeta = 0.86 + speedFactor * 0.04;
            const damping = 2 * Math.sqrt(stiffness * mass) * zeta;
            springConfig = {
              toValue: 1,
              velocity: Math.max(2.4, Math.min(12.0, velMag * 1.25)),
              stiffness,
              damping,
              mass,
              restDisplacementThreshold: 0.001,
              restSpeedThreshold: 0.01,
              useNativeDriver: true,
            };
          } else {
            const shouldCatch = isSheetOpenRef.current || currentProgressRef.current > 0.30;
            isSheetOpenRef.current = false;
            shouldDockCatchRef.current = shouldCatch;
            closingSpeedRef.current = speedFactor;

            const mass = 0.78 - speedFactor * 0.14;
            const stiffness = 320 + speedFactor * 210;
            const zeta = 0.88 + speedFactor * 0.05;
            const damping = 2 * Math.sqrt(stiffness * mass) * zeta;
            springConfig = {
              toValue: 0,
              velocity: -Math.max(2.0, Math.min(12.0, velMag * 1.15)),
              stiffness,
              damping,
              mass,
              restDisplacementThreshold: 0.001,
              restSpeedThreshold: 0.01,
              useNativeDriver: true,
            };
          }

          expandAnim.stopAnimation();
          Animated.spring(expandAnim, springConfig).start(({ finished }) => {
            if (!finished || isDraggingRef.current) return;
            isAnimatingRef.current = false;
            expandAnim.setValue(target);
            currentProgressRef.current = target;

            if (target === 1 && !sheetActiveRef.current) {
              sheetActiveRef.current = true;
              setSheetActive(true);
            } else if (target === 0 && sheetActiveRef.current) {
              sheetActiveRef.current = false;
              setSheetActive(false);
            }

            if (target === 0 && shouldDockCatchRef.current) {
              shouldDockCatchRef.current = false;
              runDockCatch(closingSpeedRef.current);
            }
          });
        },
        [expandAnim, runDockCatch]
      );

      const animateToRef = useRef(animateTo);
      animateToRef.current = animateTo;

      useImperativeHandle(
        ref,
        () => ({
          collapse: (velocity = 2.2) => {
            animateTo(0, -Math.abs(velocity));
          },
          closeImmediate: () => {
            isDraggingRef.current = false;
            isAnimatingRef.current = false;
            isSheetOpenRef.current = false;
            shouldDockCatchRef.current = false;
            sheetTargetRef.current = 0;
            currentProgressRef.current = 0;
            expandAnim.stopAnimation();
            expandAnim.setValue(0);
            dockCatchY.stopAnimation();
            dockCatchScaleX.stopAnimation();
            dockCatchScaleY.stopAnimation();
            dockCatchY.setValue(0);
            dockCatchScaleX.setValue(1);
            dockCatchScaleY.setValue(1);
            if (sheetActiveRef.current) {
              sheetActiveRef.current = false;
              setSheetActive(false);
            }
          },
        }),
        [animateTo, dockCatchScaleX, dockCatchScaleY, dockCatchY, expandAnim]
      );

      // Track live progress & fire dock-catch bounce at exact visual dock touchdown
      useEffect(() => {
        const id = expandAnim.addListener(({ value }) => {
          currentProgressRef.current = value;
          if (
            !isDraggingRef.current &&
            isAnimatingRef.current &&
            sheetTargetRef.current === 0 &&
            shouldDockCatchRef.current &&
            value <= 0.045
          ) {
            shouldDockCatchRef.current = false;
            runDockCatch(closingSpeedRef.current);
          }
        });
        return () => {
          expandAnim.removeListener(id);
        };
      }, [expandAnim, runDockCatch]);

      useEffect(() => {
        hasMeasuredArtSlotRef.current = false;
      }, [insets.bottom, insets.top]);

      // Measure vertical artwork landing Y once per session (scaleX-invariant horizontal center)
      const measureArtSlot = useCallback(() => {
        if (hasMeasuredArtSlotRef.current) return;
        fullContentRef.current?.measureInWindow((_fx, fy, fw) => {
          if (fw < 200) return;
          artSlotRef.current?.measureInWindow((_ax, ay, aw, ah) => {
            if (aw > 100 && ah > 100) {
              hasMeasuredArtSlotRef.current = true;
              const relCenterX = SCREEN_WIDTH / 2;
              const relCenterY = ay - fy + ah / 2;
              setFullArtCenter((prev) =>
                Math.abs(prev.x - relCenterX) < 1 && Math.abs(prev.y - relCenterY) < 1
                  ? prev
                  : { x: relCenterX, y: relCenterY }
              );
            }
          });
        });
      }, []);

      useEffect(() => {
        if (!track?.id) {
          hasMeasuredArtSlotRef.current = false;
          return;
        }
        const rafId = requestAnimationFrame(() => {
          measureArtSlot();
        });
        return () => cancelAnimationFrame(rafId);
      }, [track?.id, measureArtSlot]);

      useEffect(() => {
        if (!sheetActive) {
          setShowQueue(false);
          isScrubbingRef.current = false;
          queueScrollYRef.current = 0;
        }
      }, [sheetActive]);

      // Keep thumbnail 1:1 when collapsed; subtly breathe between paused/playing when expanded
      useEffect(() => {
        const targetScale = !sheetActive || isPlaying ? 1 : 0.92;
        if (lastArtScaleTargetRef.current === targetScale) return;
        lastArtScaleTargetRef.current = targetScale;
        Animated.spring(artScale, {
          toValue: targetScale,
          damping: 16,
          stiffness: 180,
          useNativeDriver: true,
        }).start();
      }, [artScale, isPlaying, sheetActive]);

      // Mini bar entrance / track-switch crossfade
      useEffect(() => {
        if (!track) {
          hasShownRef.current = false;
          return;
        }

        if (!hasShownRef.current) {
          hasShownRef.current = true;
          entryY.setValue(28);
          entryScale.setValue(0.94);
          miniContentOpacity.setValue(1);
          Animated.parallel([
            Animated.spring(entryY, {
              toValue: 0,
              damping: 18,
              stiffness: 190,
              useNativeDriver: true,
            }),
            Animated.spring(entryScale, {
              toValue: 1,
              damping: 18,
              stiffness: 200,
              useNativeDriver: true,
            }),
          ]).start();
          return;
        }

        miniContentOpacity.setValue(0.6);
        Animated.timing(miniContentOpacity, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, [track?.id, entryScale, entryY, miniContentOpacity]);

      // Equalizer bars (paused when expanded so hidden bars don't burn frames)
      useEffect(() => {
        if (!isPlaying || !track || sheetActive) {
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
      }, [eqBars, isPlaying, sheetActive, track]);

      // ── 100% GPU Native-Driver Clip Window Bounds (ZERO Yoga layout mutations) ──
      const minScaleX = barWidth / SCREEN_WIDTH;
      const barCenterOffsetX = barLeft - (SCREEN_WIDTH - barWidth) / 2;
      const shellRange = useMemo(() => [-0.05, 0, 0.28, 0.85, 1], []);

      const clipBottomY = useMemo(
        () =>
          expandAnim.interpolate({
            inputRange: shellRange,
            outputRange: [
              -Math.max(0, barBottomInset - 4),
              -barBottomInset,
              -Math.round(barBottomInset * 0.58),
              0,
              0,
            ],
            extrapolate: 'clamp',
          }),
        [barBottomInset, expandAnim, shellRange]
      );

      const innerTopY = useMemo(
        () =>
          expandAnim.interpolate({
            inputRange: shellRange,
            outputRange: [
              barTop + 6 + Math.max(0, barBottomInset - 4),
              barTop + barBottomInset,
              Math.round(barTop * 0.72) + Math.round(barBottomInset * 0.58),
              Math.round(barTop * 0.15),
              0,
            ],
            extrapolate: 'clamp',
          }),
        [barBottomInset, barTop, expandAnim, shellRange]
      );

      const shellScaleX = useMemo(
        () =>
          expandAnim.interpolate({
            inputRange: shellRange,
            outputRange: [minScaleX * 0.985, minScaleX, minScaleX + (1 - minScaleX) * 0.52, 1, 1],
            extrapolate: 'clamp',
          }),
        [expandAnim, minScaleX, shellRange]
      );

      const shellTranslateX = useMemo(
        () =>
          expandAnim.interpolate({
            inputRange: [0, 0.85, 1],
            outputRange: [barCenterOffsetX, 0, 0],
            extrapolate: 'clamp',
          }),
        [barCenterOffsetX, expandAnim]
      );

      const sheetWindowOpacity = useMemo(
        () =>
          expandAnim.interpolate({
            inputRange: [0, 0.015, 0.08, 1],
            outputRange: [0, 0.65, 1, 1],
            extrapolate: 'clamp',
          }),
        [expandAnim]
      );

      const miniGlassOpacity = useMemo(
        () =>
          expandAnim.interpolate({
            inputRange: [0, 0.02, 0.14, 1],
            outputRange: [1, 0.92, 0, 0],
            extrapolate: 'clamp',
          }),
        [expandAnim]
      );

  // ── Unified Top Grabber & Mood Wash Inside Liquid Glass Shell ──
  const grabberY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.68, 1],
        outputRange: [5, Math.max(8, insets.top * 0.42), insets.top + 8],
        extrapolate: 'clamp',
      }),
    [expandAnim, insets.top]
  );

  const grabberScaleX = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.33],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const moodBackdropOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.08, 0.52, 1],
        outputRange: isDark ? [0, 0, 0.84, 0.94] : [0, 0, 0.86, 0.95],
        extrapolate: 'clamp',
      }),
    [expandAnim, isDark]
  );

  const backdropOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.16, 0.55, 1],
        outputRange: isDark ? [0, 0, 0.28, 0.56] : [0, 0, 0.16, 0.36],
        extrapolate: 'clamp',
      }),
    [expandAnim, isDark]
  );

  // ── Shared Single Hero Album Artwork Morph in Direct Screen Coordinates ──
  const tx0 = barLeft + 10 + MINI_ART_SIZE / 2 - ART_SIZE / 2;
  const ty0 = barTop + (barHeight + 3) / 2 - ART_SIZE / 2;
  const tx1 = fullArtCenter.x - ART_SIZE / 2;
  const ty1 = fullArtCenter.y - ART_SIZE / 2;
  const txMid = tx0 + (tx1 - tx0) * 0.52;
  const tyMid = ty0 + (ty1 - ty0) * 0.45;
  const heroMinScale = MINI_ART_SIZE / ART_SIZE;

  const heroTranslateX = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.35, 1, 1.06],
        outputRange: [tx0, tx0, txMid, tx1, tx1],
        extrapolate: 'clamp',
      }),
    [expandAnim, tx0, tx1, txMid]
  );

  const heroTranslateY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.35, 1, 1.06],
        outputRange: [ty0 + 3, ty0, tyMid, ty1, ty1 - 3],
        extrapolate: 'clamp',
      }),
    [expandAnim, ty0, ty1, tyMid]
  );

  const heroScale = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.35, 1, 1.06],
        outputRange: [
          heroMinScale * 0.96,
          heroMinScale,
          heroMinScale + (1 - heroMinScale) * 0.48,
          1,
          1.012,
        ],
        extrapolate: 'clamp',
      }),
    [expandAnim, heroMinScale]
  );

  const heroQueueHiddenOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.18, 0.32, 1],
        outputRange: [1, 1, 0, 0],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  // ── Expanded Foreground Staggered Reveals (opacity + translateY only, native driver) ──
  const fullShellOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.1, 0.22, 1],
        outputRange: [0, 0, 1, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const topBarOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.52, 0.86, 1],
        outputRange: [0, 0, 0.95, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const topBarY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.52, 1, 1.06],
        outputRange: [64, 44, 0, -4],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const metaOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.28, 0.62, 1],
        outputRange: [0, 0, 0.95, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const metaParallaxY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.28, 1, 1.06],
        outputRange: [96, 62, 0, -3],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const midOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.2, 0.54, 1],
        outputRange: [0, 0, 0.95, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const midParallaxY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.2, 1, 1.06],
        outputRange: [76, 48, 0, -2],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const bottomOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.12, 0.44, 1],
        outputRange: [0, 0, 0.96, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const bottomParallaxY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.12, 1, 1.06],
        outputRange: [50, 32, 0, -1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  // Strict 100% GPU Native-Driver Composite Transforms
  const glassMotionTranslateY = useMemo(
    () => Animated.add(entryY, dockCatchY),
    [dockCatchY, entryY]
  );

  const sheetClipTranslateY = useMemo(
    () => Animated.add(clipBottomY, glassMotionTranslateY),
    [clipBottomY, glassMotionTranslateY]
  );

  const sheetClipScaleX = useMemo(
    () => Animated.multiply(shellScaleX, dockCatchScaleX),
    [dockCatchScaleX, shellScaleX]
  );

  const heroTotalTranslateY = useMemo(
    () => Animated.add(heroTranslateY, glassMotionTranslateY),
    [glassMotionTranslateY, heroTranslateY]
  );

  const heroTotalScale = useMemo(
    () => Animated.multiply(heroScale, entryScale),
    [entryScale, heroScale]
  );

  // ── Unified Gesture Engine & True Smoothed Release Velocity ──
  const dragEngine = useRef({
    beginDrag: (playHaptic = false) => {
      if (playHaptic) {
        Haptics.selectionAsync().catch(() => {});
      }
      const wasAnimating = isAnimatingRef.current;
      isDraggingRef.current = true;
      isAnimatingRef.current = false;
      shouldDockCatchRef.current = false;
      hasMovedInDragRef.current = false;

      dockCatchY.stopAnimation();
      dockCatchScaleX.stopAnimation();
      dockCatchScaleY.stopAnimation();
      dockCatchY.setValue(0);
      dockCatchScaleX.setValue(1);
      dockCatchScaleY.setValue(1);

      const fallbackOrigin = Math.max(0, Math.min(1, currentProgressRef.current));
      dragOriginProgressRef.current = fallbackOrigin;
      dragStartDyRef.current = null;
      lastSentProgressRef.current = fallbackOrigin;
      velSamplesRef.current = [{ t: Date.now(), p: fallbackOrigin }];

      if (wasAnimating) {
        expandAnim.stopAnimation((exactVal) => {
          if (
            typeof exactVal === 'number' &&
            Number.isFinite(exactVal) &&
            isDraggingRef.current &&
            !hasMovedInDragRef.current
          ) {
            const clampedExact = Math.max(0, Math.min(1, exactVal));
            currentProgressRef.current = clampedExact;
            dragOriginProgressRef.current = clampedExact;
            lastSentProgressRef.current = clampedExact;
            velSamplesRef.current = [{ t: Date.now(), p: clampedExact }];
          }
        });
      } else {
        expandAnim.stopAnimation();
      }
    },
    moveDrag: (dy: number) => {
      if (dragStartDyRef.current === null) {
        dragStartDyRef.current = dy;
        velSamplesRef.current = [{ t: Date.now(), p: dragOriginProgressRef.current }];
        return;
      }
      hasMovedInDragRef.current = true;
      const effectiveDy = dy - dragStartDyRef.current;
      const travel = Math.max(300, barTopRef.current * 0.84);
      const raw = dragOriginProgressRef.current - effectiveDy / travel;
      const clamped =
        raw < 0
          ? Math.max(-0.04, raw * 0.22)
          : raw > 1
            ? Math.min(1.04, 1 + (raw - 1) * 0.14)
            : raw;

      const now = Date.now();
      const samples = velSamplesRef.current;
      samples.push({ t: now, p: clamped });
      if (samples.length > 6) {
        samples.shift();
      }

      if (Math.abs(clamped - lastSentProgressRef.current) > 0.0003) {
        lastSentProgressRef.current = clamped;
        expandAnim.setValue(clamped);
      }
    },
    endDrag: (dy: number, vy: number) => {
      const now = Date.now();
      const samples = velSamplesRef.current;
      const travel = Math.max(300, barTopRef.current * 0.84);
      const rawGsVel = (-vy * 1000) / travel;
      let velPPerSec = rawGsVel;

      if (samples.length >= 2) {
        const last = samples[samples.length - 1];
        if (now - last.t > 75) {
          velPPerSec = 0;
        } else {
          let first = samples[0];
          for (let i = samples.length - 2; i >= 0; i--) {
            if (last.t - samples[i].t <= 85) {
              first = samples[i];
            } else {
              break;
            }
          }
          const dtMs = last.t - first.t;
          if (dtMs >= 16) {
            const measured = (last.p - first.p) / (dtMs / 1000);
            velPPerSec =
              measured * rawGsVel > 0 ? 0.65 * measured + 0.35 * rawGsVel : measured;
          }
        }
      }

      const effectiveDy = dragStartDyRef.current !== null ? dy - dragStartDyRef.current : dy;
      const p = currentProgressRef.current;
      const projectedP = p + velPPerSec * 0.14;

      if (dragOriginProgressRef.current >= 0.5) {
        const shouldClose = projectedP < 0.62 || (velPPerSec < -2.8 && effectiveDy > 48);
        animateToRef.current(shouldClose ? 0 : 1, velPPerSec);
      } else {
        const shouldOpen = projectedP > 0.34 || (velPPerSec > 1.7 && effectiveDy < -20);
        animateToRef.current(shouldOpen ? 1 : 0, velPPerSec);
      }
    },
  }).current;

  const handleTapOpen = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    animateToRef.current(1, 3.6);
  }, []);

  const handleClosePress = useCallback(() => {
    animateToRef.current(0, -2.4);
  }, []);

  // Responder for the expanding sheet surface (always catchable mid-opening and mid-closing)
  const unifiedShellPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        isAnimatingRef.current &&
        currentProgressRef.current > 0.025 &&
        currentProgressRef.current < 0.94,
      onStartShouldSetPanResponderCapture: () =>
        isAnimatingRef.current &&
        currentProgressRef.current > 0.025 &&
        currentProgressRef.current < 0.94,
      onMoveShouldSetPanResponder: (_, gs) => {
        if (isScrubbingRef.current) return false;
        const absDy = Math.abs(gs.dy);
        const absDx = Math.abs(gs.dx);
        if (absDy < 5 || absDy <= absDx * 1.15) return false;
        const p = currentProgressRef.current;
        if (isAnimatingRef.current || (p > 0.03 && p < 0.95)) {
          return true;
        }
        if (p <= 0.03) {
          return gs.dy < -5 || gs.dy > 8;
        }
        if (showQueueRef.current && queueScrollYRef.current > 2) return false;
        return gs.dy > 6 && absDy > absDx * 1.2;
      },
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        if (isScrubbingRef.current) return false;
        const absDy = Math.abs(gs.dy);
        const absDx = Math.abs(gs.dx);
        if (absDy < 5 || absDy <= absDx * 1.15) return false;
        const p = currentProgressRef.current;
        if (isAnimatingRef.current || (p > 0.03 && p < 0.95)) {
          return true;
        }
        if (p <= 0.03) {
          return gs.dy < -5 || gs.dy > 8;
        }
        if (showQueueRef.current && queueScrollYRef.current > 2) return false;
        return gs.dy > 6 && absDy > absDx * 1.2;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragEngine.beginDrag(false);
      },
      onPanResponderMove: (_, gs) => {
        dragEngine.moveDrag(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        dragEngine.endDrag(gs.dy, gs.vy);
      },
      onPanResponderTerminate: () => {
        animateToRef.current(currentProgressRef.current > 0.5 ? 1 : 0, 0);
      },
    })
  ).current;

  // Responder for the floating Liquid Glass mini pill
  const miniBarPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        isAnimatingRef.current &&
        currentProgressRef.current > 0.025 &&
        currentProgressRef.current < 0.96,
      onStartShouldSetPanResponderCapture: () =>
        isAnimatingRef.current &&
        currentProgressRef.current > 0.025 &&
        currentProgressRef.current < 0.96,
      onMoveShouldSetPanResponder: (_, gs) => {
        const absDy = Math.abs(gs.dy);
        const absDx = Math.abs(gs.dx);
        if (absDy < 5 || absDy <= absDx * 1.1) return false;
        if (isAnimatingRef.current || currentProgressRef.current > 0.03) {
          return true;
        }
        return gs.dy < -5 || gs.dy > 8;
      },
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        const absDy = Math.abs(gs.dy);
        const absDx = Math.abs(gs.dx);
        if (absDy < 5 || absDy <= absDx * 1.1) return false;
        if (isAnimatingRef.current || currentProgressRef.current > 0.03) {
          return true;
        }
        return gs.dy < -5 || gs.dy > 8;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragEngine.beginDrag(currentProgressRef.current <= 0.03);
      },
      onPanResponderMove: (_, gs) => {
        dragEngine.moveDrag(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        dragEngine.endDrag(gs.dy, gs.vy);
      },
      onPanResponderTerminate: () => {
        animateToRef.current(currentProgressRef.current > 0.5 ? 1 : 0, 0);
      },
    })
  ).current;

  // Sibling PanResponder on dimBackdrop behind the shrinking pill
  const backdropPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        sheetActiveRef.current && currentProgressRef.current < 0.96,
      onMoveShouldSetPanResponder: (_, gs) =>
        sheetActiveRef.current &&
        Math.abs(gs.dy) > 4 &&
        Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragEngine.beginDrag(false);
      },
      onPanResponderMove: (_, gs) => {
        dragEngine.moveDrag(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        dragEngine.endDrag(gs.dy, gs.vy);
      },
      onPanResponderTerminate: () => {
        animateToRef.current(currentProgressRef.current > 0.5 ? 1 : 0, 0);
      },
    })
  ).current;

  if (!track) return null;

  const canPrev = queueIdx > 0 || Boolean(track);
  const canNext = queueIdx + 1 < queue.length;

  const handleShare = async () => {
    Haptics.selectionAsync().catch(() => {});
    try {
      await Share.share({
        message: `🎵 ${track.title} — ${track.artist}\n${buildAppleMusicUrl(track)}`,
      });
    } catch {
      // Cancelled
    }
  };

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      {/* Layer 1: Delayed Background Dim */}
      <Animated.View
        pointerEvents={sheetActive ? 'auto' : 'none'}
        {...backdropPanResponder.panHandlers}
        style={[styles.dimBackdrop, { opacity: backdropOpacity }]}
      />

      {/* Layer 2: GPU Double-Counter-Translate Clip Window (ZERO Yoga layout mutations) */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.sheetClipWindow,
          {
            borderBottomLeftRadius: glassRadius,
            borderBottomRightRadius: glassRadius,
            opacity: sheetWindowOpacity,
            transform: [
              { translateX: shellTranslateX },
              { translateY: sheetClipTranslateY },
              { scaleX: sheetClipScaleX },
              { scaleY: dockCatchScaleY },
            ],
          },
        ]}
      >
        <Animated.View
          pointerEvents="auto"
          {...unifiedShellPanResponder.panHandlers}
          style={[
            styles.sheetSurface,
            {
              borderTopLeftRadius: glassRadius,
              borderTopRightRadius: glassRadius,
              transform: [{ translateY: innerTopY }],
            },
          ]}
        >
          {/* (a) Progressive Mood Wash (clear at rest -> solid mood canvas as it grows) */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: colors.canvas,
                opacity: moodBackdropOpacity,
              },
            ]}
          >
            <LinearGradient
              colors={moodGradientColors}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {/* (b) ONE Unified Top Grabber Pill riding with the rising top edge */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.unifiedGrabberWrap,
              {
                transform: [{ translateY: grabberY }, { scaleX: grabberScaleX }],
              },
            ]}
          >
            <View style={styles.unifiedGrabberPill} />
          </Animated.View>

          {/* (c) Fixed Full-Screen Player Content inside GPU window */}
          <Animated.View
            ref={fullContentRef}
            pointerEvents={sheetActive ? 'auto' : 'none'}
            style={[
              styles.fullContentFixed,
              {
                width: SCREEN_WIDTH,
                height: SCREEN_HEIGHT,
                opacity: fullShellOpacity,
              },
            ]}
          >
              <View
                style={[
                  styles.safe,
                  { paddingTop: insets.top, paddingBottom: insets.bottom },
                ]}
              >
                {/* Header */}
                <Animated.View
                  style={[
                    styles.headerDragZone,
                    { opacity: topBarOpacity, transform: [{ translateY: topBarY }] },
                  ]}
                >
                  <View style={styles.topBar}>
                    <SpringPressable haptic onPress={handleClosePress} style={styles.topCircleBtn}>
                      <Ionicons name="chevron-down" size={22} color={colors.inkPrimary} />
                    </SpringPressable>

                    <View style={styles.topCenter}>
                      <Text style={styles.topEyebrow}>ŞİMDİ ÇALIYOR · 30 SN ÖNİZLEME</Text>
                      <Text style={styles.topSub}>
                        {queueIdx + 1} / {queue.length} · {moodMeta.shortTr}
                      </Text>
                    </View>

                    <SpringPressable
                      haptic
                      onPress={() => setShowQueue((v) => !v)}
                      style={[styles.topCircleBtn, showQueue && styles.topCircleBtnActive]}
                    >
                      <Ionicons
                        name="list"
                        size={19}
                        color={showQueue ? '#FFFFFF' : colors.inkPrimary}
                      />
                    </SpringPressable>
                  </View>
                </Animated.View>

                {showQueue ? (
                  <ScrollView
                    style={styles.queueScroll}
                    contentContainerStyle={styles.queueContent}
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      queueScrollYRef.current = e.nativeEvent.contentOffset.y;
                    }}
                  >
                    <Text style={styles.queueTitle}>Sıradaki Şarkılar ({queue.length})</Text>
                    {queue.map((item, idx) => {
                      const isRowActive = idx === queueIdx;
                      return (
                        <SpringPressable
                          key={`${item.id}-${idx}`}
                          haptic
                          onPress={() => {
                            onSelectQueueIndex(idx);
                            setShowQueue(false);
                          }}
                          style={[styles.queueRow, isRowActive && styles.queueRowActive]}
                        >
                          <Text style={[styles.queueIdx, isRowActive && { color: colors.brand }]}>
                            {idx + 1}
                          </Text>
                          {item.artworkUrl ? (
                            <Image source={{ uri: item.artworkUrl }} style={styles.queueCover} />
                          ) : (
                            <View style={[styles.queueCover, styles.coverFallback]}>
                              <Ionicons name="musical-notes" size={15} color={colors.brand} />
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.queueTrackTitle,
                                isRowActive && { color: colors.brand },
                              ]}
                            >
                              {item.title}
                            </Text>
                            <Text numberOfLines={1} style={styles.queueTrackArtist}>
                              {item.artist}
                            </Text>
                          </View>
                          {isRowActive && (
                            <Ionicons
                              name={isPlaying ? 'volume-high' : 'pause'}
                              size={17}
                              color={colors.brand}
                            />
                          )}
                        </SpringPressable>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <View style={styles.playerBody}>
                    {/* Measured Non-Transformed Slot for Shared Hero Artwork */}
                    <View
                      ref={artSlotRef}
                      onLayout={measureArtSlot}
                      style={styles.artSlotStage}
                    />

                    {/* Title & Track Metadata */}
                    <Animated.View
                      style={[
                        styles.metaRow,
                        {
                          opacity: metaOpacity,
                          transform: [{ translateY: metaParallaxY }],
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={styles.moodBadgeRow}>
                          <View style={[styles.moodPill, { backgroundColor: moodMeta.softColor }]}>
                            <Text style={[styles.moodPillText, { color: moodMeta.color }]}>
                              {moodMeta.shortTr}
                            </Text>
                          </View>
                          <View style={styles.langPill}>
                            <Text style={styles.langPillText}>
                              {track.language === 'tr' ? 'TR' : 'INT'} · {track.genre}
                            </Text>
                          </View>
                        </View>
                        <Text numberOfLines={2} style={styles.trackTitle}>
                          {track.title}
                        </Text>
                        <Text numberOfLines={1} style={styles.trackArtist}>
                          {track.artist}
                          {track.album ? ` · ${track.album}` : ''}
                        </Text>
                      </View>
                    </Animated.View>

                    {/* Secondary Utility Pill Row & Seekable Scrubber (Grouped Mid Layer) */}
                    <Animated.View
                      style={[
                        styles.midGroup,
                        {
                          opacity: midOpacity,
                          transform: [{ translateY: midParallaxY }],
                        },
                      ]}
                    >
                      <View style={styles.utilityRow}>
                        <SpringPressable
                          haptic
                          onPress={() => onToggleFavorite(track.id)}
                          style={[styles.utilBtn, track.isFavorite && styles.utilBtnActive]}
                        >
                          <Ionicons
                            name={track.isFavorite ? 'heart' : 'heart-outline'}
                            size={16}
                            color={track.isFavorite ? colors.brand : colors.inkPrimary}
                          />
                          <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.78}
                            style={[
                              styles.utilText,
                              track.isFavorite && { color: colors.brand },
                            ]}
                          >
                            {track.isFavorite ? 'Favori' : 'Beğen'}
                          </Text>
                        </SpringPressable>

                        <SpringPressable
                          haptic
                          onPress={() => onAddToPlaylist(track)}
                          style={[styles.utilBtn, styles.utilBtnWide]}
                        >
                          <Ionicons name="add-circle-outline" size={16} color={colors.inkPrimary} />
                          <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.78}
                            style={styles.utilText}
                          >
                            Listeye Ekle
                          </Text>
                        </SpringPressable>

                        <SpringPressable
                          haptic
                          onPress={() => {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
                              () => {}
                            );
                            onDislike(track);
                          }}
                          style={styles.utilBtn}
                        >
                          <Ionicons name="eye-off-outline" size={16} color={colors.danger} />
                          <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.78}
                            style={[styles.utilText, { color: colors.danger }]}
                          >
                            Önerme
                          </Text>
                        </SpringPressable>

                        <SpringPressable haptic onPress={handleShare} style={styles.utilIconBtn}>
                          <Ionicons name="share-outline" size={17} color={colors.inkPrimary} />
                        </SpringPressable>
                      </View>

                      <FullScrubber
                        player={player}
                        active={sheetActive}
                        isScrubbingRef={isScrubbingRef}
                        onSeek={onSeek}
                        styles={styles}
                      />
                    </Animated.View>

                    {/* Transport Controls & External Services (Grouped Bottom Layer) */}
                    <Animated.View
                      style={[
                        styles.bottomGroup,
                        {
                          opacity: bottomOpacity,
                          transform: [{ translateY: bottomParallaxY }],
                        },
                      ]}
                    >
                      <View style={styles.transportWrap}>
                        <View style={styles.transportRow}>
                          <SpringPressable
                            haptic
                            onPress={onToggleRepeatOne}
                            style={[styles.minorCtrlBtn, repeatOne && styles.minorCtrlActive]}
                          >
                            <Ionicons
                              name="repeat"
                              size={20}
                              color={repeatOne ? colors.brand : colors.inkSecondary}
                            />
                            {repeatOne && <View style={styles.repeatDot} />}
                          </SpringPressable>

                          <SpringPressable
                            haptic
                            disabled={!canPrev}
                            onPress={onPrevious}
                            style={[styles.skipBtn, !canPrev && { opacity: 0.35 }]}
                          >
                            <Ionicons name="play-skip-back" size={26} color={colors.inkPrimary} />
                          </SpringPressable>

                          <SpringPressable
                            haptic
                            scaleTo={0.9}
                            onPress={onTogglePlay}
                            style={styles.bigPlayBtn}
                          >
                            <Ionicons
                              name={isPlaying ? 'pause' : 'play'}
                              size={30}
                              color="#FFFFFF"
                              style={!isPlaying ? { marginLeft: 3 } : undefined}
                            />
                          </SpringPressable>

                          <SpringPressable
                            haptic
                            disabled={!canNext}
                            onPress={onNext}
                            style={[styles.skipBtn, !canNext && { opacity: 0.35 }]}
                          >
                            <Ionicons name="play-skip-forward" size={26} color={colors.inkPrimary} />
                          </SpringPressable>

                          <SpringPressable
                            haptic
                            onPress={() => setShowQueue(true)}
                            style={styles.minorCtrlBtn}
                          >
                            <Ionicons name="musical-notes" size={19} color={colors.inkSecondary} />
                          </SpringPressable>
                        </View>
                      </View>

                      <View style={styles.platformRow}>
                        <Pressable
                          onPress={() => Linking.openURL(buildAppleMusicUrl(track)).catch(() => {})}
                          style={styles.platformPill}
                        >
                          <Ionicons name="logo-apple" size={15} color={colors.inkPrimary} />
                          <Text style={styles.platformText}>Apple Music</Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            Linking.openURL(buildSpotifySearchUrl(track.artist, track.title)).catch(
                              () => {}
                            )
                          }
                          style={styles.platformPill}
                        >
                          <Ionicons name="disc-outline" size={15} color="#1DB954" />
                          <Text style={styles.platformText}>Spotify</Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            Linking.openURL(buildYoutubeMusicUrl(track.artist, track.title)).catch(
                              () => {}
                            )
                          }
                          style={styles.platformPill}
                        >
                          <Ionicons name="logo-youtube" size={15} color="#FF3B30" />
                          <Text style={styles.platformText}>YT Music</Text>
                        </Pressable>
                      </View>
                    </Animated.View>
                  </View>
                )}
              </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* Layer 3: Fixed Real iOS 26 Liquid Glass Mini Player Pill (NEVER resized) */}
      <Animated.View
        pointerEvents={sheetActive ? 'none' : 'auto'}
        {...miniBarPanResponder.panHandlers}
        style={[
          styles.miniGlassLayer,
          {
            left: barLeft,
            top: barTop,
            width: barWidth,
            height: barHeight,
            opacity: miniGlassOpacity,
            transform: [
              { translateY: glassMotionTranslateY },
              { scale: entryScale },
              { scaleX: dockCatchScaleX },
              { scaleY: dockCatchScaleY },
            ],
          },
        ]}
      >
        <LiquidGlassSurface
          glassStyle="regular"
          capsule={false}
          cornerRadius={glassRadius}
          interactive
          isDark={isDark}
          showShadow
        />

        <View
          pointerEvents="box-none"
          style={[styles.miniGlassClip, { borderRadius: glassRadius }]}
        >
          <View pointerEvents="none" style={styles.miniRestGrabberWrap}>
            <View style={styles.unifiedGrabberPill} />
          </View>

          <Animated.View style={[styles.miniRow, { opacity: miniContentOpacity }]}>
            <Pressable onPress={handleTapOpen} style={styles.miniInfoTapArea}>
              {/* Empty 38x38 spacer where the unified Hero Artwork sits */}
              <View style={styles.miniArtSpacer} />

              <View style={styles.miniInfo}>
                <View style={styles.miniTitleRow}>
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
                  <Text numberOfLines={1} style={styles.miniTitle}>
                    {track.title}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.miniArtist}>
                  {track.artist}
                </Text>
                <MiniProgressBar player={player} styles={styles} />
              </View>
            </Pressable>

            <View style={styles.miniControls}>
              <SpringPressable
                haptic
                scaleTo={0.88}
                disabled={!canPrev}
                onPress={onPrevious}
                style={[styles.miniAuxBtn, !canPrev && { opacity: 0.32 }]}
                hitSlop={6}
              >
                <Ionicons name="play-skip-back" size={16} color={colors.inkPrimary} />
              </SpringPressable>
              <SpringPressable
                haptic
                scaleTo={0.88}
                onPress={onTogglePlay}
                style={styles.miniPlayBtn}
                hitSlop={6}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={15} color="#FFFFFF" />
              </SpringPressable>
              <SpringPressable
                haptic
                scaleTo={0.88}
                disabled={!canNext}
                onPress={onNext}
                style={[styles.miniAuxBtn, !canNext && { opacity: 0.32 }]}
                hitSlop={6}
              >
                <Ionicons name="play-skip-forward" size={16} color={colors.inkPrimary} />
              </SpringPressable>
              <SpringPressable
                haptic
                scaleTo={0.88}
                onPress={onStopAndDismiss}
                style={styles.miniCloseBtn}
                hitSlop={6}
              >
                <Ionicons name="close" size={16} color={colors.inkMuted} />
              </SpringPressable>
            </View>
          </Animated.View>
        </View>
      </Animated.View>

      {/* Layer 4: ONE Shared Hero Album Artwork Morphing Smoothly Across Layers */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.heroArtOuter,
          {
            opacity: showQueue ? heroQueueHiddenOpacity : 1,
            transform: [
              { translateX: heroTranslateX },
              { translateY: heroTotalTranslateY },
              { scale: heroTotalScale },
            ],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.heroArtInner,
            {
              transform: [{ scale: artScale }],
            },
          ]}
        >
          {track.artworkUrl ? (
            <Image source={{ uri: track.artworkUrl }} style={styles.heroArtworkImg} />
          ) : (
            <View style={[styles.heroArtworkImg, styles.coverFallback]}>
              <Ionicons name="musical-notes" size={64} color={colors.brand} />
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
    }
  )
);

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    overlayRoot: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 80,
      elevation: 80,
    },
    dimBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: '#000000',
    },
    sheetClipWindow: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      overflow: 'hidden',
      zIndex: 82,
    },
    sheetSurface: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      overflow: 'hidden',
      backgroundColor: colors.isDark ? 'rgba(24, 27, 34, 0.92)' : 'rgba(246, 247, 250, 0.94)',
      borderTopWidth: 1,
      borderLeftWidth: 0.75,
      borderRightWidth: 0.75,
      borderColor: colors.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.86)',
    },
    miniGlassLayer: {
      position: 'absolute',
      zIndex: 83,
      overflow: 'visible',
    },
    miniGlassClip: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
    },
    miniRestGrabberWrap: {
      position: 'absolute',
      top: 5,
      left: 0,
      right: 0,
      alignItems: 'center',
      zIndex: 30,
    },
    unifiedGrabberWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      zIndex: 30,
    },
    unifiedGrabberPill: {
      width: 30,
      height: 3.5,
      borderRadius: 2,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.34)' : 'rgba(24,29,37,0.24)',
    },
    fullContentFixed: {
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 10,
    },
    safe: {
      flex: 1,
      paddingHorizontal: 20,
    },
    headerDragZone: {
      paddingTop: 18,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 4,
      paddingBottom: 8,
    },
    topCircleBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    topCircleBtnActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    topCenter: {
      alignItems: 'center',
    },
    topEyebrow: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.9,
      color: colors.inkMuted,
    },
    topSub: {
      marginTop: 2,
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    playerBody: {
      flex: 1,
      justifyContent: 'space-evenly',
      paddingBottom: 14,
    },
    artSlotStage: {
      width: ART_SIZE,
      height: ART_SIZE,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    coverFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.elevated,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    moodBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginBottom: 6,
    },
    moodPill: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
    },
    moodPillText: {
      fontSize: 11,
      fontWeight: '800',
    },
    langPill: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    langPillText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    trackTitle: {
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: -0.5,
      color: colors.inkPrimary,
    },
    trackArtist: {
      marginTop: 4,
      fontSize: 14.5,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    utilityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    utilBtn: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      paddingHorizontal: 8,
      paddingVertical: 9,
      borderRadius: 12,
    },
    utilBtnWide: {
      flex: 1.48,
    },
    utilBtnActive: {
      backgroundColor: colors.brandSoft,
      borderColor: colors.brand,
    },
    utilText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkPrimary,
      flexShrink: 1,
    },
    utilIconBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrubberWrap: {
      gap: 4,
    },
    scrubberTouchArea: {
      height: 28,
      justifyContent: 'center',
      position: 'relative',
    },
    scrubberTrack: {
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(24,29,37,0.14)',
      overflow: 'hidden',
    },
    scrubberFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.brand,
    },
    scrubberThumb: {
      position: 'absolute',
      width: 15,
      height: 15,
      borderRadius: 7.5,
      backgroundColor: colors.brand,
      marginLeft: -7.5,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    timeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    timeLabel: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkMuted,
    },
    midGroup: {
      gap: 14,
    },
    bottomGroup: {
      gap: 12,
    },
    transportWrap: {
      position: 'relative',
      borderRadius: 40,
      minHeight: 78,
      justifyContent: 'center',
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.78)',
      borderWidth: 1,
      borderColor: colors.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(24,29,37,0.09)',
    },
    transportRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    minorCtrlBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    minorCtrlActive: {
      backgroundColor: colors.brandSoft,
    },
    repeatDot: {
      position: 'absolute',
      bottom: 4,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.brand,
    },
    skipBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bigPlayBtn: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.brand,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
    },
    platformRow: {
      flexDirection: 'row',
      gap: 8,
    },
    platformPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: 12,
      paddingVertical: 10,
    },
    platformText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    queueScroll: {
      flex: 1,
      marginTop: 8,
    },
    queueContent: {
      gap: 8,
      paddingBottom: 24,
    },
    queueTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.inkPrimary,
      marginBottom: 4,
    },
    queueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: 15,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    queueRowActive: {
      backgroundColor: colors.brandSoft,
      borderColor: colors.brand,
    },
    queueIdx: {
      width: 22,
      textAlign: 'center',
      fontSize: 12.5,
      fontWeight: '800',
      color: colors.inkMuted,
    },
    queueCover: {
      width: 42,
      height: 42,
      borderRadius: 10,
      backgroundColor: colors.subtle,
    },
    queueTrackTitle: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    queueTrackArtist: {
      fontSize: 11.5,
      color: colors.inkSecondary,
      marginTop: 1,
    },
    miniRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingTop: 12,
      paddingBottom: 9,
      gap: 8,
    },
    miniInfoTapArea: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      minWidth: 0,
    },
    miniArtSpacer: {
      width: MINI_ART_SIZE,
      height: MINI_ART_SIZE,
    },
    miniInfo: {
      flex: 1,
      minWidth: 0,
    },
    miniTitleRow: {
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
    miniTitle: {
      flex: 1,
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    miniArtist: {
      fontSize: 11.5,
      color: colors.inkSecondary,
      marginTop: 1,
    },
    miniProgressTrack: {
      height: 2.5,
      borderRadius: 999,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(24,29,37,0.12)',
      width: '100%',
      marginTop: 4,
      overflow: 'hidden',
    },
    miniProgressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.brand,
    },
    miniControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    miniAuxBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    miniPlayBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    miniCloseBtn: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Shared Hero Artwork directly in overlayRoot above mini pill & sheet surface
    heroArtOuter: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: ART_SIZE,
      height: ART_SIZE,
      zIndex: 85,
    },
    heroArtInner: {
      width: ART_SIZE,
      height: ART_SIZE,
      borderRadius: 34,
      backgroundColor: colors.surface,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: colors.isDark ? 0.56 : 0.18,
      shadowRadius: 20,
    },
    heroArtworkImg: {
      width: ART_SIZE,
      height: ART_SIZE,
      borderRadius: 34,
      backgroundColor: colors.surface,
    },
  });
