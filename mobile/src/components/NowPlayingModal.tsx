import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrackRecord } from '../database/iosDatabase';
import {
  buildAppleMusicUrl,
  buildSpotifySearchUrl,
  buildYoutubeMusicUrl,
} from '../services/onlineMusicService';
import { resolveMoodVisual, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { LiquidGlassSurface } from './LiquidGlassSurface';
import { MiniBarFrame } from './MiniAudioPlayer';
import { SpringPressable } from './MotionPrimitives';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  active: boolean;
  expandAnim: Animated.Value;
  miniBarFrame: MiniBarFrame;
  openArrivalSignal?: { tick: number; speed: number };
  queue: TrackRecord[];
  queueIdx: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  repeatOne: boolean;
  onDragProgress: (progress: number) => void;
  onDragEnd: (target: 0 | 1, velocity?: number) => void;
  onClose: () => void;
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

export const NowPlayingModal: React.FC<Props> = ({
  active,
  expandAnim,
  miniBarFrame,
  openArrivalSignal,
  queue,
  queueIdx,
  isPlaying,
  currentTime,
  duration,
  repeatOne,
  onDragProgress,
  onDragEnd,
  onClose,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onToggleRepeatOne,
  onSelectQueueIndex,
  onToggleFavorite,
  onAddToPlaylist,
  onDislike,
}) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [showQueue, setShowQueue] = useState(false);
  const [draggingRatio, setDraggingRatio] = useState<number | null>(null);
  const barWidthRef = useRef(280);
  const grantXRef = useRef(0);
  const dragRatioRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const showQueueRef = useRef(false);
  showQueueRef.current = showQueue;
  const queueScrollYRef = useRef(0);

  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onDragProgressRef = useRef(onDragProgress);
  onDragProgressRef.current = onDragProgress;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const artScale = useRef(new Animated.Value(isPlaying ? 1 : 0.92)).current;
  const arrivalArtY = useRef(new Animated.Value(0)).current;
  const arrivalArtScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.14)).current;
  const glowScale = useRef(new Animated.Value(1)).current;

  const track = queueIdx >= 0 && queueIdx < queue.length ? queue[queueIdx] : null;
  const hasTrackRef = useRef(Boolean(track));
  hasTrackRef.current = Boolean(track);
  const effectiveDuration = duration > 0 ? duration : 30;
  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration;

  const barTop = Math.max(120, miniBarFrame.y);
  const barHeight = Math.max(54, miniBarFrame.height);
  const barBottomY = Math.min(SCREEN_HEIGHT, barTop + barHeight);
  const barScaleX = Math.max(0.84, Math.min(0.96, miniBarFrame.width / Math.max(1, SCREEN_WIDTH)));
  const halfH = SCREEN_HEIGHT / 2;
  const sy0 = Math.max(0.06, Math.min(0.14, barHeight / Math.max(1, SCREEN_HEIGHT)));
  const syMid = Math.max(0.36, sy0 + (1 - sy0) * 0.42);
  const syOver = 1.055;

  const tyNeg = Math.min(SCREEN_HEIGHT, barBottomY + 8) - halfH * (1 + sy0);
  const ty0 = barBottomY - halfH * (1 + sy0);
  const tyMid = SCREEN_HEIGHT - halfH * (1 + syMid);
  const ty1 = 0;
  const tyOver = SCREEN_HEIGHT - halfH * (1 + syOver);

  const barTopRef = useRef(barTop);
  barTopRef.current = barTop;

  useEffect(() => {
    if (!active) {
      setShowQueue(false);
      setDraggingRatio(null);
      isScrubbingRef.current = false;
      queueScrollYRef.current = 0;
    }
  }, [active]);

  useEffect(() => {
    Animated.spring(artScale, {
      toValue: isPlaying ? 1 : 0.92,
      damping: 16,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [artScale, isPlaying]);

  useEffect(() => {
    if (!openArrivalSignal || openArrivalSignal.tick <= 0 || !hasTrackRef.current) return;
    const s = Math.max(0, Math.min(1, openArrivalSignal.speed));

    glowOpacity.stopAnimation();
    glowScale.stopAnimation();
    arrivalArtY.stopAnimation();
    arrivalArtScale.stopAnimation();

    glowOpacity.setValue(0);
    glowScale.setValue(0.76);
    arrivalArtY.setValue(0);
    arrivalArtScale.setValue(1);

    const hapticTimer = setTimeout(() => {
      Haptics.impactAsync(
        s > 0.55 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
      ).catch(() => {});
    }, Math.round(140 - s * 55));

    const arrivalAnim = Animated.parallel([
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowOpacity, {
            toValue: 0.28 + s * 0.14,
            duration: Math.round(240 - s * 60),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(glowScale, {
            toValue: 1.12 + s * 0.1,
            duration: Math.round(240 - s * 60),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(glowOpacity, {
            toValue: 0.15,
            duration: 360,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(glowScale, {
            toValue: 1.0,
            duration: 360,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(Math.round(105 - s * 45)),
        Animated.parallel([
          Animated.timing(arrivalArtY, {
            toValue: -(4 + s * 7),
            duration: 85,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(arrivalArtScale, {
            toValue: 1.02 + s * 0.032,
            duration: 85,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(arrivalArtY, {
            toValue: 0,
            damping: 11,
            stiffness: 210,
            mass: 0.78,
            useNativeDriver: true,
          }),
          Animated.spring(arrivalArtScale, {
            toValue: 1.0,
            damping: 11,
            stiffness: 210,
            mass: 0.78,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]);
    arrivalAnim.start();

    return () => {
      clearTimeout(hapticTimer);
      arrivalAnim.stop();
    };
  }, [openArrivalSignal, arrivalArtY, arrivalArtScale, glowOpacity, glowScale]);

  const backdropOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.16, 0.55, 1],
        outputRange: isDark ? [0, 0, 0.28, 0.56] : [0, 0, 0.16, 0.36],
        extrapolate: 'clamp',
      }),
    [expandAnim, isDark]
  );

  const surfaceOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.02, 0.12, 1],
        outputRange: [0, 0.65, 1, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const surfaceScaleY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.45, 1, 1.14],
        outputRange: [sy0, sy0, syMid, 1, syOver],
        extrapolate: 'clamp',
      }),
    [expandAnim, sy0, syMid, syOver]
  );

  const surfaceTranslateY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.45, 1, 1.14],
        outputRange: [tyNeg, ty0, tyMid, ty1, tyOver],
        extrapolate: 'clamp',
      }),
    [expandAnim, tyNeg, ty0, tyMid, ty1, tyOver]
  );

  const surfaceScaleX = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [-0.05, 0, 0.35, 0.85, 1, 1.14],
        outputRange: [
          barScaleX * 0.98,
          barScaleX,
          barScaleX + (1 - barScaleX) * 0.65,
          0.992,
          1,
          1.015,
        ],
        extrapolate: 'clamp',
      }),
    [expandAnim, barScaleX]
  );

  const contentShellOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.10, 0.22, 1],
        outputRange: [0, 0, 1, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const topBarOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.56, 0.86, 1],
        outputRange: [0, 0, 0.95, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const topBarY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.56, 1, 1.14],
        outputRange: [70, 48, 0, -18],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const artOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.36, 0.72, 1],
        outputRange: [0, 0, 0.95, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const artParallaxY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.36, 1, 1.14],
        outputRange: [130, 88, 0, -24],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const artParallaxScale = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.36, 1, 1.14],
        outputRange: [0.78, 0.86, 1, 1.045],
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
        inputRange: [0, 0.28, 1, 1.14],
        outputRange: [105, 68, 0, -16],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const midOpacity = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.20, 0.54, 1],
        outputRange: [0, 0, 0.95, 1],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const midParallaxY = useMemo(
    () =>
      expandAnim.interpolate({
        inputRange: [0, 0.20, 1, 1.14],
        outputRange: [82, 52, 0, -12],
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
        inputRange: [0, 0.12, 1, 1.14],
        outputRange: [54, 34, 0, -8],
        extrapolate: 'clamp',
      }),
    [expandAnim]
  );

  const headerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        const travel = Math.max(280, barTopRef.current * 0.76);
        const progress = Math.max(-0.04, Math.min(1.12, 1 - gs.dy / travel));
        onDragProgressRef.current(progress);
      },
      onPanResponderRelease: (_, gs) => {
        const travel = Math.max(280, barTopRef.current * 0.76);
        const normVel = Math.min(9.5, (Math.abs(gs.vy) * 1000) / travel);
        const shouldClose = gs.dy > 105 || (gs.dy > 32 && gs.vy > 0.48);
        onDragEndRef.current(shouldClose ? 0 : 1, normVel);
      },
      onPanResponderTerminate: () => {
        onDragEndRef.current(1, 0);
      },
    })
  ).current;

  const bodyPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        !isScrubbingRef.current &&
        (!showQueueRef.current || queueScrollYRef.current <= 2) &&
        gs.dy > 8 &&
        Math.abs(gs.dy) > Math.abs(gs.dx) * 1.25,
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        !isScrubbingRef.current &&
        (!showQueueRef.current || queueScrollYRef.current <= 2) &&
        gs.dy > 10 &&
        Math.abs(gs.dy) > Math.abs(gs.dx) * 1.35,
      onPanResponderMove: (_, gs) => {
        const travel = Math.max(280, barTopRef.current * 0.76);
        const progress = Math.max(-0.04, Math.min(1.12, 1 - gs.dy / travel));
        onDragProgressRef.current(progress);
      },
      onPanResponderRelease: (_, gs) => {
        const travel = Math.max(280, barTopRef.current * 0.76);
        const normVel = Math.min(9.5, (Math.abs(gs.vy) * 1000) / travel);
        const shouldClose = gs.dy > 105 || (gs.dy > 32 && gs.vy > 0.48);
        onDragEndRef.current(shouldClose ? 0 : 1, normVel);
      },
      onPanResponderTerminate: () => {
        onDragEndRef.current(1, 0);
      },
    })
  ).current;

  const panResponder = useRef(
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

  if (!track) return null;

  const moodMeta = resolveMoodVisual(track.mood, null, colors);
  const liveRatio = Math.max(0, Math.min(1, currentTime / effectiveDuration));
  const shownRatio = draggingRatio !== null ? draggingRatio : liveRatio;
  const shownSeconds = shownRatio * effectiveDuration;
  const canPrev = queueIdx > 0 || currentTime > 3;
  const canNext = queueIdx + 1 < queue.length;

  const gradientColors: readonly [string, string, string] = isDark
    ? [moodMeta.softColor, colors.canvas, colors.canvas]
    : [moodMeta.softColor, colors.canvas, colors.surface];

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
    <View style={styles.overlayRoot} pointerEvents={active ? 'auto' : 'none'}>
      <Animated.View
        pointerEvents="none"
        style={[styles.dimBackdrop, { opacity: backdropOpacity }]}
      />

      {/* Upward-Expanding Background Surface (anchored at mini-player dock edge) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.sheetSurface,
          {
            opacity: surfaceOpacity,
            transform: [
              { translateY: surfaceTranslateY },
              { scaleX: surfaceScaleX },
              { scaleY: surfaceScaleY },
            ],
          },
        ]}
      >
        <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />
      </Animated.View>

      {/* Undistorted Foreground Content */}
      <Animated.View
        {...bodyPanResponder.panHandlers}
        style={[styles.sheetContent, { opacity: contentShellOpacity }]}
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {/* Grabber & Top Bar */}
          <Animated.View
            {...headerPanResponder.panHandlers}
            style={{ opacity: topBarOpacity, transform: [{ translateY: topBarY }] }}
          >
            <View style={styles.sheetGrabberWrap}>
              <View style={styles.sheetGrabber} />
            </View>

            <View style={styles.topBar}>
              <SpringPressable haptic onPress={onClose} style={styles.topCircleBtn}>
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
                const active = idx === queueIdx;
                return (
                  <SpringPressable
                    key={`${item.id}-${idx}`}
                    haptic
                    onPress={() => {
                      onSelectQueueIndex(idx);
                      setShowQueue(false);
                    }}
                    style={[styles.queueRow, active && styles.queueRowActive]}
                  >
                    <Text style={[styles.queueIdx, active && { color: colors.brand }]}>
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
                        style={[styles.queueTrackTitle, active && { color: colors.brand }]}
                      >
                        {item.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.queueTrackArtist}>
                        {item.artist}
                      </Text>
                    </View>
                    {active && (
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
              {/* Artwork with ambient mood halo & momentum follow-through */}
              <Animated.View
                style={[
                  styles.artStage,
                  {
                    opacity: artOpacity,
                    transform: [{ translateY: artParallaxY }, { scale: artParallaxScale }],
                  },
                ]}
              >
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.ambientGlow,
                    {
                      backgroundColor: moodMeta.color,
                      opacity: glowOpacity,
                      transform: [{ scale: glowScale }],
                    },
                  ]}
                />
                <Animated.View
                  style={{
                    transform: [{ translateY: arrivalArtY }, { scale: arrivalArtScale }],
                  }}
                >
                  <Animated.View style={[styles.artShadowWrap, { transform: [{ scale: artScale }] }]}>
                    {track.artworkUrl ? (
                      <Image source={{ uri: track.artworkUrl }} style={styles.artwork} />
                    ) : (
                      <View style={[styles.artwork, styles.coverFallback]}>
                        <Ionicons name="musical-notes" size={64} color={colors.brand} />
                      </View>
                    )}
                  </Animated.View>
                </Animated.View>
              </Animated.View>

              {/* Title & Quick Meta Actions */}
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

              {/* Secondary Utility Pill Row */}
              <Animated.View
                style={[
                  styles.utilityRow,
                  {
                    opacity: midOpacity,
                    transform: [{ translateY: midParallaxY }],
                  },
                ]}
              >
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
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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
              </Animated.View>

              {/* Seekable Scrubber */}
              <Animated.View
                style={[
                  styles.scrubberWrap,
                  {
                    opacity: midOpacity,
                    transform: [{ translateY: midParallaxY }],
                  },
                ]}
              >
                <View
                  style={styles.scrubberTouchArea}
                  onLayout={(e) => {
                    barWidthRef.current = e.nativeEvent.layout.width;
                  }}
                  {...panResponder.panHandlers}
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
              </Animated.View>

              {/* Transport Controls inside Liquid Glass Capsule */}
              <Animated.View
                style={[
                  styles.transportWrap,
                  {
                    opacity: bottomOpacity,
                    transform: [{ translateY: bottomParallaxY }],
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
              </Animated.View>

              {/* External Music Services */}
              <Animated.View
                style={[
                  styles.platformRow,
                  {
                    opacity: bottomOpacity,
                    transform: [{ translateY: bottomParallaxY }],
                  },
                ]}
              >
                <Pressable
                  onPress={() => Linking.openURL(buildAppleMusicUrl(track)).catch(() => {})}
                  style={styles.platformPill}
                >
                  <Ionicons name="logo-apple" size={15} color={colors.inkPrimary} />
                  <Text style={styles.platformText}>Apple Music</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    Linking.openURL(buildSpotifySearchUrl(track.artist, track.title)).catch(() => {})
                  }
                  style={styles.platformPill}
                >
                  <Ionicons name="disc-outline" size={15} color="#1DB954" />
                  <Text style={styles.platformText}>Spotify</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    Linking.openURL(buildYoutubeMusicUrl(track.artist, track.title)).catch(() => {})
                  }
                  style={styles.platformPill}
                >
                  <Ionicons name="logo-youtube" size={15} color="#FF3B30" />
                  <Text style={styles.platformText}>YT Music</Text>
                </Pressable>
              </Animated.View>
            </View>
          )}
        </SafeAreaView>
      </Animated.View>
    </View>
  );
};

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
    sheetSurface: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.canvas,
      borderRadius: 40,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: colors.isDark ? 0.5 : 0.22,
      shadowRadius: 28,
      elevation: 20,
    },
    sheetContent: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    artStage: {
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    ambientGlow: {
      position: 'absolute',
      width: 278,
      height: 278,
      borderRadius: 139,
    },
    sheetGrabberWrap: {
      alignItems: 'center',
      paddingTop: 10,
      paddingBottom: 4,
    },
    sheetGrabber: {
      width: 40,
      height: 4.5,
      borderRadius: 999,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(24,29,37,0.22)',
    },
    safe: {
      flex: 1,
      paddingHorizontal: 20,
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
    artShadowWrap: {
      alignSelf: 'center',
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: colors.isDark ? 0.65 : 0.18,
      shadowRadius: 30,
      elevation: 12,
    },
    artwork: {
      width: 256,
      height: 256,
      borderRadius: 28,
      backgroundColor: colors.surface,
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
    transportWrap: {
      position: 'relative',
      borderRadius: 40,
      minHeight: 78,
      justifyContent: 'center',
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
  });
