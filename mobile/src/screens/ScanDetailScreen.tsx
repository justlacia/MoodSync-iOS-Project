import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AnimatedSegmentedControl,
  SpringPressable,
  StaggeredEntry,
} from '../components/MotionPrimitives';
import { TrackRow } from '../components/TrackRow';
import { ScanSessionRecord, TrackRecord } from '../database/iosDatabase';
import { resolveMoodVisual, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  session: ScanSessionRecord;
  playingTrackId: number | null;
  isAudioPlaying: boolean;
  onBack: () => void;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onToggleFavorite: (trackId: number) => void;
  onExpandTracks: (
    sessionId: number,
    addCount: number,
    language: 'all' | 'tr' | 'global'
  ) => Promise<{ addedCount: number; totalCount: number } | null>;
  onDeleteSession: (sessionId: number) => void;
}

const EXPAND_PRESETS = [5, 10, 15] as const;

export const ScanDetailScreen: React.FC<Props> = ({
  session,
  playingTrackId,
  isAudioPlaying,
  onBack,
  onPlayTrack,
  onToggleFavorite,
  onExpandTracks,
  onDeleteSession,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [langFilter, setLangFilter] = useState<'all' | 'tr' | 'global'>('all');
  const [expandingCount, setExpandingCount] = useState<number | null>(null);
  const [expandNotice, setExpandNotice] = useState<string | null>(null);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [newlyAddedStartIndex, setNewlyAddedStartIndex] = useState<number | null>(null);

  const pendingExpandRef = useRef<{ sessionId: number; prevVisibleCount: number } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allTracks = session.tracks || [];
  const visibleTracks = useMemo(
    () =>
      allTracks.filter((tr) =>
        langFilter === 'all' ? true : tr.language === langFilter
      ),
    [allTracks, langFilter]
  );

  // Reset per-session transient state when opening another scan
  useEffect(() => {
    setLangFilter('all');
    setExpandNotice(null);
    setNewlyAddedStartIndex(null);
    pendingExpandRef.current = null;
  }, [session.id]);

  // Reset stagger cut-off when language tab changes
  useEffect(() => {
    setNewlyAddedStartIndex(null);
  }, [langFilter]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const showToast = (message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setExpandNotice(message);
    noticeTimerRef.current = setTimeout(() => {
      setExpandNotice(null);
    }, 3200);
  };

  const handleExpand = async (addCount: number) => {
    if (expandingCount !== null) return;
    Haptics.selectionAsync().catch(() => {});
    setExpandingCount(addCount);

    const prevCount = visibleTracks.length;
    pendingExpandRef.current = {
      sessionId: session.id,
      prevVisibleCount: prevCount,
    };

    try {
      const res = await onExpandTracks(session.id, addCount, langFilter);
      if (res && res.addedCount > 0) {
        if (pendingExpandRef.current?.sessionId === session.id) {
          setNewlyAddedStartIndex(pendingExpandRef.current.prevVisibleCount);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        showToast(`+${res.addedCount} yeni şarkı listeye eklendi · Toplam ${res.totalCount} şarkı`);
      } else {
        setNewlyAddedStartIndex(null);
        showToast('Bu filtre için tüm mevcut şarkılar zaten listede.');
      }
    } catch {
      showToast('Şarkılar eklenirken bir sorun oluştu.');
    } finally {
      pendingExpandRef.current = null;
      setExpandingCount(null);
    }
  };

  const confirmDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert(
      'Taramayı Sil',
      'Bu geçmiş tarama fotoğrafı ve şarkı listesi kalıcı olarak silinsin mi?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => onDeleteSession(session.id),
        },
      ]
    );
  };

  const meta = resolveMoodVisual(session.mood, session.emotion, colors);
  const mirrored = session.deviceLabel.toLowerCase().includes('ön kamera');

  const formatDateTR = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const emptyAddLabel =
    langFilter === 'tr'
      ? '+8 Türkçe Şarkı Ekle'
      : langFilter === 'global'
        ? '+8 Yabancı Şarkı Ekle'
        : '+8 Şarkı Ekle';

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Bar */}
        <View style={styles.navBar}>
          <SpringPressable haptic onPress={onBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.inkPrimary} />
            <Text style={styles.backBtnText}>Geçmiş</Text>
          </SpringPressable>

          <View style={styles.navCenter}>
            <Text style={styles.navTitle}>Tarama Detayı</Text>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{allTracks.length} şarkı</Text>
            </View>
          </View>

          <SpringPressable haptic onPress={confirmDelete} style={styles.deleteIconBtn}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </SpringPressable>
        </View>

        {/* Hero Photo & Mood Summary */}
        <StaggeredEntry index={0} animationKey={session.id} style={styles.heroCard}>
          <SpringPressable
            haptic
            scaleTo={0.96}
            disabled={!session.snapshotUri}
            onPress={() => setPhotoModalVisible(true)}
            style={styles.heroPhotoWrap}
          >
            {session.snapshotUri ? (
              <>
                <Image
                  source={{ uri: session.snapshotUri }}
                  style={[styles.heroPhoto, mirrored && styles.mirroredImage]}
                />
                <View style={styles.zoomBadge}>
                  <Ionicons name="expand-outline" size={12} color="#FFFFFF" />
                </View>
              </>
            ) : (
              <View style={[styles.heroPhoto, styles.heroPhotoFallback]}>
                <Ionicons name="sparkles" size={28} color={meta.color} />
              </View>
            )}
          </SpringPressable>

          <View style={styles.heroInfo}>
            <View style={styles.badgeRow}>
              <View style={[styles.moodPill, { backgroundColor: meta.softColor }]}>
                <Text style={[styles.moodPillText, { color: meta.color }]}>{meta.fullTr}</Text>
              </View>
              <Text style={styles.confText}>%{Math.round(session.confidence * 100)} güven</Text>
            </View>

            <Text style={styles.heroDate}>{formatDateTR(session.createdAt)}</Text>
            <Text style={styles.heroDevice}>{session.deviceLabel}</Text>
            <Text style={styles.heroMeta}>
              Toplam {allTracks.length} eşleşen şarkı · Taramaya özel liste
            </Text>
          </View>
        </StaggeredEntry>

        {/* Filter + Quick +8 Expand Toolbar */}
        <StaggeredEntry index={1} animationKey={session.id} style={styles.toolbar}>
          <AnimatedSegmentedControl<'all' | 'tr' | 'global'>
            compact
            value={langFilter}
            onChange={setLangFilter}
            options={[
              { key: 'all', label: 'Tümü' },
              { key: 'tr', label: 'Türkçe' },
              { key: 'global', label: 'Yabancı' },
            ]}
            style={{ flex: 1 }}
          />

          <SpringPressable
            haptic
            disabled={expandingCount !== null}
            onPress={() => handleExpand(8)}
            style={styles.quickAddBtn}
          >
            {expandingCount !== null ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Ionicons name="add-circle-outline" size={16} color={colors.brand} />
            )}
            <Text style={styles.quickAddText}>
              {expandingCount !== null ? 'Ekleniyor…' : '+8 Ekle'}
            </Text>
          </SpringPressable>
        </StaggeredEntry>

        {/* Expand Status Toast */}
        {expandNotice && (
          <View style={styles.toastBanner}>
            <Ionicons name="sparkles" size={15} color={colors.brand} />
            <Text style={styles.toastText}>{expandNotice}</Text>
          </View>
        )}

        {/* Session Playlist Card */}
        <View style={styles.playlistSection}>
          {visibleTracks.length === 0 ? (
            <View style={styles.emptyTracksBox}>
              <Ionicons name="musical-notes-outline" size={30} color={colors.inkMuted} />
              <Text style={styles.emptyTracksTitle}>Bu filtrede şarkı henüz yok</Text>
              <Text style={styles.emptyTracksSub}>
                Seçtiğin dil ve o anki ruh haline göre listeye hemen yeni şarkılar ekleyebilirsin.
              </Text>
              <SpringPressable
                haptic
                disabled={expandingCount !== null}
                onPress={() => handleExpand(8)}
                style={styles.emptyAddBtn}
              >
                {expandingCount !== null ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                )}
                <Text style={styles.emptyAddBtnText}>{emptyAddLabel}</Text>
              </SpringPressable>
            </View>
          ) : (
            visibleTracks.map((tr, idx) => (
              <TrackRow
                key={`${session.id}-${tr.id}`}
                track={tr}
                index={idx}
                staggerIndex={
                  newlyAddedStartIndex !== null && idx >= newlyAddedStartIndex
                    ? idx - newlyAddedStartIndex
                    : idx
                }
                animationKey={`${session.id}-${langFilter}`}
                isActiveTrack={playingTrackId === tr.id}
                isPlaying={playingTrackId === tr.id && isAudioPlaying}
                onPlayPress={() => onPlayTrack(visibleTracks, idx)}
                onToggleFavorite={() => onToggleFavorite(tr.id)}
              />
            ))
          )}
        </View>

        {/* Dedicated Expand Playlist Card */}
        <StaggeredEntry index={2} animationKey={session.id} style={styles.expandCard}>
          <View style={styles.expandHeader}>
            <View style={styles.expandIconCircle}>
              <Ionicons name="musical-notes" size={18} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.expandTitle}>Şarkı Sayısını Artır</Text>
              <Text style={styles.expandSub}>
                Bu taramadaki ruh haline göre yeni şarkılar bulup kalıcı olarak listeye ekle.
              </Text>
            </View>
          </View>

          <View style={styles.presetRow}>
            {EXPAND_PRESETS.map((cnt) => {
              const busyThis = expandingCount === cnt;
              return (
                <SpringPressable
                  key={cnt}
                  haptic
                  disabled={expandingCount !== null}
                  onPress={() => handleExpand(cnt)}
                  style={[
                    styles.presetBtn,
                    cnt === 10 && styles.presetBtnPrimary,
                    expandingCount !== null && !busyThis && { opacity: 0.6 },
                  ]}
                >
                  {busyThis ? (
                    <ActivityIndicator
                      size="small"
                      color={cnt === 10 ? '#FFFFFF' : colors.brand}
                    />
                  ) : (
                    <>
                      <Ionicons
                        name="add"
                        size={15}
                        color={cnt === 10 ? '#FFFFFF' : colors.brand}
                      />
                      <Text
                        style={[
                          styles.presetBtnText,
                          cnt === 10 && styles.presetBtnTextPrimary,
                        ]}
                      >
                        +{cnt} Şarkı
                      </Text>
                    </>
                  )}
                </SpringPressable>
              );
            })}
          </View>
        </StaggeredEntry>
      </ScrollView>

      {/* Fullscreen Photo Preview Modal */}
      <Modal
        visible={photoModalVisible && Boolean(session.snapshotUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setPhotoModalVisible(false)}
          />
          {session.snapshotUri && (
            <Image
              source={{ uri: session.snapshotUri }}
              resizeMode="contain"
              style={[styles.modalImage, mirrored && styles.mirroredImage]}
            />
          )}
          <SpringPressable
            haptic
            onPress={() => setPhotoModalVisible(false)}
            style={styles.modalClosePill}
          >
            <Ionicons name="close" size={18} color="#FFFFFF" />
            <Text style={styles.modalCloseText}>Kapat</Text>
          </SpringPressable>
        </View>
      </Modal>
    </>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 150,
    },
    mirroredImage: {
      transform: [{ scaleX: -1 }],
    },
    navBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
      gap: 10,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: 11,
      paddingVertical: 8,
      borderRadius: 999,
    },
    backBtnText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    navCenter: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    navTitle: {
      fontSize: 15.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    countPill: {
      backgroundColor: colors.brandSoft,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
    },
    countPillText: {
      fontSize: 11.5,
      fontWeight: '800',
      color: colors.brand,
    },
    deleteIconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.dangerSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 14,
    },
    heroPhotoWrap: {
      position: 'relative',
    },
    heroPhoto: {
      width: 96,
      height: 96,
      borderRadius: 18,
      backgroundColor: colors.subtle,
    },
    heroPhotoFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    zoomBadge: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.25)',
    },
    heroInfo: {
      flex: 1,
      minWidth: 0,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    moodPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    moodPillText: {
      fontSize: 11.5,
      fontWeight: '800',
    },
    confText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    heroDate: {
      fontSize: 14.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    heroDevice: {
      fontSize: 12.5,
      color: colors.inkSecondary,
      marginTop: 2,
    },
    heroMeta: {
      fontSize: 11.5,
      color: colors.inkMuted,
      marginTop: 5,
      fontWeight: '600',
    },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    quickAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: colors.brandSoft,
    },
    quickAddText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.brand,
    },
    toastBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.brandSoft,
      borderWidth: 1,
      borderColor: colors.brand,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 12,
      marginBottom: 12,
    },
    toastText: {
      flex: 1,
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    playlistSection: {
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 14,
    },
    emptyTracksBox: {
      alignItems: 'center',
      paddingVertical: 24,
      paddingHorizontal: 12,
    },
    emptyTracksTitle: {
      marginTop: 8,
      fontSize: 15,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    emptyTracksSub: {
      marginTop: 4,
      fontSize: 12.5,
      color: colors.inkSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    emptyAddBtn: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brand,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
    },
    emptyAddBtnText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    expandCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 15,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    expandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      marginBottom: 12,
    },
    expandIconCircle: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.brandSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    expandTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    expandSub: {
      fontSize: 12,
      color: colors.inkSecondary,
      marginTop: 2,
      lineHeight: 17,
    },
    presetRow: {
      flexDirection: 'row',
      gap: 8,
    },
    presetBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      backgroundColor: colors.brandSoft,
      paddingVertical: 11,
      borderRadius: 13,
    },
    presetBtnPrimary: {
      backgroundColor: colors.brand,
    },
    presetBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.brand,
    },
    presetBtnTextPrimary: {
      color: '#FFFFFF',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.92)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalImage: {
      width: '100%',
      height: '76%',
      borderRadius: 20,
    },
    modalClosePill: {
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(255, 255, 255, 0.16)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.28)',
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 999,
    },
    modalCloseText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
  });
