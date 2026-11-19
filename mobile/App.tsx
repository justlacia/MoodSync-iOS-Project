import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedSplashScreen } from './src/components/AnimatedSplashScreen';
import { MiniAudioPlayer } from './src/components/MiniAudioPlayer';
import {
  DashboardStats,
  deleteScanSession,
  getDashboardStats,
  getDatabase,
  getSandboxStorageSummary,
  getScanSessionWithTracks,
  listScanSessions,
  logoutActiveUser,
  restoreActiveUser,
  ScanSessionRecord,
  toggleFavoriteTrack,
  TrackRecord,
  UserRecord,
  wipeAllLocalData,
} from './src/database/iosDatabase';
import { CameraStudioScreen } from './src/screens/CameraStudioScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { getAiEngineSummary } from './src/services/moodAiService';
import { resolvePlayablePreviewUrl } from './src/services/onlineMusicService';
import { ThemePalette } from './src/theme/colors';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

type TabKey = 'studio' | 'history' | 'library';

function MainAppContent() {
  const { colors, isDark, themeId, themes, setThemeId, cycleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [showSplash, setShowSplash] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('studio');

  const [sessions, setSessions] = useState<ScanSessionRecord[]>([]);
  const [activeSession, setActiveSession] = useState<ScanSessionRecord | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalScans: 0,
    dominantMood: null,
    favoriteCount: 0,
    catalogTotal: 0,
  });

  // Smooth tab transition animation
  const tabOpacity = useRef(new Animated.Value(1)).current;
  const tabTranslateY = useRef(new Animated.Value(0)).current;

  // Audio preview state (expo-audio)
  const player = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(player);
  const [queue, setQueue] = useState<TrackRecord[]>([]);
  const [queueIdx, setQueueIdx] = useState<number>(-1);
  const currentTrack = queueIdx >= 0 && queueIdx < queue.length ? queue[queueIdx] : null;

  // On-device Privacy, Theme & Storage Settings Modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storageInfo, setStorageInfo] = useState({ photoCount: 0, trackCount: 0, scanCount: 0 });
  const engineInfo = getAiEngineSummary();

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
    }).catch(() => {});

    (async () => {
      await getDatabase();
      const restored = await restoreActiveUser();
      if (restored) {
        setUser(restored);
      }
      setDbReady(true);
    })();
  }, []);

  const switchTab = useCallback(
    (next: TabKey) => {
      if (next === activeTab) return;
      Haptics.selectionAsync().catch(() => {});
      setActiveTab(next);
      tabOpacity.setValue(0);
      tabTranslateY.setValue(12);
      Animated.parallel([
        Animated.timing(tabOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(tabTranslateY, {
          toValue: 0,
          damping: 20,
          stiffness: 200,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [activeTab, tabOpacity, tabTranslateY]
  );

  const refreshUserWorkspace = useCallback(async (uid: number) => {
    try {
      const [scanRows, dash] = await Promise.all([listScanSessions(uid), getDashboardStats(uid)]);
      setSessions(scanRows);
      setStats(dash);
      if (scanRows.length > 0) {
        const latestFull = await getScanSessionWithTracks(scanRows[0].id, uid);
        setActiveSession((prev) => prev || latestFull);
      }
    } catch {
      // Ignore transient refresh error
    }
  }, []);

  useEffect(() => {
    if (user) {
      refreshUserWorkspace(user.id);
    }
  }, [refreshUserWorkspace, user]);

  // Auto-advance to next track when 30s preview finishes
  useEffect(() => {
    if (audioStatus.didJustFinish && queue.length > 0 && queueIdx + 1 < queue.length) {
      handlePlayFromQueue(queue, queueIdx + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioStatus.didJustFinish]);

  const handlePlayFromQueue = async (trackList: TrackRecord[], index: number) => {
    const target = trackList[index];
    if (!target) return;

    if (currentTrack && currentTrack.id === target.id) {
      if (audioStatus.playing) {
        player.pause();
      } else {
        player.play();
      }
      return;
    }

    setQueue(trackList);
    setQueueIdx(index);

    const streamUrl = await resolvePlayablePreviewUrl(target);
    if (!streamUrl) {
      Alert.alert('Önizleme Bulunamadı', 'Bu şarkı için dış bağlantıyı (sağdaki ikon) açabilirsiniz.');
      return;
    }

    player.replace({ uri: streamUrl });
    player.play();
  };

  const handleToggleFavorite = async (trackId: number) => {
    if (!user) return;
    const liked = await toggleFavoriteTrack(user.id, trackId);

    setActiveSession((prev) => {
      if (!prev?.tracks) return prev;
      return {
        ...prev,
        tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, isFavorite: liked } : t)),
      };
    });
    const dash = await getDashboardStats(user.id);
    setStats(dash);
  };

  const handleOpenPastSession = async (sessionId: number) => {
    if (!user) return;
    const full = await getScanSessionWithTracks(sessionId, user.id);
    if (full) {
      setActiveSession(full);
      switchTab('studio');
    }
  };

  const handleDeletePastSession = async (sessionId: number) => {
    if (!user) return;
    await deleteScanSession(sessionId, user.id);
    if (activeSession?.id === sessionId) {
      setActiveSession(null);
    }
    await refreshUserWorkspace(user.id);
  };

  const handleLogout = async () => {
    player.pause();
    setQueue([]);
    setQueueIdx(-1);
    setActiveSession(null);
    await logoutActiveUser();
    setUser(null);
  };

  const progressRatio =
    audioStatus.duration && audioStatus.duration > 0
      ? audioStatus.currentTime / audioStatus.duration
      : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {dbReady && !user && <LoginScreen onAuthenticated={(u) => setUser(u)} />}

      {dbReady && user && (
        <SafeAreaView style={styles.appSafe} edges={['top', 'left', 'right']}>
          {/* Top App Header */}
          <View style={styles.topHeader}>
            <View style={styles.brandRow}>
              <Image source={require('./assets/logo.png')} style={styles.headerLogo} />
              <View>
                <Text style={styles.headerBrand}>MoodSync</Text>
                <Text style={styles.headerSub}>{stats.catalogTotal} Online Şarkı</Text>
              </View>
            </View>

            <View style={styles.headerRight}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  cycleTheme();
                }}
                style={({ pressed }) => [styles.headerIconBtn, pressed && { transform: [{ scale: 0.92 }] }]}
                hitSlop={6}
              >
                <Ionicons
                  name={isDark ? 'moon' : 'sunny'}
                  size={18}
                  color={colors.brand}
                />
              </Pressable>

              <Pressable
                onPress={async () => {
                  Haptics.selectionAsync().catch(() => {});
                  const summary = await getSandboxStorageSummary().catch(() => ({
                    photoCount: 0,
                    trackCount: 0,
                    scanCount: 0,
                  }));
                  setStorageInfo(summary);
                  setSettingsOpen(true);
                }}
                style={({ pressed }) => [styles.headerIconBtn, pressed && { transform: [{ scale: 0.92 }] }]}
                hitSlop={6}
              >
                <Ionicons name="options-outline" size={19} color={colors.inkPrimary} />
              </Pressable>

              <Pressable onPress={handleLogout} style={styles.logoutPill}>
                <Text style={styles.logoutText}>Çıkış</Text>
              </Pressable>
            </View>
          </View>

          {/* Active Screen with smooth fade+slide transition */}
          <Animated.View
            style={{
              flex: 1,
              opacity: tabOpacity,
              transform: [{ translateY: tabTranslateY }],
            }}
          >
            {activeTab === 'studio' && (
              <CameraStudioScreen
                userId={user.id}
                userFirstName={user.displayName.split(' ')[0]}
                isActiveTab={activeTab === 'studio'}
                activeSession={activeSession}
                recentScans={sessions}
                playingTrackId={currentTrack?.id || null}
                isAudioPlaying={Boolean(audioStatus.playing)}
                onSessionCreated={(newSess) => {
                  setActiveSession(newSess);
                  refreshUserWorkspace(user.id);
                }}
                onSelectPastSession={handleOpenPastSession}
                onSeeAllHistory={() => switchTab('history')}
                onPlayTrack={handlePlayFromQueue}
                onToggleFavorite={handleToggleFavorite}
                onCatalogExpanded={() => refreshUserWorkspace(user.id)}
              />
            )}

            {activeTab === 'history' && (
              <HistoryScreen
                sessions={sessions}
                stats={stats}
                onOpenSession={handleOpenPastSession}
                onDeleteSession={handleDeletePastSession}
                onNewScan={() => switchTab('studio')}
              />
            )}

            {activeTab === 'library' && (
              <LibraryScreen
                userId={user.id}
                catalogTotal={stats.catalogTotal}
                playingTrackId={currentTrack?.id || null}
                isAudioPlaying={Boolean(audioStatus.playing)}
                onPlayTrack={handlePlayFromQueue}
                onToggleFavorite={handleToggleFavorite}
                onCatalogExpanded={() => refreshUserWorkspace(user.id)}
              />
            )}
          </Animated.View>

          {/* Floating Mini Player + iOS Bottom Tab Bar */}
          <SafeAreaView edges={['bottom']} style={styles.bottomDock}>
            <MiniAudioPlayer
              track={currentTrack}
              isPlaying={Boolean(audioStatus.playing)}
              progressRatio={progressRatio}
              onTogglePlay={() => {
                if (audioStatus.playing) player.pause();
                else player.play();
              }}
              onNext={() => {
                if (queueIdx + 1 < queue.length) {
                  handlePlayFromQueue(queue, queueIdx + 1);
                }
              }}
              onClose={() => {
                player.pause();
                setQueue([]);
                setQueueIdx(-1);
              }}
            />

            <View style={styles.tabBar}>
              {(
                [
                  { key: 'studio', label: 'Kamera', icon: 'camera-outline', activeIcon: 'camera' },
                  { key: 'history', label: 'Geçmiş', icon: 'time-outline', activeIcon: 'time' },
                  {
                    key: 'library',
                    label: 'Şarkılar',
                    icon: 'musical-notes-outline',
                    activeIcon: 'musical-notes',
                  },
                ] as const
              ).map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => switchTab(tab.key)}
                    style={({ pressed }) => [styles.tabItem, pressed && { transform: [{ scale: 0.92 }] }]}
                  >
                    <Ionicons
                      name={active ? tab.activeIcon : tab.icon}
                      size={22}
                      color={active ? colors.brand : colors.inkMuted}
                    />
                    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SafeAreaView>

          {/* On-Device Theme, Privacy & Storage Modal */}
          <Modal visible={settingsOpen} transparent animationType="fade">
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={styles.modalTitle}>Görünüm &amp; Gizlilik</Text>
                  <Text style={styles.modalDesc}>
                    iPhone 16 Pro OLED ekranına özel simsiyah ve koyu temalardan birini seçebilirsin.
                  </Text>

                  <Text style={styles.sectionMiniTitle}>TEMA SEÇİMİ</Text>
                  <View style={styles.themeGrid}>
                    {themes.map((t) => {
                      const selected = themeId === t.id;
                      return (
                        <Pressable
                          key={t.id}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            setThemeId(t.id);
                          }}
                          style={[
                            styles.themeCard,
                            selected && styles.themeCardSelected,
                          ]}
                        >
                          <View style={styles.themeTopRow}>
                            <View
                              style={[
                                styles.swatchCircle,
                                { backgroundColor: t.swatchBg, borderColor: t.swatchAccent },
                              ]}
                            >
                              <View
                                style={[styles.swatchInnerDot, { backgroundColor: t.swatchAccent }]}
                              />
                            </View>
                            {selected && (
                              <Ionicons name="checkmark-circle" size={18} color={colors.brand} />
                            )}
                          </View>
                          <Text style={styles.themeName}>{t.nameTr}</Text>
                          <Text numberOfLines={2} style={styles.themeDesc}>
                            {t.descTr}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.infoBox}>
                    <Text style={styles.infoLabel}>Aktif AI Motoru</Text>
                    <Text style={styles.infoValue}>{engineInfo.label}</Text>
                    <Text style={[styles.infoLabel, { marginTop: 10 }]}>
                      Uygulama İçi Veriler (Silinince Tamamen Temizlenir)
                    </Text>
                    <Text style={styles.infoValue}>
                      {storageInfo.photoCount} fotoğraf · {storageInfo.scanCount} tarama · {storageInfo.trackCount} şarkı
                    </Text>
                  </View>

                  <View style={styles.modalBtns}>
                    <Pressable
                      onPress={() => {
                        Alert.alert(
                          'Tüm Verileri Sil',
                          'Çekilen tüm fotoğraflar, tarama geçmişi, hesaplar ve yerel müzik veritabanı telefondan kalıcı olarak silinecek. Devam edilsin mi?',
                          [
                            { text: 'Vazgeç', style: 'cancel' },
                            {
                              text: 'Hepsini Sil',
                              style: 'destructive',
                              onPress: async () => {
                                player.pause();
                                setQueue([]);
                                setQueueIdx(-1);
                                setActiveSession(null);
                                setSessions([]);
                                await wipeAllLocalData();
                                setUser(null);
                                setSettingsOpen(false);
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                              },
                            },
                          ]
                        );
                      }}
                      style={styles.modalDangerBtn}
                    >
                      <Text style={styles.modalDangerText}>Tüm Verileri Sıfırla</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSettingsOpen(false)}
                      style={styles.modalSaveBtn}
                    >
                      <Text style={styles.modalSaveText}>Kapat</Text>
                    </Pressable>
                  </View>
                </ScrollView>
              </View>
            </View>
          </Modal>
        </SafeAreaView>
      )}

      {showSplash && <AnimatedSplashScreen onFinish={() => setShowSplash(false)} />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <MainAppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    appSafe: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    topHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
      backgroundColor: colors.canvas,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerLogo: {
      width: 36,
      height: 36,
      borderRadius: 10,
    },
    headerBrand: {
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: -0.4,
      color: colors.inkPrimary,
    },
    headerSub: {
      fontSize: 11,
      color: colors.inkMuted,
      fontWeight: '600',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerIconBtn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoutPill: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: colors.subtle,
    },
    logoutText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    bottomDock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.dockBg,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    tabBar: {
      flexDirection: 'row',
      paddingTop: 7,
      paddingBottom: 4,
    },
    tabItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    tabLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.inkMuted,
    },
    tabLabelActive: {
      color: colors.brand,
      fontWeight: '800',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 18,
    },
    modalCard: {
      width: '100%',
      maxHeight: '86%',
      backgroundColor: colors.surface,
      borderRadius: 24,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    modalTitle: {
      fontSize: 19,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    modalDesc: {
      marginTop: 5,
      fontSize: 13,
      color: colors.inkSecondary,
      lineHeight: 18,
      marginBottom: 14,
    },
    sectionMiniTitle: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.7,
      color: colors.inkMuted,
      marginBottom: 8,
    },
    themeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 9,
      marginBottom: 14,
    },
    themeCard: {
      width: '48%',
      borderRadius: 15,
      padding: 12,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    themeCardSelected: {
      borderColor: colors.brand,
      backgroundColor: colors.brandSoft,
    },
    themeTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    swatchCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatchInnerDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    themeName: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    themeDesc: {
      marginTop: 2,
      fontSize: 11,
      color: colors.inkSecondary,
      lineHeight: 14.5,
    },
    infoBox: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.elevated,
      padding: 14,
      marginBottom: 16,
    },
    infoLabel: {
      fontSize: 10.5,
      fontWeight: '700',
      color: colors.inkMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    infoValue: {
      marginTop: 3,
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    modalBtns: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
    },
    modalDangerBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 11,
      backgroundColor: colors.dangerSoft,
    },
    modalDangerText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.danger,
    },
    modalSaveBtn: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 11,
      backgroundColor: colors.brand,
    },
    modalSaveText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#FFFFFF',
    },
  });
