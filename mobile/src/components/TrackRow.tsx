import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { TrackRecord } from '../database/iosDatabase';
import { Colors } from '../theme/colors';

interface Props {
  track: TrackRecord;
  isPlaying: boolean;
  isActiveTrack: boolean;
  onPlayPress: () => void;
  onToggleFavorite: () => void;
}

export const TrackRow: React.FC<Props> = ({
  track,
  isPlaying,
  isActiveTrack,
  onPlayPress,
  onToggleFavorite,
}) => {
  const handleExternalOpen = () => {
    const target = track.storeUrl || track.youtubeUrl;
    if (target) {
      Linking.openURL(target).catch(() => {});
    }
  };

  return (
    <View style={[styles.card, isActiveTrack && styles.cardActive]}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPlayPress();
        }}
        style={styles.coverWrap}
      >
        {track.artworkUrl ? (
          <Image source={{ uri: track.artworkUrl }} style={styles.coverImg} />
        ) : (
          <View style={[styles.coverImg, styles.coverFallback]}>
            <Ionicons name="musical-notes" size={20} color={Colors.brand} />
          </View>
        )}
        <View style={[styles.playOverlay, isActiveTrack && styles.playOverlayVisible]}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#FFFFFF" />
        </View>
      </Pressable>

      <Pressable onPress={onPlayPress} style={styles.metaCol}>
        <Text numberOfLines={1} style={[styles.title, isActiveTrack && { color: Colors.brand }]}>
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
          style={styles.iconBtn}
        >
          <Ionicons
            name={track.isFavorite ? 'heart' : 'heart-outline'}
            size={21}
            color={track.isFavorite ? Colors.brand : Colors.inkMuted}
          />
        </Pressable>

        <Pressable onPress={handleExternalOpen} hitSlop={6} style={styles.openPill}>
          <Ionicons name="open-outline" size={15} color={Colors.inkSecondary} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.elevated,
    borderRadius: 15,
    padding: 9,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 11,
  },
  cardActive: {
    backgroundColor: Colors.brandSoft,
    borderColor: 'rgba(226, 88, 52, 0.28)',
  },
  coverWrap: {
    width: 50,
    height: 50,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: Colors.subtle,
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
    backgroundColor: 'rgba(14, 16, 22, 0.36)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlayVisible: {
    backgroundColor: 'rgba(226, 88, 52, 0.65)',
  },
  metaCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14.5,
    fontWeight: '700',
    color: Colors.inkPrimary,
    marginBottom: 3,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  langBadge: {
    backgroundColor: Colors.subtle,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  langText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: Colors.inkMuted,
  },
  artistGenre: {
    flex: 1,
    fontSize: 12.5,
    color: Colors.inkSecondary,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
