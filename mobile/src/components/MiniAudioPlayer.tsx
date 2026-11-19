import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { TrackRecord } from '../database/iosDatabase';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const slideY = useRef(new Animated.Value(36)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!track) return;
    slideY.setValue(28);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(slideY, {
        toValue: 0,
        damping: 18,
        stiffness: 190,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start();
  }, [track?.id, opacity, slideY]);

  if (!track) return null;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          opacity,
          transform: [{ translateY: slideY }],
        },
      ]}
    >
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(100, Math.max(2, progressRatio * 100))}%` },
          ]}
        />
      </View>

      <View style={styles.row}>
        {track.artworkUrl ? (
          <Image source={{ uri: track.artworkUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverFallback]}>
            <Ionicons name="musical-notes" size={18} color={colors.brand} />
          </View>
        )}

        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.title}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.artist}>
            {track.artist}
          </Text>
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={onTogglePlay}
            style={({ pressed }) => [styles.playBtn, pressed && { transform: [{ scale: 0.9 }] }]}
            hitSlop={8}
          >
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={onNext} style={styles.auxBtn} hitSlop={8}>
            <Ionicons name="play-skip-forward" size={19} color={colors.inkPrimary} />
          </Pressable>
          <Pressable onPress={onClose} style={styles.auxBtn} hitSlop={8}>
            <Ionicons name="close" size={19} color={colors.inkMuted} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    wrapper: {
      marginHorizontal: 12,
      marginBottom: 8,
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: colors.isDark ? 0.45 : 0.12,
      shadowRadius: 20,
      elevation: 8,
      overflow: 'hidden',
    },
    progressTrack: {
      height: 3,
      backgroundColor: colors.subtle,
      width: '100%',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.brand,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 9,
      gap: 10,
    },
    cover: {
      width: 42,
      height: 42,
      borderRadius: 10,
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
    title: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    artist: {
      fontSize: 12,
      color: colors.inkSecondary,
      marginTop: 1,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    playBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    auxBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
