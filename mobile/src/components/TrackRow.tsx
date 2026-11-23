import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { TrackRecord } from '../database/iosDatabase';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  track: TrackRecord;
  isPlaying: boolean;
  isActiveTrack: boolean;
  onPlayPress: () => void;
  onToggleFavorite: () => void;
  onMorePress?: () => void;
  /** Optional index for smooth staggered top-to-bottom reveal animation */
  index?: number;
  /** Override stagger delay index (useful when appending new tracks) */
  staggerIndex?: number;
  /** Change this key (e.g. session ID) to replay the cascade animation */
  animationKey?: string | number;
}

const stylesCache = new WeakMap<ThemePalette, ReturnType<typeof createStyles>>();

function getTrackRowStyles(colors: ThemePalette) {
  let cached = stylesCache.get(colors);
  if (!cached) {
    cached = createStyles(colors);
    stylesCache.set(colors, cached);
  }
  return cached;
}

export const TrackRow: React.FC<Props> = React.memo(({
  track,
  isPlaying,
  isActiveTrack,
  onPlayPress,
  onToggleFavorite,
  onMorePress,
  index = 0,
  staggerIndex,
  animationKey,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => getTrackRowStyles(colors), [colors]);

  const effectiveStaggerIndex = staggerIndex ?? index;
  const shouldAnimate = animationKey !== undefined && effectiveStaggerIndex < 8;
  const indexRef = useRef(effectiveStaggerIndex);
  indexRef.current = effectiveStaggerIndex;
  const shouldAnimateRef = useRef(shouldAnimate);
  shouldAnimateRef.current = shouldAnimate;

  const opacity = useRef(new Animated.Value(shouldAnimate ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(shouldAnimate ? -8 : 0)).current;

  useEffect(() => {
    if (animationKey === undefined || !shouldAnimateRef.current) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    opacity.setValue(0);
    translateY.setValue(-8);

    const delay = indexRef.current * 20;
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animationKey, opacity, translateY]);

  const handlePlayPress = () => {
    Haptics.selectionAsync().catch(() => {});
    onPlayPress();
  };

  const handleExternalOpen = () => {
    const target = track.storeUrl || track.youtubeUrl;
    if (target) {
      Linking.openURL(target).catch(() => {});
    }
  };

  return (
    <Animated.View
      style={[
        styles.cardOuter,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable
        onPress={handlePlayPress}
        style={({ pressed }) => [
          styles.card,
          isActiveTrack && styles.cardActive,
          pressed && styles.cardPressed,
        ]}
      >
        <View style={styles.coverWrap}>
          {track.artworkUrl ? (
            <Image source={{ uri: track.artworkUrl }} style={styles.coverImg} />
          ) : (
            <View style={[styles.coverImg, styles.coverFallback]}>
              <Ionicons name="musical-notes" size={20} color={colors.brand} />
            </View>
          )}
          <View style={[styles.playOverlay, isActiveTrack && styles.playOverlayVisible]}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#FFFFFF" />
          </View>
        </View>

        <View style={styles.metaCol}>
          <Text numberOfLines={1} style={[styles.title, isActiveTrack && { color: colors.brand }]}>
            {track.title}
          </Text>
          <View style={styles.subRow}>
            <View style={styles.langBadge}>
              <Text style={styles.langText}>{track.language === 'tr' ? 'TR' : 'INT'}</Text>
            </View>
            <Text numberOfLines={1} style={styles.artistGenre}>
              {track.artist} · {track.genre}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onToggleFavorite();
            }}
            hitSlop={4}
            style={({ pressed }) => [styles.iconBtn, pressed && { transform: [{ scale: 0.85 }] }]}
          >
            <Ionicons
              name={track.isFavorite ? 'heart' : 'heart-outline'}
              size={21}
              color={track.isFavorite ? colors.brand : colors.inkMuted}
            />
          </Pressable>

          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              if (onMorePress) {
                Haptics.selectionAsync().catch(() => {});
                onMorePress();
              } else {
                handleExternalOpen();
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 6 }}
            style={({ pressed }) => [styles.openPill, pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name={onMorePress ? 'ellipsis-horizontal' : 'open-outline'}
              size={15}
              color={colors.inkSecondary}
            />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    cardOuter: {
      marginBottom: 8,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 70,
      backgroundColor: colors.elevated,
      borderRadius: 16,
      padding: 9,
      borderWidth: 1,
      borderColor: colors.hairline,
      gap: 11,
    },
    cardActive: {
      backgroundColor: colors.brandSoft,
      borderColor: colors.brand,
    },
    cardPressed: {
      opacity: 0.86,
      transform: [{ scale: 0.985 }],
    },
    coverWrap: {
      width: 50,
      height: 50,
      borderRadius: 11,
      overflow: 'hidden',
      backgroundColor: colors.subtle,
    },
    coverImg: {
      width: '100%',
      height: '100%',
    },
    coverFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    playOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.34)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    playOverlayVisible: {
      backgroundColor: 'rgba(226, 88, 52, 0.72)',
    },
    metaCol: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: 14.5,
      fontWeight: '700',
      color: colors.inkPrimary,
      marginBottom: 3,
    },
    subRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    langBadge: {
      backgroundColor: colors.subtle,
      paddingHorizontal: 5,
      paddingVertical: 1.5,
      borderRadius: 4,
    },
    langText: {
      fontSize: 9.5,
      fontWeight: '800',
      color: colors.inkMuted,
    },
    artistGenre: {
      flex: 1,
      fontSize: 12.5,
      color: colors.inkSecondary,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    iconBtn: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    openPill: {
      width: 30,
      height: 30,
      borderRadius: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
