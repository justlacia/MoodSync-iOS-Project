import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
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
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { SpringPressable } from './MotionPrimitives';

interface Props {
  track: TrackRecord | null;
  visible: boolean;
  playlistName?: string;
  onClose: () => void;
  onToggleFavorite: (trackId: number) => void;
  onAddToPlaylist: (track: TrackRecord) => void;
  onDislike: (track: TrackRecord) => void;
  onRemoveFromPlaylist?: (track: TrackRecord) => void;
}

export const TrackActionSheetModal: React.FC<Props> = ({
  track,
  visible,
  playlistName,
  onClose,
  onToggleFavorite,
  onAddToPlaylist,
  onDislike,
  onRemoveFromPlaylist,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!track) return null;

  const openUrl = (url: string) => {
    Haptics.selectionAsync().catch(() => {});
    onClose();
    Linking.openURL(url).catch(() => {});
  };

  const handleShare = async () => {
    Haptics.selectionAsync().catch(() => {});
    onClose();
    const link = buildAppleMusicUrl(track);
    try {
      await Share.share({
        message: `🎵 ${track.title} — ${track.artist}\n${link}`,
      });
    } catch {
      // User dismissed share sheet
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />

          {/* Track Summary Header */}
          <View style={styles.trackHeader}>
            {track.artworkUrl ? (
              <Image source={{ uri: track.artworkUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverFallback]}>
                <Ionicons name="musical-notes" size={20} color={colors.brand} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.trackTitle}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={styles.trackArtist}>
                {track.artist} · {track.genre}
              </Text>
            </View>
            <SpringPressable
              haptic
              onPress={() => onToggleFavorite(track.id)}
              style={styles.favPill}
            >
              <Ionicons
                name={track.isFavorite ? 'heart' : 'heart-outline'}
                size={20}
                color={track.isFavorite ? colors.brand : colors.inkSecondary}
              />
            </SpringPressable>
          </View>

          {/* Main Actions */}
          <View style={styles.group}>
            <SpringPressable
              haptic
              onPress={() => {
                onClose();
                onAddToPlaylist(track);
              }}
              style={styles.actionRow}
            >
              <View style={[styles.actionIcon, { backgroundColor: colors.brandSoft }]}>
                <Ionicons name="list-outline" size={18} color={colors.brand} />
              </View>
              <Text style={styles.actionText}>Çalma Listesine Ekle</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
            </SpringPressable>

            <SpringPressable haptic onPress={handleShare} style={styles.actionRow}>
              <View style={[styles.actionIcon, { backgroundColor: colors.subtle }]}>
                <Ionicons name="share-outline" size={18} color={colors.inkPrimary} />
              </View>
              <Text style={styles.actionText}>Şarkıyı Paylaş</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
            </SpringPressable>

            {onRemoveFromPlaylist && (
              <SpringPressable
                haptic
                onPress={() => {
                  onClose();
                  onRemoveFromPlaylist(track);
                }}
                style={styles.actionRow}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.dangerSoft }]}>
                  <Ionicons name="remove-circle-outline" size={18} color={colors.danger} />
                </View>
                <Text style={[styles.actionText, { color: colors.danger }]}>
                  {playlistName ? `“${playlistName}” Listesinden Çıkar` : 'Bu Listeden Çıkar'}
                </Text>
              </SpringPressable>
            )}
          </View>

          {/* External Platform Links */}
          <Text style={styles.sectionLabel}>DIŞ PLATFORMDA DİNLE</Text>
          <View style={styles.platformRow}>
            <SpringPressable
              haptic
              onPress={() => openUrl(buildAppleMusicUrl(track))}
              style={styles.platformBtn}
            >
              <Ionicons name="logo-apple" size={16} color={colors.inkPrimary} />
              <Text style={styles.platformText}>Apple Music</Text>
            </SpringPressable>

            <SpringPressable
              haptic
              onPress={() => openUrl(buildSpotifySearchUrl(track.artist, track.title))}
              style={styles.platformBtn}
            >
              <Ionicons name="disc-outline" size={16} color="#1DB954" />
              <Text style={styles.platformText}>Spotify</Text>
            </SpringPressable>

            <SpringPressable
              haptic
              onPress={() => openUrl(buildYoutubeMusicUrl(track.artist, track.title))}
              style={styles.platformBtn}
            >
              <Ionicons name="logo-youtube" size={16} color="#FF3B30" />
              <Text style={styles.platformText}>YT Music</Text>
            </SpringPressable>
          </View>

          {/* Dislike ("Never Recommend Again") */}
          <SpringPressable
            haptic
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
              onClose();
              onDislike(track);
            }}
            style={styles.dislikeBtn}
          >
            <Ionicons name="eye-off-outline" size={18} color={colors.danger} />
            <Text style={styles.dislikeText}>Bir Daha Önerme</Text>
          </SpringPressable>

          <SpringPressable haptic onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Kapat</Text>
          </SpringPressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.62)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    handle: {
      alignSelf: 'center',
      width: 38,
      height: 4.5,
      borderRadius: 999,
      backgroundColor: colors.hairlineStrong,
      marginBottom: 14,
    },
    trackHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
      marginBottom: 12,
    },
    cover: {
      width: 50,
      height: 50,
      borderRadius: 12,
      backgroundColor: colors.subtle,
    },
    coverFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    trackTitle: {
      fontSize: 15.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    trackArtist: {
      marginTop: 2,
      fontSize: 12.5,
      color: colors.inkSecondary,
    },
    favPill: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    group: {
      backgroundColor: colors.elevated,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
      marginBottom: 14,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: 13,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.hairline,
    },
    actionIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionText: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    sectionLabel: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.7,
      color: colors.inkMuted,
      marginBottom: 8,
    },
    platformRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    platformBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      borderRadius: 13,
      paddingVertical: 11,
    },
    platformText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    dislikeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.dangerSoft,
      borderRadius: 14,
      paddingVertical: 12,
      marginBottom: 8,
    },
    dislikeText: {
      fontSize: 13.5,
      fontWeight: '800',
      color: colors.danger,
    },
    cancelBtn: {
      alignItems: 'center',
      paddingVertical: 11,
    },
    cancelText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
  });
