import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addRemoteTrackCommandListener,
  clearLockScreenSkipCommands,
  configureLockScreenSkipCommands,
} from './modules/moodsync-vision';
import { AnimatedSplashScreen } from './src/components/AnimatedSplashScreen';
import { LiquidGlassTabBar } from './src/components/LiquidGlassTabBar';
import {
  ExpandableAudioPlayer,
  ExpandableAudioPlayerHandle,
  MiniBarFrame,
} from './src/components/ExpandableAudioPlayer';
import { SpringPressable } from './src/components/MotionPrimitives';
import { PlaylistPickerModal } from './src/components/PlaylistPickerModal';
import { TrackActionSheetModal } from './src/components/TrackActionSheetModal';
import {
  clearUserScanSessions,
  DashboardStats,
  deleteScanSession,
  dislikeTrack,
  expandScanSessionTracks,
  getDashboardStats,
  getDatabase,
  getSandboxStorageSummary,
  getScanSessionWithTracks,
  isAdminUser,
  listScanSessions,
  logoutActiveUser,
  PlaylistRecord,
  removeTrackFromPlaylist,
  restoreActiveUser,
  ScanSessionRecord,
  toggleFavoriteTrack,
  TrackRecord,
  updateScanSessionJournal,
  updateScanSessionMoodOrStrategy,
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
import { EmotionType, MoodStrategy, MoodType, ThemePalette } from './src/theme/colors';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

type TabKey = 'studio' | 'history' | 'library' | 'settings';

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
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = Dimensions.get('window');

  const defaultMiniBarFrame = useMemo<MiniBarFrame>(() => {
    const width = Math.min(winW - 40, 376);
    const height = 62;
    const x = (winW - width) / 2;
    const y = Math.max(120, winH - insets.bottom - 72 - height);
    return { x, y, width, height };
  }, [insets.bottom, winH, winW]);

  const [miniBarFrame, setMiniBarFrame] = useState<MiniBarFrame>(defaultMiniBarFrame);
  const hasMeasuredBarRef = useRef(false);
  const miniSlotRef = useRef<React.ComponentRef<typeof View>>(null);

  useEffect(() => {
    if (!hasMeasuredBarRef.current) {
      setMiniBarFrame(defaultMiniBarFrame);
    }
  }, [defaultMiniBarFrame]);

  const handleMeasureMiniBar = useCallback((frame: MiniBarFrame) => {
    hasMeasuredBarRef.current = true;
    setMiniBarFrame((prev) =>
      Math.abs(prev.x - frame.x) < 1 &&
      Math.abs(prev.y - frame.y) < 1 &&
      Math.abs(prev.width - frame.width) < 1 &&
      Math.abs(prev.height - frame.height) < 1
        ? prev
        : frame
    );
  }, []);

  const measureMiniSlot = useCallback(() => {
    miniSlotRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 100 && height > 30 && y > 80) {
        handleMeasureMiniBar({ x, y, width, height });
      }
    });
  }, [handleMeasureMiniBar]);

  const [showSplash, setShowSplash] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('studio');
  const [settingsAdminOpen, setSettingsAdminOpen] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState<Record<TabKey, boolean>>({
    studio: true,
    history: false,
    library: false,
    settings: false,
  });

  // Player gesture sheet imperative ref & playback repeat state
  const playerSheetRef = useRef<ExpandableAudioPlayerHandle>(null);
  const [repeatOne, setRepeatOne] = useState(false);
  const [playlistsRefreshTick, setPlaylistsRefreshTick] = useState(1);
  const [actionSheetState, setActionSheetState] = useState<{
    track: TrackRecord;
    playlistContext: PlaylistRecord | null;
  } | null>(null);
  const [playlistPickerState, setPlaylistPickerState] = useState<{
    tracks: TrackRecord[];
    suggestedName?: string;
    suggestedMood?: MoodType | null;
  } | null>(null);

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

  // Header theme icon spin
  const themeSpin = useRef(new Animated.Value(0)).current;

  const userIdRef = useRef<number | null>(null);
  userIdRef.current = user?.id ?? null;
  const activeTabRef = useRef<TabKey>(activeTab);
  activeTabRef.current = activeTab;
  const themeSpinAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const selectedHistorySessionRef = useRef(selectedHistorySession);
  selectedHistorySessionRef.current = selectedHistorySession;

  // Audio preview state (expo-audio)
  const player = useAudioPlayer(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const isAudioPlayingRef = useRef(false);
  const [queue, setQueue] = useState<TrackRecord[]>([]);
  const [queueIdx, setQueueIdx] = useState<number>(-1);
  const currentTrack = queueIdx >= 0 && queueIdx < queue.length ? queue[queueIdx] : null;
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const hasCurrentTrack = Boolean(currentTrack);

  useEffect(() => {
    if (!hasCurrentTrack) return;
    const rafId = requestAnimationFrame(() => {
      measureMiniSlot();
    });
    return () => cancelAnimationFrame(rafId);
  }, [hasCurrentTrack, measureMiniSlot]);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const queueIdxRef = useRef(queueIdx);
  queueIdxRef.current = queueIdx;
  const repeatOneRef = useRef(repeatOne);
  repeatOneRef.current = repeatOne;

  const isAdmin = isAdminUser(user);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
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
      setStorageInfo((prev) =>
        prev.photoCount === summary.photoCount &&
        prev.trackCount === summary.trackCount &&
        prev.scanCount === summary.scanCount
          ? prev
          : summary
      );
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

  const animateToTab = useCallback((next: TabKey) => {
    if (activeTabRef.current === next) return;
    activeTabRef.current = next;
    Haptics.selectionAsync().catch(() => {});
    setVisitedTabs((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
    setActiveTab(next);
  }, []);

  useEffect(() => {
    return () => {
      themeSpinAnimRef.current?.stop();
    };
  }, []);

  const resetTabsToStudio = useCallback(() => {
    setActiveTab('studio');
    setVisitedTabs({ studio: true, history: false, library: false, settings: false });
    setSettingsAdminOpen(false);
  }, []);

  const handleLogout = useCallback(async () => {
    player.pause();
    player.clearLockScreenControls();
    clearLockScreenSkipCommands();
    playerSheetRef.current?.closeImmediate();
    setActionSheetState(null);
    setPlaylistPickerState(null);
    setQueue([]);
    setQueueIdx(-1);
    setActiveSession(null);
    setSelectedHistorySession(null);
    setSessions([]);
    resetTabsToStudio();
    await logoutActiveUser();
    setUser(null);
  }, [player, resetTabsToStudio]);

  const requestAdminAccess = useCallback(
    (open: boolean, alsoSwitchTab = false) => {
      if (!open) {
        setSettingsAdminOpen(false);
        if (alsoSwitchTab) animateToTab('settings');
        return;
      }
      if (!isAdmin || !user) return;
      setSettingsAdminOpen(true);
      if (alsoSwitchTab) animateToTab('settings');
    },
    [animateToTab, isAdmin, user]
  );

  const switchTab = useCallback(
    (next: TabKey, options?: { openAdmin?: boolean }) => {
      if (next === 'settings' && options?.openAdmin === true) {
        void requestAdminAccess(true, true);
        return;
      }
      if (next === 'settings' && options?.openAdmin === false) {
        setSettingsAdminOpen(false);
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

      animateToTab(next);
    },
    [activeTab, animateToTab, requestAdminAccess, selectedHistorySession, settingsAdminOpen]
  );

  const playRequestIdRef = useRef(0);

  const handlePlayFromQueue = useCallback(
    async (trackList: TrackRecord[], index: number, forcePlay = false) => {
      const target = trackList[index];
      if (!target) return;

      const cur = currentTrackRef.current;
      if (!forcePlay && cur && cur.id === target.id) {
        if (isAudioPlayingRef.current) {
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
        Alert.alert(
          'Önizleme Bulunamadı',
          'Bu şarkı için sağdaki menüden Apple Music, Spotify veya YouTube Music’te açabilirsiniz.'
        );
        return;
      }

      setQueue(trackList);
      setQueueIdx(index);
      player.replace({ uri: streamUrl });
      player.play();
    },
    [player]
  );

  const handlePlayFromQueueRef = useRef(handlePlayFromQueue);
  handlePlayFromQueueRef.current = handlePlayFromQueue;

  const handleNextTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = queueIdxRef.current;
    if (idx + 1 < q.length) {
      void handlePlayFromQueueRef.current(q, idx + 1, true);
    }
  }, []);

  const handlePreviousTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = queueIdxRef.current;
    const elapsed = Number(player.currentTime || 0);
    if (elapsed > 3 || (idx === 0 && elapsed > 1.2)) {
      void player.seekTo(0);
      return;
    }
    if (idx > 0) {
      void handlePlayFromQueueRef.current(q, idx - 1, true);
    }
  }, [player]);

  const handleNextRef = useRef(handleNextTrack);
  handleNextRef.current = handleNextTrack;
  const handlePreviousRef = useRef(handlePreviousTrack);
  handlePreviousRef.current = handlePreviousTrack;

  // Subscribe to player status without re-rendering MainAppContent on playhead ticks
  useEffect(() => {
    const syncPlaying = (playing: boolean) => {
      if (playing !== isAudioPlayingRef.current) {
        isAudioPlayingRef.current = playing;
        setIsAudioPlaying(playing);
      }
    };
    syncPlaying(Boolean(player.playing));
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      syncPlaying(Boolean(status.playing));
      if (!status.didJustFinish) return;
      if (repeatOneRef.current && queueIdxRef.current >= 0) {
        void player.seekTo(0).then(() => player.play());
        return;
      }
      if (queueRef.current.length > 0 && queueIdxRef.current + 1 < queueRef.current.length) {
        handleNextRef.current();
      }
    });
    return () => {
      sub.remove();
    };
  }, [player]);

  // Sync iOS Lock Screen metadata & Previous/Next remote commands
  useEffect(() => {
    if (!currentTrack) {
      player.clearLockScreenControls();
      clearLockScreenSkipCommands();
      return;
    }
    const canPrev = queueIdx > 0;
    const canNext = queueIdx + 1 < queue.length;
    try {
      player.setActiveForLockScreen(
        true,
        {
          title: currentTrack.title,
          artist: currentTrack.artist,
          albumTitle: currentTrack.album || 'MoodSync',
          artworkUrl: currentTrack.artworkUrl || undefined,
        },
        {
          showSeekForward: false,
          showSeekBackward: false,
          showNextTrack: canNext,
          showPreviousTrack: canPrev,
        }
      );
    } catch {
      // Ignore if lock screen audio session is temporarily inactive
    }
    configureLockScreenSkipCommands(canPrev, canNext);
  }, [currentTrack, player, queue.length, queueIdx]);

  // Listen to native iOS Lock Screen / Control Center Previous & Next triggers
  useEffect(() => {
    const sub = addRemoteTrackCommandListener((event) => {
      if (event.direction === 'next') {
        handleNextRef.current();
      } else if (event.direction === 'previous') {
        handlePreviousRef.current();
      }
    });
    return () => {
      sub?.remove();
      clearLockScreenSkipCommands();
    };
  }, []);

  const handleSeekTo = useCallback(
    (seconds: number) => {
      const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
      void player.seekTo(safe);
    },
    [player]
  );

  const handleToggleFavorite = useCallback(async (trackId: number) => {
    const uid = userIdRef.current;
    if (!uid) return;
    try {
      const liked = await toggleFavoriteTrack(uid, trackId);

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
      setQueue((prev) => prev.map((t) => (t.id === trackId ? { ...t, isFavorite: liked } : t)));
      setActionSheetState((prev) =>
        prev && prev.track.id === trackId
          ? { ...prev, track: { ...prev.track, isFavorite: liked } }
          : prev
      );
      const dash = await getDashboardStats(uid);
      setStats(dash);
    } catch (err: any) {
      Alert.alert('Bağlantı Hatası', err?.message || 'Favori durumu güncellenemedi.');
    }
  }, []);

  const handleDislikeTrack = useCallback(
    async (track: TrackRecord) => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        await dislikeTrack(uid, track.id);

        setActiveSession((prev) => {
          if (!prev?.tracks) return prev;
          const filtered = prev.tracks.filter((t) => t.id !== track.id);
          return { ...prev, tracks: filtered, trackCount: filtered.length };
        });
        setSelectedHistorySession((prev) => {
          if (!prev?.tracks) return prev;
          const filtered = prev.tracks.filter((t) => t.id !== track.id);
          return { ...prev, tracks: filtered, trackCount: filtered.length };
        });

        const curIdx = queueIdxRef.current;
        const curQueue = queueRef.current;
        const removedIndex = curQueue.findIndex((t) => t.id === track.id);
        if (removedIndex !== -1) {
          const nextQueue = curQueue.filter((t) => t.id !== track.id);
          if (nextQueue.length === 0) {
            player.pause();
            playerSheetRef.current?.closeImmediate();
            setQueue([]);
            setQueueIdx(-1);
          } else if (removedIndex === curIdx) {
            const nextIdx = Math.min(curIdx, nextQueue.length - 1);
            void handlePlayFromQueueRef.current(nextQueue, nextIdx, true);
          } else {
            setQueue(nextQueue);
            if (removedIndex < curIdx) {
              setQueueIdx(curIdx - 1);
            }
          }
        }

        setPlaylistsRefreshTick((t) => t + 1);
        await refreshUserWorkspace(uid, true);
      } catch (err: any) {
        Alert.alert('Bağlantı Hatası', err?.message || 'Şarkı gizlenemedi.');
      }
    },
    [player, refreshUserWorkspace]
  );

  const handlePlayTrack = useCallback(
    (q: TrackRecord[], idx: number) => {
      void handlePlayFromQueue(q, idx);
    },
    [handlePlayFromQueue]
  );

  const handleLibraryTrackMore = useCallback(
    (track: TrackRecord, playlistContext?: PlaylistRecord | null) => {
      setActionSheetState({ track, playlistContext: playlistContext || null });
    },
    []
  );

  const handleCatalogExpanded = useCallback(() => {
    const uid = userIdRef.current;
    if (uid) {
      void refreshUserWorkspace(uid);
    }
  }, [refreshUserWorkspace]);

  const handleTogglePlay = useCallback(() => {
    if (isAudioPlayingRef.current) {
      player.pause();
    } else {
      player.play();
    }
  }, [player]);

  const handleStopAndDismiss = useCallback(() => {
    player.pause();
    player.clearLockScreenControls();
    clearLockScreenSkipCommands();
    playerSheetRef.current?.closeImmediate();
    setQueue([]);
    setQueueIdx(-1);
  }, [player]);

  const handleToggleRepeatOne = useCallback(() => {
    setRepeatOne((v) => !v);
  }, []);

  const handleSelectQueueIndex = useCallback(
    (idx: number) => {
      void handlePlayFromQueue(queueRef.current, idx, true);
    },
    [handlePlayFromQueue]
  );

  const handleAddPlayerTrackToPlaylist = useCallback((track: TrackRecord) => {
    playerSheetRef.current?.collapse(2.0);
    setPlaylistPickerState({
      tracks: [track],
      suggestedName: '',
      suggestedMood: track.mood,
    });
  }, []);

  const handleDislikePlayerTrack = useCallback(
    (track: TrackRecord) => {
      void handleDislikeTrack(track);
    },
    [handleDislikeTrack]
  );

  const handleSelectTab = useCallback((key: TabKey) => switchTab(key), [switchTab]);

  const handleUpdateSessionMoodOrStrategy = useCallback(
    async (params: {
      sessionId: number;
      emotion?: EmotionType;
      strategy?: MoodStrategy;
      language?: 'all' | 'tr' | 'global';
      isManualOverride?: boolean;
    }) => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        const updated = await updateScanSessionMoodOrStrategy({
          ...params,
          userId: uid,
        });
        if (!updated) return;
        setActiveSession((prev) => (prev?.id === params.sessionId ? updated : prev));
        setSelectedHistorySession((prev) => (prev?.id === params.sessionId ? updated : prev));
        await refreshUserWorkspace(uid, true);
      } catch (err: any) {
        Alert.alert('Bağlantı Hatası', err?.message || 'Mod bilgisi güncellenemedi.');
      }
    },
    [refreshUserWorkspace]
  );

  const handleUpdateSessionJournal = useCallback(
    async (sessionId: number, note: string, tags: string[]) => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        const updated = await updateScanSessionJournal({
          sessionId,
          userId: uid,
          note,
          tags,
        });
        if (!updated) return;
        setActiveSession((prev) => (prev?.id === sessionId ? updated : prev));
        setSelectedHistorySession((prev) => (prev?.id === sessionId ? updated : prev));
        await refreshUserWorkspace(uid, true);
      } catch (err: any) {
        Alert.alert('Bağlantı Hatası', err?.message || 'Günlük notu kaydedilemedi.');
      }
    },
    [refreshUserWorkspace]
  );

  const handleOpenHistorySession = useCallback(
    async (sessionId: number) => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        const full = await getScanSessionWithTracks(sessionId, uid);
        if (full) {
          setSelectedHistorySession(full);
          if (activeTabRef.current !== 'history') {
            switchTab('history');
          }
        }
      } catch (err: any) {
        Alert.alert('Bağlantı Hatası', err?.message || 'Tarama detayı yüklenemedi.');
      }
    },
    [switchTab]
  );

  const handleExpandSessionTracks = useCallback(
    async (sessionId: number, addCount: number, language: 'all' | 'tr' | 'global') => {
      const uid = userIdRef.current;
      if (!uid) return null;
      const result = await expandScanSessionTracks({
        sessionId,
        userId: uid,
        addCount,
        language,
      });
      if (!result) return null;

      setSelectedHistorySession((prev) => (prev?.id === sessionId ? result.session : prev));
      setActiveSession((prev) => (prev?.id === sessionId ? result.session : prev));
      await refreshUserWorkspace(uid, true);
      return {
        addedCount: result.addedCount,
        totalCount: result.session.trackCount,
      };
    },
    [refreshUserWorkspace]
  );

  const handleDeletePastSession = useCallback(
    async (sessionId: number) => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        await deleteScanSession(sessionId, uid);
        if (activeSessionRef.current?.id === sessionId) {
          setActiveSession(null);
        }
        if (selectedHistorySessionRef.current?.id === sessionId) {
          setSelectedHistorySession(null);
        }
        await refreshUserWorkspace(uid, true);
      } catch (err: any) {
        Alert.alert('Bağlantı Hatası', err?.message || 'Tarama silinemedi.');
      }
    },
    [refreshUserWorkspace]
  );

  const handleClearOwnHistory = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    try {
      await clearUserScanSessions(uid);
      setActiveSession(null);
      setSelectedHistorySession(null);
      await refreshUserWorkspace(uid, true);
    } catch (err: any) {
      Alert.alert('Bağlantı Hatası', err?.message || 'Tarama geçmişi temizlenemedi.');
    }
  }, [refreshUserWorkspace]);

  const handleWipeAllData = useCallback(async () => {
    try {
      await wipeAllLocalData();
      player.pause();
      player.clearLockScreenControls();
      clearLockScreenSkipCommands();
      playerSheetRef.current?.closeImmediate();
      setActionSheetState(null);
      setPlaylistPickerState(null);
      setQueue([]);
      setQueueIdx(-1);
      setActiveSession(null);
      setSelectedHistorySession(null);
      setSessions([]);
      setUser(null);
      resetTabsToStudio();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      Alert.alert('Bağlantı Hatası', err?.message || 'Veritabanı sıfırlanamadı.');
    }
  }, [player, resetTabsToStudio]);

  const handleDatabaseMutated = useCallback(() => {
    setPlaylistsRefreshTick((t) => t + 1);
    const uid = userIdRef.current;
    if (uid) {
      void refreshUserWorkspace(uid, true);
    }
  }, [refreshUserWorkspace]);

  const handleThemeCyclePress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    themeSpinAnimRef.current?.stop();
    themeSpin.setValue(0);
    const anim = Animated.timing(themeSpin, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    themeSpinAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && themeSpinAnimRef.current === anim) {
        themeSpinAnimRef.current = null;
      }
    });
    cycleTheme();
  }, [cycleTheme, themeSpin]);

  const handleSplashFinish = useCallback(() => setShowSplash(false), []);

  const handleAuthenticated = useCallback(
    (u: UserRecord) => {
      setSelectedHistorySession(null);
      resetTabsToStudio();
      setUser(u);
    },
    [resetTabsToStudio]
  );

  const handleStudioSessionCreated = useCallback(
    (newSess: ScanSessionRecord) => {
      setActiveSession(newSess);
      const uid = userIdRef.current;
      if (uid) {
        void refreshUserWorkspace(uid);
      }
    },
    [refreshUserWorkspace]
  );

  const handleStudioSeeAllHistory = useCallback(() => {
    setSelectedHistorySession(null);
    switchTab('history');
  }, [switchTab]);

  const handleSessionTrackMore = useCallback((track: TrackRecord) => {
    setActionSheetState({ track, playlistContext: null });
  }, []);

  const handleStudioSaveTracksToPlaylist = useCallback(
    (tracks: TrackRecord[], suggestedName: string) => {
      setPlaylistPickerState({
        tracks,
        suggestedName,
        suggestedMood: activeSessionRef.current?.mood || null,
      });
    },
    []
  );

  const handleCloseHistorySession = useCallback(() => {
    setSelectedHistorySession(null);
  }, []);

  const handleHistorySaveTracksToPlaylist = useCallback(
    (tracks: TrackRecord[], suggestedName: string) => {
      setPlaylistPickerState({
        tracks,
        suggestedName,
        suggestedMood: selectedHistorySessionRef.current?.mood || null,
      });
    },
    []
  );

  const handleHistoryNewScan = useCallback(() => {
    setSelectedHistorySession(null);
    setCameraLaunchTick((t) => t + 1);
    switchTab('studio');
  }, [switchTab]);

  const handleSettingsSetAdminMode = useCallback(
    (open: boolean) => {
      void requestAdminAccess(open, false);
    },
    [requestAdminAccess]
  );

  const themeSpinRotate = themeSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

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

      {dbReady && !user && <LoginScreen onAuthenticated={handleAuthenticated} />}

      {dbReady && user && (
        <>
          <SafeAreaView style={styles.appSafe} edges={['top', 'left', 'right']}>
            {/* Top App Header */}
          <View style={styles.topHeader}>
            <View style={styles.brandRow}>
              <Image source={appLogo} style={styles.headerLogo} />
              <View>
                <Text style={styles.headerBrand}>MoodSync</Text>
                <Text style={styles.headerSub}>{stats.catalogTotal} Bulut Şarkısı</Text>
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

          {/* Lazy keep-alive tab panes driven by pre-primed StaggeredEntry */}
          <View style={{ flex: 1 }}>
            {visitedTabs.studio && (
              <View style={[styles.tabPane, activeTab !== 'studio' && styles.tabPaneHidden]}>
                <CameraStudioScreen
                  userId={user.id}
                  userFirstName={user.displayName.split(' ')[0]}
                  isActiveTab={activeTab === 'studio'}
                  launchCameraTick={cameraLaunchTick}
                  activeSession={activeSession}
                  recentScans={sessions}
                  playingTrackId={currentTrack?.id || null}
                  isAudioPlaying={isAudioPlaying}
                  onSessionCreated={handleStudioSessionCreated}
                  onSelectPastSession={handleOpenHistorySession}
                  onSeeAllHistory={handleStudioSeeAllHistory}
                  onPlayTrack={handlePlayTrack}
                  onToggleFavorite={handleToggleFavorite}
                  onTrackMorePress={handleSessionTrackMore}
                  onUpdateSessionMoodOrStrategy={handleUpdateSessionMoodOrStrategy}
                  onUpdateSessionJournal={handleUpdateSessionJournal}
                  onSaveTracksToPlaylist={handleStudioSaveTracksToPlaylist}
                  onExpandSessionTracks={handleExpandSessionTracks}
                  onCatalogExpanded={handleCatalogExpanded}
                />
              </View>
            )}

            {visitedTabs.history && (
              <View style={[styles.tabPane, activeTab !== 'history' && styles.tabPaneHidden]}>
                <HistoryScreen
                  sessions={sessions}
                  selectedSession={selectedHistorySession}
                  stats={stats}
                  isActiveTab={activeTab === 'history'}
                  playingTrackId={currentTrack?.id || null}
                  isAudioPlaying={isAudioPlaying}
                  onOpenSession={handleOpenHistorySession}
                  onCloseSession={handleCloseHistorySession}
                  onPlayTrack={handlePlayTrack}
                  onToggleFavorite={handleToggleFavorite}
                  onTrackMorePress={handleSessionTrackMore}
                  onUpdateSessionMoodOrStrategy={handleUpdateSessionMoodOrStrategy}
                  onUpdateSessionJournal={handleUpdateSessionJournal}
                  onSaveTracksToPlaylist={handleHistorySaveTracksToPlaylist}
                  onExpandSessionTracks={handleExpandSessionTracks}
                  onDeleteSession={handleDeletePastSession}
                  onNewScan={handleHistoryNewScan}
                />
              </View>
            )}

            {visitedTabs.library && (
              <View style={[styles.tabPane, activeTab !== 'library' && styles.tabPaneHidden]}>
                <LibraryScreen
                  userId={user.id}
                  catalogTotal={stats.catalogTotal}
                  isActiveTab={activeTab === 'library'}
                  playlistsRefreshTick={playlistsRefreshTick}
                  playingTrackId={currentTrack?.id || null}
                  isAudioPlaying={isAudioPlaying}
                  onPlayTrack={handlePlayTrack}
                  onToggleFavorite={handleToggleFavorite}
                  onTrackMorePress={handleLibraryTrackMore}
                  onCatalogExpanded={handleCatalogExpanded}
                />
              </View>
            )}

            {visitedTabs.settings && (
              <View style={[styles.tabPane, activeTab !== 'settings' && styles.tabPaneHidden]}>
                <SettingsScreen
                  user={user}
                  stats={stats}
                  storageInfo={storageInfo}
                  adminMode={settingsAdminOpen}
                  isActiveTab={activeTab === 'settings'}
                  onSetAdminMode={handleSettingsSetAdminMode}
                  onPlayTrack={handlePlayTrack}
                  onDatabaseMutated={handleDatabaseMutated}
                  onBiometricSettingsChanged={handleDatabaseMutated}
                  onClearOwnHistory={handleClearOwnHistory}
                  onWipeAllData={handleWipeAllData}
                  onLogout={handleLogout}
                />
              </View>
            )}
          </View>

          {/* Invisible Dock Slot Anchor + iOS 27 Liquid Glass Pill Tab Bar */}
          <SafeAreaView
            edges={['bottom']}
            pointerEvents="box-none"
            style={styles.bottomDock}
          >
            {Boolean(currentTrack) && (
              <View style={styles.miniDockProbeOuter} pointerEvents="none">
                <View
                  ref={miniSlotRef}
                  onLayout={measureMiniSlot}
                  style={styles.miniDockProbe}
                  pointerEvents="none"
                />
              </View>
            )}

            <LiquidGlassTabBar
              tabs={dockTabs}
              activeTab={activeTab}
              onSelectTab={handleSelectTab}
            />
          </SafeAreaView>

          {/* Track Action Sheet (Playlist, Apple/Spotify/YT Music, Share, Dislike) */}
          <TrackActionSheetModal
            visible={Boolean(actionSheetState)}
            track={actionSheetState?.track || null}
            playlistName={actionSheetState?.playlistContext?.name}
            onClose={() => setActionSheetState(null)}
            onToggleFavorite={handleToggleFavorite}
            onAddToPlaylist={(track) =>
              setPlaylistPickerState({
                tracks: [track],
                suggestedName: '',
                suggestedMood: track.mood,
              })
            }
            onDislike={(track) => void handleDislikeTrack(track)}
            onRemoveFromPlaylist={
              actionSheetState?.playlistContext
                ? async (track) => {
                    const pl = actionSheetState.playlistContext;
                    if (!pl) return;
                    await removeTrackFromPlaylist(pl.id, user.id, track.id);
                    setPlaylistsRefreshTick((t) => t + 1);
                  }
                : undefined
            }
          />

          {/* Add to / Create Custom Playlist Modal */}
          <PlaylistPickerModal
            visible={Boolean(playlistPickerState)}
            userId={user.id}
            tracksToAdd={playlistPickerState?.tracks || []}
            suggestedName={playlistPickerState?.suggestedName}
            suggestedMood={playlistPickerState?.suggestedMood}
            onClose={() => setPlaylistPickerState(null)}
            onCompleted={(pl, added) => {
              setPlaylistsRefreshTick((t) => t + 1);
              if (added > 0) {
                Alert.alert('Listeye Eklendi', `“${pl.name}” listesine ${added} şarkı eklendi.`);
              } else {
                Alert.alert('Zaten Listede', `Seçilen şarkılar zaten “${pl.name}” listesinde.`);
              }
            }}
          />
          </SafeAreaView>

          {/* Unified Expanding Mini -> Full-Screen Audio Player */}
          <ExpandableAudioPlayer
            ref={playerSheetRef}
            miniBarFrame={miniBarFrame}
            player={player}
            queue={queue}
            queueIdx={queueIdx}
            isPlaying={isAudioPlaying}
            repeatOne={repeatOne}
            onStopAndDismiss={handleStopAndDismiss}
            onTogglePlay={handleTogglePlay}
            onPrevious={handlePreviousTrack}
            onNext={handleNextTrack}
            onSeek={handleSeekTo}
            onToggleRepeatOne={handleToggleRepeatOne}
            onSelectQueueIndex={handleSelectQueueIndex}
            onToggleFavorite={handleToggleFavorite}
            onAddToPlaylist={handleAddPlayerTrackToPlaylist}
            onDislike={handleDislikePlayerTrack}
          />
        </>
      )}

      {showSplash && <AnimatedSplashScreen onFinish={handleSplashFinish} />}
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
    tabPane: {
      flex: 1,
    },
    tabPaneHidden: {
      display: 'none',
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
    miniDockProbeOuter: {
      width: '100%',
      paddingHorizontal: 20,
      marginBottom: -3,
      alignItems: 'center',
    },
    miniDockProbe: {
      width: '100%',
      maxWidth: 376,
      height: 62,
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
