import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addTracksToPlaylist,
  createPlaylist,
  listUserPlaylists,
  PlaylistRecord,
  TrackRecord,
} from '../database/iosDatabase';
import { MoodType, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { SpringPressable } from './MotionPrimitives';

const PLAYLIST_ACCENTS = ['#FF6242', '#2ED1BF', '#639BFF', '#FFA047', '#7C6BFF'] as const;

interface Props {
  visible: boolean;
  userId: number;
  tracksToAdd: TrackRecord[];
  suggestedName?: string;
  suggestedMood?: MoodType | null;
  onClose: () => void;
  onCompleted: (playlist: PlaylistRecord, addedCount: number) => void;
}

export const PlaylistPickerModal: React.FC<Props> = ({
  visible,
  userId,
  tracksToAdd,
  suggestedName = '',
  suggestedMood = null,
  onClose,
  onCompleted,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | 'create' | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(PLAYLIST_ACCENTS[0]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setErrorMsg(null);
    setCreating(false);
    setNewName(suggestedName);
    setSelectedColor(PLAYLIST_ACCENTS[0]);
    setLoading(true);
    listUserPlaylists(userId)
      .then((rows) => {
        setPlaylists(rows);
        if (rows.length === 0) {
          setCreating(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [suggestedName, userId, visible]);

  const trackIds = useMemo(() => tracksToAdd.map((t) => t.id), [tracksToAdd]);

  const handleSelectPlaylist = async (pl: PlaylistRecord) => {
    if (busyId !== null) return;
    setErrorMsg(null);
    setBusyId(pl.id);
    try {
      const added = await addTracksToPlaylist(pl.id, userId, trackIds);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onCompleted({ ...pl, trackCount: pl.trackCount + added }, added);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Şarkı eklenemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAndAdd = async () => {
    if (busyId !== null) return;
    const clean = newName.trim();
    if (!clean) {
      setErrorMsg('Lütfen çalma listesi için bir ad yazın.');
      return;
    }
    setErrorMsg(null);
    setBusyId('create');
    try {
      const created = await createPlaylist({
        userId,
        name: clean,
        mood: suggestedMood,
        colorHex: selectedColor,
        initialTrackIds: trackIds,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onCompleted(created, created.trackCount);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Çalma listesi oluşturulamadı.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Çalma Listesine Ekle</Text>
                <Text style={styles.subtitle}>
                  {tracksToAdd.length === 1
                    ? `${tracksToAdd[0].title} · ${tracksToAdd[0].artist}`
                    : `${tracksToAdd.length} şarkıyı özel bir listeye kaydet`}
                </Text>
              </View>
              <SpringPressable haptic onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color={colors.inkSecondary} />
              </SpringPressable>
            </View>

            {errorMsg && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            {/* Create New Playlist Toggle / Inline Form */}
            {!creating ? (
              <SpringPressable
                haptic
                onPress={() => setCreating(true)}
                style={styles.newPlaylistTrigger}
              >
                <View style={styles.newIconCircle}>
                  <Ionicons name="add" size={19} color="#FFFFFF" />
                </View>
                <Text style={styles.newTriggerText}>Yeni Çalma Listesi Oluştur</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.brand} />
              </SpringPressable>
            ) : (
              <View style={styles.createCard}>
                <Text style={styles.createLabel}>YENİ ÇALMA LİSTESİ</Text>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Örn: Gece Sürüşü, Spor Enerjisi…"
                  placeholderTextColor={colors.inkMuted}
                  style={styles.input}
                  maxLength={50}
                  autoFocus={playlists.length === 0}
                />
                <View style={styles.colorRow}>
                  {PLAYLIST_ACCENTS.map((hex) => (
                    <Pressable
                      key={hex}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setSelectedColor(hex);
                      }}
                      style={[
                        styles.colorDot,
                        { backgroundColor: hex },
                        selectedColor === hex && styles.colorDotSelected,
                      ]}
                    />
                  ))}
                  <View style={{ flex: 1 }} />
                  {playlists.length > 0 && (
                    <SpringPressable
                      onPress={() => setCreating(false)}
                      style={styles.cancelCreateBtn}
                    >
                      <Text style={styles.cancelCreateText}>Vazgeç</Text>
                    </SpringPressable>
                  )}
                  <SpringPressable
                    haptic
                    disabled={busyId !== null}
                    onPress={handleCreateAndAdd}
                    style={styles.createConfirmBtn}
                  >
                    {busyId === 'create' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.createConfirmText}>Oluştur &amp; Ekle</Text>
                    )}
                  </SpringPressable>
                </View>
              </View>
            )}

            {/* Existing Playlists */}
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : (
              <ScrollView
                style={styles.listScroll}
                contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {playlists.map((pl) => {
                  const thumb = pl.coverArtworks[0];
                  const accent = pl.colorHex || colors.brand;
                  return (
                    <SpringPressable
                      key={pl.id}
                      haptic
                      disabled={busyId !== null}
                      onPress={() => handleSelectPlaylist(pl)}
                      style={styles.playlistRow}
                    >
                      {thumb ? (
                        <Image source={{ uri: thumb }} style={styles.plThumb} />
                      ) : (
                        <View style={[styles.plThumb, { backgroundColor: `${accent}26` }]}>
                          <Ionicons name="musical-notes" size={18} color={accent} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.plName}>
                          {pl.name}
                        </Text>
                        <Text style={styles.plCount}>{pl.trackCount} şarkı</Text>
                      </View>
                      {busyId === pl.id ? (
                        <ActivityIndicator size="small" color={colors.brand} />
                      ) : (
                        <Ionicons name="add-circle-outline" size={22} color={colors.brand} />
                      )}
                    </SpringPressable>
                  );
                })}
              </ScrollView>
            )}
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
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
      maxHeight: '82%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    handle: {
      alignSelf: 'center',
      width: 38,
      height: 4.5,
      borderRadius: 999,
      backgroundColor: colors.hairlineStrong,
      marginBottom: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 12.5,
      color: colors.inkSecondary,
    },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: colors.dangerSoft,
      padding: 10,
      borderRadius: 11,
      marginBottom: 10,
    },
    errorText: {
      flex: 1,
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.danger,
    },
    newPlaylistTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: colors.brandSoft,
      borderWidth: 1,
      borderColor: colors.brand,
      borderRadius: 15,
      padding: 11,
      marginBottom: 12,
    },
    newIconCircle: {
      width: 34,
      height: 34,
      borderRadius: 11,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newTriggerText: {
      flex: 1,
      fontSize: 14,
      fontWeight: '800',
      color: colors.brand,
    },
    createCard: {
      backgroundColor: colors.elevated,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      gap: 10,
      marginBottom: 12,
    },
    createLabel: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.7,
      color: colors.inkMuted,
    },
    input: {
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      fontSize: 14.5,
      color: colors.inkPrimary,
    },
    colorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    colorDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    colorDotSelected: {
      borderColor: colors.inkPrimary,
      transform: [{ scale: 1.12 }],
    },
    cancelCreateBtn: {
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    cancelCreateText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    createConfirmBtn: {
      backgroundColor: colors.brand,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 11,
    },
    createConfirmText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    loadingWrap: {
      paddingVertical: 28,
      alignItems: 'center',
    },
    listScroll: {
      maxHeight: 290,
    },
    playlistRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.elevated,
      borderRadius: 15,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    plThumb: {
      width: 44,
      height: 44,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.subtle,
    },
    plName: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    plCount: {
      marginTop: 2,
      fontSize: 12,
      color: colors.inkSecondary,
    },
  });
