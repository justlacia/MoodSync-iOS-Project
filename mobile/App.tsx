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
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedSplashScreen } from './src/components/AnimatedSplashScreen';
import { LiquidGlassTabBar } from './src/components/LiquidGlassTabBar';
import { MiniAudioPlayer } from './src/components/MiniAudioPlayer';
import { SpringPressable } from './src/components/MotionPrimitives';
import {
  clearUserScanSessions,
  DashboardStats,
  deleteScanSession,
  expandScanSessionTracks,
  getDashboardStats,
  getDatabase,
  getSandboxStorageSummary,
  getScanSessionWithTracks,
  isAdminUser,
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
import { SettingsScreen } from './src/screens/SettingsScreen';
import { warmupAiEngine } from './src/services/moodAiService';
import { resolvePlayablePreviewUrl } from './src/services/onlineMusicService';
import { ThemePalette } from './src/theme/colors';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

type TabKey = 'studio' | 'history' | 'library' | 'settings';
const TAB_ORDER: TabKey[] = ['studio', 'history', 'library', 'settings'];

const TABS = [
  {
    key: 'studio' as const,
    label: 'Kamera',
    icon: 'camera-outline' as const,
    activeIcon: 'camera' as const,
    sfSymbol: 'camera',
    activeSfSymbol: 'camera.fill',
  },
  {
    key: 'history' as const,
    label: 'Geçmiş',
    icon: 'time-outline' as const,
    activeIcon: 'time' as const,
    sfSymbol: 'clock',
    activeSfSymbol: 'clock.fill',
  },
  {
    key: 'library' as const,
    label: 'Şarkılar',
    icon: 'musical-notes-outline' as const,
    activeIcon: 'musical-notes' as const,
    sfSymbol: 'music.note',
    activeSfSymbol: 'music.note',
  },
  {
    key: 'settings' as const,
    label: 'Ayarlar',
    icon: 'settings-outline' as const,
    activeIcon: 'settings' as const,
    sfSymbol: 'gearshape',
    activeSfSymbol: 'gearshape.fill',
  },
];

function MainAppContent() {
  const { colors, isDark, cycleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [showSplash, setShowSplash] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('studio');
  const [settingsAdminOpen, setSettingsAdminOpen] = useState(false);
  const [tabVisitTick, setTabVisitTick] = useState(1);

  const [sessions, setSessions] = useState<ScanSessionRecord[]>([]);
  const [activeSession, setActiveSession] = useState<ScanSessionRecord | null>(null);
  const [selectedHistorySession, setSelectedHistorySession] = useState<ScanSessionRecord | null>(null);
  const [cameraLaunchTick, setCameraLaunchTick] = useState(0);
  const [stats, setStats] = useState<DashboardStats>({
    totalScans: 0,
    dominantMood: null,
    favoriteCount: 0,
    catalogTotal: 0,
  });
  const [storageInfo, setStorageInfo] = useState({
    photoCount: 0,
    trackCount: 0,
    scanCount: 0,
  });

  // Directional tab transition animations
  const tabOpacity = useRef(new Animated.Value(1)).current;
  const tabTranslateX = useRef(new Animated.Value(0)).current;
  const tabScale = useRef(new Animated.Value(1)).current;

  // Header theme icon spin
  const themeSpin = useRef(new Animated.Value(0)).current;

  // Audio preview state (expo-audio)
  const player = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(player);
  const [queue, setQueue] = useState<TrackRecord[]>([]);
  const [queueIdx, setQueueIdx] = useState<number>(-1);
  const currentTrack = queueIdx >= 0 && queueIdx < queue.length ? queue[queueIdx] : null;

  const isAdmin = isAdminUser(user);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
    }).catch(() => {});
    void warmupAiEngine();

    (async () => {
      await getDatabase();
      const restored = await restoreActiveUser();
      if (restored) {
        setUser(restored);
      }
      setDbReady(true);
    })();
  }, []);

  // Ensure non-admin never enters admin mode
  useEffect(() => {
    if (!isAdmin && settingsAdminOpen) {
      setSettingsAdminOpen(false);
    }
  }, [isAdmin, settingsAdminOpen]);

  const refreshStorageInfo = useCallback(async () => {
    try {
      const summary = await getSandboxStorageSummary();
      setStorageInfo(summary);
    } catch {
      // Ignore transient storage check error
    }
  }, []);

  const refreshUserWorkspace = useCallback(
    async (uid: number, syncActiveSession = false) => {
      try {
        const [scanRows, dash] = await Promise.all([listScanSessions(uid), getDashboardStats(uid)]);
        setSessions(scanRows);
        setStats(dash);

        if (syncActiveSession) {
          setActiveSession((prev) => {
            if (!prev) return null;
            const stillExists = scanRows.some((s) => s.id === prev.id);
            return stillExists ? prev : null;
          });
          setSelectedHistorySession((prev) => {
            if (!prev) return null;
            const stillExists = scanRows.some((s) => s.id === prev.id);
            return stillExists ? prev : null;
          });
        } else if (scanRows.length > 0) {
          const latestFull = await getScanSessionWithTracks(scanRows[0].id, uid);
          setActiveSession((prev) => prev || latestFull);
        }
        await refreshStorageInfo();
      } catch {
        // Ignore transient refresh error
      }
    },
    [refreshStorageInfo]
  );

  useEffect(() => {
    if (user) {
      refreshUserWorkspace(user.id);
    }
  }, [refreshUserWorkspace, user]);

  useEffect(() => {
    if (user && activeTab === 'settings') {
      refreshStorageInfo();
    }
  }, [activeTab, refreshStorageInfo, user]);

  const switchTab = useCallback(
    (next: TabKey, options?: { openAdmin?: boolean }) => {
      if (next === 'settings' && options?.openAdmin !== undefined) {
        setSettingsAdminOpen(Boolean(options.openAdmin && isAdmin));
      } else if (next === 'settings' && activeTab === 'settings') {
        if (settingsAdminOpen) {
          Haptics.selectionAsync().catch(() => {});
          setSettingsAdminOpen(false);
        }
        return;
      } else if (next === 'history' && activeTab === 'history') {
        if (selectedHistorySession) {
          Haptics.selectionAsync().catch(() => {});
          setSelectedHistorySession(null);
        }
        return;
      }

      if (next === activeTab) {
        return;
      }

      Haptics.selectionAsync().catch(() => {});
      const prevIdx = TAB_ORDER.indexOf(activeTab);
      const nextIdx = TAB_ORDER.indexOf(next);
      const dir = nextIdx >= prevIdx ? 1 : -1;

      setActiveTab(next);
      setTabVisitTick((t) => t + 1);
      tabOpacity.setValue(0);
      tabTranslateX.setValue(dir * 22);
      tabScale.setValue(0.985);

      Animated.parallel([
        Animated.timing(tabOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(tabTranslateX, {
          toValue: 0,
          damping: 20,
          stiffness: 220,
          mass: 0.78,
          useNativeDriver: true,
        }),
        Animated.spring(tabScale, {
          toValue: 1,
          damping: 20,
          stiffness: 220,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [activeTab, isAdmin, selectedHistorySession, settingsAdminOpen, tabOpacity, tabScale, tabTranslateX]
  );

  // Auto-advance to next track when 30s preview finishes
  useEffect(() => {
    if (audioStatus.didJustFinish && queue.length > 0 && queueIdx + 1 < queue.length) {
      handlePlayFromQueue(queue, queueIdx + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioStatus.didJustFinish]);

  const playRequestIdRef = useRef(0);

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

    const reqId = ++playRequestIdRef.current;
    const streamUrl = await resolvePlayablePreviewUrl(target);
    if (reqId !== playRequestIdRef.current) return;
    if (!streamUrl) {
      Alert.alert('Önizleme Bulunamadı', 'Bu şarkı için dış bağlantıyı (sağdaki ikon) açabilirsiniz.');
      return;
    }

    setQueue(trackList);
    setQueueIdx(index);
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
    setSelectedHistorySession((prev) => {
      if (!prev?.tracks) return prev;
      return {
        ...prev,
        tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, isFavorite: liked } : t)),
      };
    });
    const dash = await getDashboardStats(user.id);
    setStats(dash);
  };

  const handleOpenHistorySession = async (sessionId: number) => {
    if (!user) return;
    const full = await getScanSessionWithTracks(sessionId, user.id);
    if (full) {
      setSelectedHistorySession(full);
      if (activeTab !== 'history') {
        switchTab('history');
      }
    }
  };

  const handleExpandSessionTracks = async (
    sessionId: number,
    addCount: number,
    language: 'all' | 'tr' | 'global'
  ) => {
    if (!user) return null;
    const result = await expandScanSessionTracks({
      sessionId,
      userId: user.id,
      addCount,
      language,
    });
    if (!result) return null;

    setSelectedHistorySession((prev) => (prev?.id === sessionId ? result.session : prev));
    setActiveSession((prev) => (prev?.id === sessionId ? result.session : prev));
    await refreshUserWorkspace(user.id, true);
    return {
      addedCount: result.addedCount,
      totalCount: result.session.trackCount,
    };
  };

  const handleDeletePastSession = async (sessionId: number) => {
    if (!user) return;
    await deleteScanSession(sessionId, user.id);
    if (activeSession?.id === sessionId) {
      setActiveSession(null);
    }
    if (selectedHistorySession?.id === sessionId) {
      setSelectedHistorySession(null);
    }
    await refreshUserWorkspace(user.id, true);
  };

  const handleClearOwnHistory = async () => {
    if (!user) return;
    await clearUserScanSessions(user.id);
    setActiveSession(null);
    setSelectedHistorySession(null);
    await refreshUserWorkspace(user.id, true);
  };

  const handleWipeAllData = async () => {
    player.pause();
    setQueue([]);
    setQueueIdx(-1);
    setActiveSession(null);
    setSelectedHistorySession(null);
    setSessions([]);
    await wipeAllLocalData();
    setUser(null);
    setActiveTab('studio');
    setSettingsAdminOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const handleLogout = async () => {
    player.pause();
    setQueue([]);
    setQueueIdx(-1);
    setActiveSession(null);
    setSelectedHistorySession(null);
    setSessions([]);
    setSettingsAdminOpen(false);
    setActiveTab('studio');
    await logoutActiveUser();
    setUser(null);
  };

  const handleDatabaseMutated = () => {
    if (user) {
      refreshUserWorkspace(user.id, true);
    }
  };

  const handleThemeCyclePress = () => {
    Haptics.selectionAsync().catch(() => {});
    themeSpin.setValue(0);
    Animated.timing(themeSpin, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    cycleTheme();
  };

  const themeSpinRotate = themeSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const progressRatio =
    audioStatus.duration && audioStatus.duration > 0
      ? audioStatus.currentTime / audioStatus.duration
      : 0;

  const dockTabs = useMemo(
    () =>
      TABS.map((t) => ({
        ...t,
        showBadgeDot: t.key === 'settings' && isAdmin,
      })),
    [isAdmin]
  );

  const appLogo = isDark ? require('./assets/logo-dark.png') : require('./assets/logo.png');

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {dbReady && !user && (
        <LoginScreen
          onAuthenticated={(u) => {
            setSelectedHistorySession(null);
            setSettingsAdminOpen(false);
            setActiveTab('studio');
            setTabVisitTick((t) => t + 1);
            setUser(u);
          }}
        />
      )}

      {dbReady && user && (
        <SafeAreaView style={styles.appSafe} edges={['top', 'left', 'right']}>
          {/* Top App Header */}
          <View style={styles.topHeader}>
            <View style={styles.brandRow}>
              <Image source={appLogo} style={styles.headerLogo} />
              <View>
                <Text style={styles.headerBrand}>MoodSync</Text>
                <Text style={styles.headerSub}>{stats.catalogTotal} Online Şarkı</Text>
              </View>
            </View>

            <View style={styles.headerRight}>
              {isAdmin && (
                <SpringPressable
                  haptic
                  onPress={() => switchTab('settings', { openAdmin: true })}
                  style={styles.adminHeaderPill}
                >
                  <Ionicons name="shield-checkmark" size={14} color={colors.brand} />
                  <Text style={styles.adminHeaderText}>Admin</Text>
                </SpringPressable>
              )}

              <SpringPressable
                onPress={handleThemeCyclePress}
                style={styles.headerIconBtn}
                hitSlop={6}
              >
                <Animated.View style={{ transform: [{ rotate: themeSpinRotate }] }}>
                  <Ionicons
                    name={isDark ? 'moon' : 'sunny'}
                    size={18}
                    color={colors.brand}
                  />
                </Animated.View>
              </SpringPressable>

              <SpringPressable
                haptic
                onPress={() => switchTab('settings', { openAdmin: false })}
                style={[styles.avatarPill, isAdmin && styles.avatarPillAdmin]}
                hitSlop={6}
              >
                <Text style={[styles.avatarPillText, isAdmin && { color: colors.brand }]}>
                  {user.displayName.slice(0, 1).toUpperCase()}
                </Text>
              </SpringPressable>
            </View>
          </View>

          {/* Active Screen with directional slide+fade+scale transition */}
          <Animated.View
            style={{
              flex: 1,
              opacity: tabOpacity,
              transform: [{ translateX: tabTranslateX }, { scale: tabScale }],
            }}
          >
            {activeTab === 'studio' && (
              <CameraStudioScreen
                userId={user.id}
                userFirstName={user.displayName.split(' ')[0]}
                isActiveTab={activeTab === 'studio'}
                visitTick={tabVisitTick}
                launchCameraTick={cameraLaunchTick}
                activeSession={activeSession}
                recentScans={sessions}
                playingTrackId={currentTrack?.id || null}
                isAudioPlaying={Boolean(audioStatus.playing)}
                onSessionCreated={(newSess) => {
                  setActiveSession(newSess);
                  refreshUserWorkspace(user.id);
                }}
                onSelectPastSession={handleOpenHistorySession}
                onSeeAllHistory={() => {
                  setSelectedHistorySession(null);
                  switchTab('history');
                }}
                onPlayTrack={handlePlayFromQueue}
                onToggleFavorite={handleToggleFavorite}
                onExpandSessionTracks={handleExpandSessionTracks}
                onCatalogExpanded={() => refreshUserWorkspace(user.id)}
              />
            )}

            {activeTab === 'history' && (
              <HistoryScreen
                sessions={sessions}
                selectedSession={selectedHistorySession}
                stats={stats}
                visitTick={tabVisitTick}
                playingTrackId={currentTrack?.id || null}
                isAudioPlaying={Boolean(audioStatus.playing)}
                onOpenSession={handleOpenHistorySession}
                onCloseSession={() => setSelectedHistorySession(null)}
                onPlayTrack={handlePlayFromQueue}
                onToggleFavorite={handleToggleFavorite}
                onExpandSessionTracks={handleExpandSessionTracks}
                onDeleteSession={handleDeletePastSession}
                onNewScan={() => {
                  setSelectedHistorySession(null);
                  setCameraLaunchTick((t) => t + 1);
                  switchTab('studio');
                }}
              />
            )}

            {activeTab === 'library' && (
              <LibraryScreen
                userId={user.id}
                catalogTotal={stats.catalogTotal}
                visitTick={tabVisitTick}
                playingTrackId={currentTrack?.id || null}
                isAudioPlaying={Boolean(audioStatus.playing)}
                onPlayTrack={handlePlayFromQueue}
                onToggleFavorite={handleToggleFavorite}
                onCatalogExpanded={() => refreshUserWorkspace(user.id)}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsScreen
                user={user}
                stats={stats}
                storageInfo={storageInfo}
                adminMode={settingsAdminOpen}
                visitTick={tabVisitTick}
                onSetAdminMode={(open) => setSettingsAdminOpen(Boolean(open && isAdmin))}
                onPlayTrack={handlePlayFromQueue}
                onDatabaseMutated={handleDatabaseMutated}
                onClearOwnHistory={handleClearOwnHistory}
                onWipeAllData={handleWipeAllData}
                onLogout={handleLogout}
              />
            )}
          </Animated.View>

          {/* Floating Mini Player + iOS 27 Liquid Glass Pill Tab Bar */}
          <SafeAreaView
            edges={['bottom']}
            pointerEvents="box-none"
            style={styles.bottomDock}
          >
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

            <LiquidGlassTabBar
              tabs={dockTabs}
              activeTab={activeTab}
              onSelectTab={(key) => switchTab(key)}
            />
          </SafeAreaView>
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
      borderWidth: 1,
      borderColor: colors.hairline,
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
    adminHeaderPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.brandSoft,
      borderWidth: 1,
      borderColor: colors.brand,
    },
    adminHeaderText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.brand,
    },
    headerIconBtn: {
      width: 34,
      height: 34,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPill: {
      width: 34,
      height: 34,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.hairlineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPillAdmin: {
      borderColor: colors.brand,
      backgroundColor: colors.brandSoft,
    },
    avatarPillText: {
      fontSize: 13.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    bottomDock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'transparent',
      overflow: 'visible',
    },
  });
