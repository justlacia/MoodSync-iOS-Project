import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Alert, Animated, Easing, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SpringPressable, StaggeredEntry } from '../components/MotionPrimitives';
import { DashboardStats, ScanSessionRecord, TrackRecord } from '../database/iosDatabase';
import { EmotionType, MoodStrategy, resolveMoodVisual, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { ScanDetailScreen } from './ScanDetailScreen';

interface Props {
  sessions: ScanSessionRecord[];
  selectedSession: ScanSessionRecord | null;
  stats: DashboardStats;
  isActiveTab: boolean;
  playingTrackId: number | null;
  isAudioPlaying: boolean;
  onOpenSession: (sessionId: number) => void;
  onCloseSession: () => void;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onToggleFavorite: (trackId: number) => void;
  onTrackMorePress: (track: TrackRecord) => void;
  onUpdateSessionMoodOrStrategy: (params: {
    sessionId: number;
    emotion?: EmotionType;
    strategy?: MoodStrategy;
    language?: 'all' | 'tr' | 'global';
    isManualOverride?: boolean;
  }) => Promise<void>;
  onUpdateSessionJournal: (sessionId: number, note: string, tags: string[]) => Promise<void>;
  onSaveTracksToPlaylist: (tracks: TrackRecord[], suggestedName: string) => void;
  onExpandSessionTracks: (
    sessionId: number,
    addCount: number,
    language: 'all' | 'tr' | 'global'
  ) => Promise<{ addedCount: number; totalCount: number } | null>;
  onDeleteSession: (sessionId: number) => void;
  onNewScan: () => void;
}

export const HistoryScreen: React.FC<Props> = React.memo(({
  sessions,
  selectedSession,
  stats,
  isActiveTab,
  playingTrackId,
  isAudioPlaying,
  onOpenSession,
  onCloseSession,
  onPlayTrack,
  onToggleFavorite,
  onTrackMorePress,
  onUpdateSessionMoodOrStrategy,
  onUpdateSessionJournal,
  onSaveTracksToPlaylist,
  onExpandSessionTracks,
  onDeleteSession,
  onNewScan,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const showingDetail = Boolean(selectedSession);
  const slideX = useRef(new Animated.Value(0)).current;
  const viewOpacity = useRef(new Animated.Value(1)).current;
  const prevShowingDetail = useRef(showingDetail);
  const prevActiveTabRef = useRef(isActiveTab);
  const detailAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const returningFromDetail =
    prevShowingDetail.current && !showingDetail && prevActiveTabRef.current && isActiveTab;
  const enteringDetailFromTab =
    !prevShowingDetail.current && showingDetail && prevActiveTabRef.current && isActiveTab;

  useLayoutEffect(() => {
    const wasActiveTab = prevActiveTabRef.current;
    prevActiveTabRef.current = isActiveTab;

    if (prevShowingDetail.current === showingDetail) return;
    const enteringDetail = showingDetail;
    prevShowingDetail.current = showingDetail;

    detailAnimRef.current?.stop();

    if (!wasActiveTab || !isActiveTab) {
      slideX.setValue(0);
      viewOpacity.setValue(1);
      detailAnimRef.current = null;
      return;
    }

    slideX.setValue(enteringDetail ? 28 : -28);
    viewOpacity.setValue(0.35);

    const anim = Animated.parallel([
      Animated.timing(viewOpacity, {
        toValue: 1,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(slideX, {
        toValue: 0,
        damping: 20,
        stiffness: 210,
        mass: 0.8,
        useNativeDriver: true,
      }),
    ]);
    detailAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && detailAnimRef.current === anim) {
        detailAnimRef.current = null;
      }
    });
  }, [isActiveTab, showingDetail, slideX, viewOpacity]);

  useEffect(() => {
    return () => {
      detailAnimRef.current?.stop();
    };
  }, []);

  const formatDate = useCallback((iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }, []);

  const confirmDelete = useCallback(
    (sessionId: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      Alert.alert(
        'Taramayı Sil',
        'Bu geçmiş tarama ve ona ait şarkı listesi kalıcı olarak silinsin mi?',
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Sil',
            style: 'destructive',
            onPress: () => onDeleteSession(sessionId),
          },
        ]
      );
    },
    [onDeleteSession]
  );

  if (selectedSession) {
    return (
      <Animated.View
        style={{
          flex: 1,
          opacity: viewOpacity,
          transform: [{ translateX: slideX }],
        }}
      >
        <ScanDetailScreen
          session={selectedSession}
          playingTrackId={playingTrackId}
          isAudioPlaying={isAudioPlaying}
          isActiveTab={isActiveTab}
          skipInitialEntrance={enteringDetailFromTab}
          onBack={onCloseSession}
          onPlayTrack={onPlayTrack}
          onToggleFavorite={onToggleFavorite}
          onTrackMorePress={onTrackMorePress}
          onUpdateMoodOrStrategy={onUpdateSessionMoodOrStrategy}
          onUpdateJournal={onUpdateSessionJournal}
          onSaveTracksToPlaylist={onSaveTracksToPlaylist}
          onExpandTracks={onExpandSessionTracks}
          onDeleteSession={(id) => {
            onDeleteSession(id);
            onCloseSession();
          }}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: viewOpacity,
        transform: [{ translateX: slideX }],
      }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerWrap}>
          <StaggeredEntry
            index={0}
            active={isActiveTab}
            enabled={!returningFromDetail}
            style={styles.topRow}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Geçmiş Taramalar</Text>
              <Text style={styles.subtitle}>
                Daha önce çektiğin fotoğraflar ve o anki moduna özel oluşturulan şarkı listeleri.
              </Text>
            </View>
            <SpringPressable
              haptic
              onPress={onNewScan}
              style={styles.newScanBtn}
            >
              <Ionicons name="camera" size={16} color="#FFFFFF" />
              <Text style={styles.newScanText}>Yeni Çekim</Text>
            </SpringPressable>
          </StaggeredEntry>

          <View style={styles.statsGrid}>
            <StaggeredEntry
              index={1}
              active={isActiveTab}
              enabled={!returningFromDetail}
              style={styles.statTile}
            >
              <Text style={styles.statLabel}>Toplam Tarama</Text>
              <Text style={styles.statVal}>{stats.totalScans}</Text>
            </StaggeredEntry>
            <StaggeredEntry
              index={1}
              active={isActiveTab}
              enabled={!returningFromDetail}
              style={styles.statTile}
            >
              <Text style={styles.statLabel}>Baskın Mod</Text>
              <Text style={styles.statVal}>
                {stats.dominantMood
                  ? resolveMoodVisual(stats.dominantMood, stats.dominantEmotion, colors).shortTr
                  : '—'}
              </Text>
            </StaggeredEntry>
            <StaggeredEntry
              index={2}
              active={isActiveTab}
              enabled={!returningFromDetail}
              style={styles.statTile}
            >
              <Text style={styles.statLabel}>Favori Şarkılar</Text>
              <Text style={styles.statVal}>{stats.favoriteCount}</Text>
            </StaggeredEntry>
            <StaggeredEntry
              index={2}
              active={isActiveTab}
              enabled={!returningFromDetail}
              style={styles.statTile}
            >
              <Text style={styles.statLabel}>Şarkı Havuzu</Text>
              <Text style={styles.statVal}>{stats.catalogTotal}</Text>
            </StaggeredEntry>
          </View>
        </View>

        {sessions.length === 0 ? (
          <StaggeredEntry
            index={3}
            active={isActiveTab}
            enabled={!returningFromDetail}
            style={styles.emptyBox}
          >
            <Ionicons name="time-outline" size={36} color={colors.inkMuted} />
            <Text style={styles.emptyTitle}>Henüz kayıtlı bir tarama yok</Text>
            <Text style={styles.emptyDesc}>
              Kamera sekmesinden fotoğraf çektiğinde tüm geçmiş session kayıtların burada saklanır.
            </Text>
          </StaggeredEntry>
        ) : (
          sessions.map((item, idx) => {
            const meta = resolveMoodVisual(item.mood, item.emotion, colors);
            const isFront = item.deviceLabel.toLowerCase().includes('ön kamera');
            const tags = item.tags || [];
            const note = (item.note || '').trim();
            return (
              <StaggeredEntry
                key={item.id}
                index={Math.min(idx + 3, 6)}
                active={isActiveTab}
                enabled={!returningFromDetail && idx < 5}
                style={styles.card}
              >
                <SpringPressable
                  haptic
                  scaleTo={0.985}
                  onPress={() => onOpenSession(item.id)}
                  style={styles.cardTop}
                >
                  {item.snapshotUri ? (
                    <Image
                      source={{ uri: item.snapshotUri }}
                      style={[styles.thumb, isFront && styles.mirroredImage]}
                    />
                  ) : (
                    <View style={[styles.thumb, styles.thumbFallback]}>
                      <Ionicons name="sparkles" size={22} color={meta.color} />
                    </View>
                  )}

                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeRow}>
                      <View style={[styles.moodTag, { backgroundColor: meta.softColor }]}>
                        <Text style={[styles.moodTagText, { color: meta.color }]}>{meta.fullTr}</Text>
                      </View>
                      <Text style={styles.confLabel}>%{Math.round(item.confidence * 100)}</Text>
                      {item.moodStrategy === 'uplift' && (
                        <View style={styles.upliftPill}>
                          <Text style={styles.upliftPillText}>Yükselt</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.deviceText}>{item.deviceLabel}</Text>
                    <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
                </SpringPressable>

                {(tags.length > 0 || note.length > 0) && (
                  <View style={styles.journalPreview}>
                    {tags.length > 0 && (
                      <View style={styles.tagMiniRow}>
                        {tags.slice(0, 3).map((tag) => (
                          <View key={tag} style={styles.tagMiniPill}>
                            <Text style={styles.tagMiniText}>#{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {note.length > 0 && (
                      <Text numberOfLines={1} style={styles.noteSnippet}>
                        “{note}”
                      </Text>
                    )}
                  </View>
                )}

                <View style={styles.cardFooter}>
                  <SpringPressable
                    haptic
                    onPress={() => onOpenSession(item.id)}
                    style={styles.openBtn}
                  >
                    <Ionicons name="musical-notes-outline" size={16} color={colors.inkPrimary} />
                    <Text style={styles.openBtnText}>Şarkı Listesini Aç ({item.trackCount})</Text>
                  </SpringPressable>

                  <SpringPressable
                    onPress={() => confirmDelete(item.id)}
                    style={styles.deleteBtn}
                  >
                    <Ionicons name="trash-outline" size={17} color={colors.inkMuted} />
                  </SpringPressable>
                </View>
              </StaggeredEntry>
            );
          })
        )}
      </ScrollView>
    </Animated.View>
  );
});

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 150,
    },
    mirroredImage: {
      transform: [{ scaleX: -1 }],
    },
    headerWrap: {
      marginBottom: 14,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 16,
    },
    title: {
      fontSize: 23,
      fontWeight: '800',
      letterSpacing: -0.6,
      color: colors.inkPrimary,
    },
    subtitle: {
      marginTop: 4,
      fontSize: 13,
      color: colors.inkSecondary,
      lineHeight: 18,
    },
    newScanBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brand,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
    },
    newScanText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    statTile: {
      width: '48%',
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    statLabel: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.inkMuted,
    },
    statVal: {
      marginTop: 4,
      fontSize: 20,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 32,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    emptyTitle: {
      marginTop: 10,
      fontSize: 16,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    emptyDesc: {
      marginTop: 6,
      fontSize: 13,
      color: colors.inkSecondary,
      textAlign: 'center',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 14,
      marginBottom: 11,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    thumb: {
      width: 64,
      height: 64,
      borderRadius: 14,
      backgroundColor: colors.subtle,
    },
    thumbFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
      flexWrap: 'wrap',
    },
    moodTag: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
    },
    moodTagText: {
      fontSize: 11,
      fontWeight: '800',
    },
    confLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    upliftPill: {
      backgroundColor: colors.brandSoft,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
    },
    upliftPillText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.brand,
    },
    deviceText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    dateText: {
      fontSize: 12,
      color: colors.inkMuted,
      marginTop: 1,
    },
    journalPreview: {
      marginTop: 10,
      paddingTop: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.hairline,
      gap: 5,
    },
    tagMiniRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 5,
    },
    tagMiniPill: {
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
    },
    tagMiniText: {
      fontSize: 10.5,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    noteSnippet: {
      fontSize: 12,
      color: colors.inkSecondary,
      fontStyle: 'italic',
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    openBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.subtle,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 10,
    },
    openBtnText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    deleteBtn: {
      width: 34,
      height: 34,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
