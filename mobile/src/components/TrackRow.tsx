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
  /** Optional index for smooth staggered top-to-bottom reveal animation */
  index?: number;
  /** Override stagger delay index (useful when appending new tracks) */
  staggerIndex?: number;
  /** Change this key (e.g. session ID) to replay the cascade animation */
  animationKey?: string | number;
}

export const TrackRow: React.FC<Props> = ({
  track,
  isPlaying,
  isActiveTrack,
  onPlayPress,
  onToggleFavorite,
  index = 0,
  staggerIndex,
  animationKey,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const effectiveStaggerIndex = staggerIndex ?? index;
  const indexRef = useRef(effectiveStaggerIndex);
  indexRef.current = effectiveStaggerIndex;

  const opacity = useRef(new Animated.Value(animationKey !== undefined ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(animationKey !== undefined ? -16 : 0)).current;
  const scale = useRef(new Animated.Value(animationKey !== undefined ? 0.96 : 1)).current;

  useEffect(() => {
    if (animationKey === undefined) return;
    opacity.setValue(0);
    translateY.setValue(-16);
    scale.setValue(0.96);

    const delay = Math.min(indexRef.current, 14) * 48;
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 340,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        delay,
        damping: 18,
        stiffness: 170,
        mass: 0.75,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        delay,
        damping: 18,
        stiffness: 180,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animationKey, opacity, scale, translateY]);

  const handleExternalOpen = () => {
    const target = track.storeUrl || track.youtubeUrl;
    if (target) {
      Linking.openURL(target).catch(() => {});
    }
  };

  return (
    <Animated.View
      style={[
        styles.card,
        isActiveTrack && styles.cardActive,
        {
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPlayPress();
        }}
        style={({ pressed }) => [styles.coverWrap, pressed && { transform: [{ scale: 0.93 }] }]}
      >
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
      </Pressable>

      <Pressable onPress={onPlayPress} style={styles.metaCol}>
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
      </Pressable>

      <View style={styles.actionsRow}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onToggleFavorite();
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && { transform: [{ scale: 0.85 }] }]}
        >
          <Ionicons
            name={track.isFavorite ? 'heart' : 'heart-outline'}
            size={21}
            color={track.isFavorite ? colors.brand : colors.inkMuted}
          />
        </Pressable>

        <Pressable
          onPress={handleExternalOpen}
          hitSlop={6}
          style={({ pressed }) => [styles.openPill, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="open-outline" size={15} color={colors.inkSecondary} />
        </Pressable>
      </View>
    </Animated.View>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.elevated,
      borderRadius: 16,
      padding: 9,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.hairline,
      gap: 11,
    },
    cardActive: {
      backgroundColor: colors.brandSoft,
      borderColor: colors.brand,
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
