import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  getScanSessionWithTracks,
  listScanSessions,
  logoutActiveUser,
  restoreActiveUser,
  ScanSessionRecord,
  toggleFavoriteTrack,
  TrackRecord,
  UserRecord,
} from './src/database/iosDatabase';
import { CameraStudioScreen } from './src/screens/CameraStudioScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { resolveAiServerUrl, saveCustomAiServerUrl } from './src/services/moodAiService';
import { resolvePlayablePreviewUrl } from './src/services/onlineMusicService';
import { Colors } from './src/theme/colors';

type TabKey = 'studio' | 'history' | 'library';

function MainAppContent() {
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
    catalogTotal: 644,
  });

  // Audio preview state (expo-audio)
  const player = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(player);
  const [queue, setQueue] = useState<TrackRecord[]>([]);
  const [queueIdx, setQueueIdx] = useState<number>(-1);
  const currentTrack = queueIdx >= 0 && queueIdx < queue.length ? queue[queueIdx] : null;

  // Optional YOLOv8 Server URL Settings Modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');

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
      const detectedUrl = await resolveAiServerUrl();
      if (detectedUrl) setServerUrlInput(detectedUrl);
      setDbReady(true);
    })();
  }, []);

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
      // Ignore transient network hiccup while PC server is warming up
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
      setActiveTab('studio');
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
    <View style={{ flex: 1, backgroundColor: Colors.canvas }}>
      <StatusBar style="dark" />

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
                onPress={() => setSettingsOpen(true)}
                style={styles.headerIconBtn}
                hitSlop={6}
              >
                <Ionicons name="options-outline" size={19} color={Colors.inkPrimary} />
              </Pressable>

              <Pressable onPress={handleLogout} style={styles.logoutPill}>
                <Text style={styles.logoutText}>Çıkış</Text>
              </Pressable>
            </View>
          </View>

          {/* Active Screen */}
          <View style={{ flex: 1 }}>
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
                onSeeAllHistory={() => setActiveTab('history')}
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
                onNewScan={() => setActiveTab('studio')}
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
          </View>

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
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setActiveTab(tab.key);
                    }}
                    style={styles.tabItem}
                  >
                    <Ionicons
                      name={active ? tab.activeIcon : tab.icon}
                      size={22}
                      color={active ? Colors.brand : Colors.inkMuted}
                    />
                    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SafeAreaView>

          {/* YOLOv8 AI Server Settings Modal */}
          <Modal visible={settingsOpen} transparent animationType="fade">
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>YOLOv8 AI Sunucu Bağlantısı</Text>
                <Text style={styles.modalDesc}>
                  Expo Go aynı Wi-Fi ağındaki bilgisayarınızda çalışan Python YOLOv8 sunucusunu otomatik bulur. Gerekirse özel adres girebilirsiniz:
                </Text>
                <TextInput
                  value={serverUrlInput}
                  onChangeText={setServerUrlInput}
                  placeholder="http://192.168.1.x:8000"
                  placeholderTextColor={Colors.inkMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.modalInput}
                />
                <View style={styles.modalBtns}>
                  <Pressable
                    onPress={async () => {
                      await saveCustomAiServerUrl(null);
                      const autoUrl = await resolveAiServerUrl();
                      setServerUrlInput(autoUrl || '');
                      setSettingsOpen(false);
                    }}
                    style={styles.modalResetBtn}
                  >
                    <Text style={styles.modalResetText}>Otomatik Bul</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await saveCustomAiServerUrl(serverUrlInput);
                      setSettingsOpen(false);
                    }}
                    style={styles.modalSaveBtn}
                  >
                    <Text style={styles.modalSaveText}>Kaydet</Text>
                  </Pressable>
                </View>
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
      <MainAppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appSafe: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    backgroundColor: Colors.canvas,
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
    color: Colors.inkPrimary,
  },
  headerSub: {
    fontSize: 11,
    color: Colors.inkMuted,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.subtle,
  },
  logoutText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.inkSecondary,
  },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
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
    color: Colors.inkMuted,
  },
  tabLabelActive: {
    color: Colors.brand,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 16, 22, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 22,
    padding: 22,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.inkPrimary,
  },
  modalDesc: {
    marginTop: 6,
    fontSize: 13,
    color: Colors.inkSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  modalInput: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairlineStrong,
    backgroundColor: Colors.elevated,
    paddingHorizontal: 12,
    fontSize: 14.5,
    color: Colors.inkPrimary,
    marginBottom: 14,
  },
  modalBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalResetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: Colors.subtle,
  },
  modalResetText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.inkSecondary,
  },
  modalSaveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: Colors.brand,
  },
  modalSaveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
