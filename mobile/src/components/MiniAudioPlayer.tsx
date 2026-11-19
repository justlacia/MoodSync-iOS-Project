import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { TrackRecord } from '../database/iosDatabase';
import { Colors } from '../theme/colors';

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
  if (!track) return null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(2, progressRatio * 100))}%` }]} />
      </View>

      <View style={styles.row}>
        {track.artworkUrl ? (
          <Image source={{ uri: track.artworkUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverFallback]}>
            <Ionicons name="musical-notes" size={18} color={Colors.brand} />
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
          <Pressable onPress={onTogglePlay} style={styles.playBtn} hitSlop={8}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={onNext} style={styles.auxBtn} hitSlop={8}>
            <Ionicons name="play-skip-forward" size={19} color={Colors.inkPrimary} />
          </Pressable>
          <Pressable onPress={onClose} style={styles.auxBtn} hitSlop={8}>
            <Ionicons name="close" size={19} color={Colors.inkMuted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.hairlineStrong,
    shadowColor: '#181D25',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  progressTrack: {
    height: 3,
    backgroundColor: Colors.subtle,
    width: '100%',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.brand,
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
    backgroundColor: Colors.subtle,
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
    color: Colors.inkPrimary,
  },
  artist: {
    fontSize: 12,
    color: Colors.inkSecondary,
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
    backgroundColor: Colors.brand,
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
