import { Ionicons } from '@expo/vector-icons';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TrackRow } from '../components/TrackRow';
import {
  captureAndSaveSessionOnServer,
  ScanSessionRecord,
  selectPlaylistForMood,
  TrackRecord,
} from '../database/iosDatabase';
import { analyzeCameraFrame } from '../services/moodAiService';
import {
  Colors,
  emotionToMood,
  EmotionType,
  MoodType,
  resolveMoodVisual,
} from '../theme/colors';

function deleteTempUriQuietly(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('file://')) return;
  try {
    const tmp = new File(uri);
    if (tmp.exists) {
      tmp.delete();
    }
  } catch {
    // Ignore temporary file cleanup error
  }
}

interface Props {
  userId: number;
  userFirstName: string;
  isActiveTab: boolean;
  activeSession: ScanSessionRecord | null;
  recentScans: ScanSessionRecord[];
  playingTrackId: number | null;
  isAudioPlaying: boolean;
  onSessionCreated: (session: ScanSessionRecord) => void;
  onSelectPastSession: (sessionId: number) => void;
  onSeeAllHistory: () => void;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onToggleFavorite: (trackId: number) => void;
  onCatalogExpanded: () => void;
}

export const CameraStudioScreen: React.FC<Props> = ({
  userId,
  userFirstName,
  isActiveTab,
  activeSession,
  recentScans,
  playingTrackId,
  isAudioPlaying,
  onSessionCreated,
  onSelectPastSession,
  onSeeAllHistory,
  onPlayTrack,
  onToggleFavorite,
  onCatalogExpanded,
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>('front');
  const [capturing, setCapturing] = useState(false);
  const [refreshingPlaylist, setRefreshingPlaylist] = useState(false);
  const [langFilter, setLangFilter] = useState<'all' | 'tr' | 'global'>('all');

  // Top-right live mood & fine-grained emotion state
  const [liveMood, setLiveMood] = useState<MoodType | null>(null);
  const [liveEmotion, setLiveEmotion] = useState<EmotionType | null>(null);
  const [liveConf, setLiveConf] = useState<number>(0);
  const [liveStatusText, setLiveStatusText] = useState<string>('Yüz Aranıyor…');
  const [aiConnected, setAiConnected] = useState<boolean>(true);
  const [faceBox, setFaceBox] = useState<[number, number, number, number] | null>(null);

  const cameraRef = useRef<CameraView | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const liveBusyRef = useRef(false);
  const capturingRef = useRef(false);
  const historyVotesRef = useRef<Array<{ emotion: EmotionType; mood: MoodType; conf: number }>>([]);
  const lastLockRef = useRef<{
    mood: MoodType | null;
    emotion: EmotionType | null;
    conf: number;
    ts: number;
  }>({
    mood: null,
    emotion: null,
    conf: 0,
    ts: 0,
  });
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Live mood detection loop on iPhone 16 Pro camera stream
  const runLiveDetectionTick = useCallback(async () => {
    if (
      !isActiveTab ||
      !cameraOpen ||
      !cameraReady ||
      !permission?.granted ||
      liveBusyRef.current ||
      capturingRef.current ||
      !cameraRef.current
    ) {
      return;
    }

    liveBusyRef.current = true;
    try {
      // skipProcessing: false ensures iOS CoreImage normalizes portrait EXIF orientation properly!
      const frame = await cameraRef.current.takePictureAsync({
        quality: 0.30,
        base64: true,
        skipProcessing: false,
        shutterSound: false,
      });
      deleteTempUriQuietly(frame?.uri);

      if (!frame?.base64 || capturingRef.current) return;

      const det = await analyzeCameraFrame(frame.base64, false);
      setAiConnected(det.serverConnected);

      if (!det.serverConnected) {
        setLiveMood(null);
        setLiveEmotion(null);
        setLiveStatusText('AI Sunucu Bekleniyor…');
        setFaceBox(null);
        return;
      }

      if (det.detected && det.mood) {
        const curEmotion: EmotionType =
          det.emotion ||
          (det.mood === 'positive' ? 'happy' : det.mood === 'negative' ? 'sad' : 'neutral');

        historyVotesRef.current.push({
          emotion: curEmotion,
          mood: det.mood,
          conf: det.confidence,
        });
        if (historyVotesRef.current.length > 2) {
          historyVotesRef.current.shift();
        }

        // Weight the newest frame 2.2x so frowning/angry/smiling responds immediately (<0.8s)
        const weights: Record<string, number> = {};
        let confWeighted = 0;
        let totalWeight = 0;
        historyVotesRef.current.forEach((v, idx) => {
          const w = idx === historyVotesRef.current.length - 1 ? 2.2 : 1.0;
          weights[v.emotion] = (weights[v.emotion] || 0) + w * Math.max(0.35, v.conf);
          confWeighted += v.conf * w;
          totalWeight += w;
        });

        const winnerEmotion = (Object.keys(weights).sort((a, b) => weights[b] - weights[a])[0] ||
          curEmotion) as EmotionType;
        const winnerMood = emotionToMood(winnerEmotion);
        const avgConf = confWeighted / Math.max(1, totalWeight);
        const pct = Math.round(avgConf * 100);
        const visual = resolveMoodVisual(winnerMood, winnerEmotion);

        lastLockRef.current = {
          mood: winnerMood,
          emotion: winnerEmotion,
          conf: avgConf,
          ts: Date.now(),
        };
        setLiveMood(winnerMood);
        setLiveEmotion(winnerEmotion);
        setLiveConf(avgConf);
        setLiveStatusText(`${visual.shortTr} · %${pct}`);
        setFaceBox(det.faceBox);
      } else {
        historyVotesRef.current = [];
        setLiveMood(null);
        setLiveEmotion(null);
        setLiveStatusText('Yüz Aranıyor…');
        setFaceBox(null);
      }
    } catch {
      // Ignore single-frame capture contention
    } finally {
      liveBusyRef.current = false;
    }
  }, [cameraOpen, cameraReady, isActiveTab, permission?.granted]);

  useEffect(() => {
    if (!isActiveTab || !cameraOpen || !cameraReady || !permission?.granted) {
      return;
    }
    const interval = setInterval(runLiveDetectionTick, 780);
    return () => clearInterval(interval);
  }, [cameraOpen, cameraReady, isActiveTab, permission?.granted, runLiveDetectionTick]);

  const triggerShutterFlash = () => {
    flashOpacity.setValue(0.9);
    Animated.timing(flashOpacity, {
      toValue: 0,
      duration: 340,
      useNativeDriver: true,
    }).start();
  };

  // Press "Fotoğraf Çek" -> Send directly to PC server, delete temp file on iPhone, save only in PC moodsync.db!
  const handleShutterPress = async () => {
    if (!cameraRef.current || capturing) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    triggerShutterFlash();
    setCapturing(true);
    capturingRef.current = true;
    setLiveStatusText('Analiz Ediliyor…');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.55,
        base64: true,
        skipProcessing: false,
        shutterSound: false,
      });
      deleteTempUriQuietly(photo?.uri);

      if (!photo?.base64) {
        throw new Error('Kameradan görüntü alınamadı.');
      }

      const recentValid = Date.now() - lastLockRef.current.ts < 5000;
      const fallbackEmotion: EmotionType =
        recentValid && lastLockRef.current.emotion ? lastLockRef.current.emotion : 'neutral';
      const fallbackMood: MoodType =
        recentValid && lastLockRef.current.mood
          ? lastLockRef.current.mood
          : emotionToMood(fallbackEmotion);
      const fallbackConf =
        recentValid && lastLockRef.current.conf > 0 ? lastLockRef.current.conf : 0.82;

      const lensName =
        facing === 'front' ? 'iPhone 16 Pro · Ön Kamera' : 'iPhone 16 Pro · Arka Kamera';

      const newSession = await captureAndSaveSessionOnServer({
        userId,
        imageBase64: photo.base64,
        fallbackMood,
        fallbackEmotion,
        fallbackConfidence: fallbackConf,
        deviceLabel: lensName,
        captureSource: 'camera',
        language: langFilter,
      });

      setAiConnected(true);
      const visual = resolveMoodVisual(newSession.mood, newSession.emotion);
      setLiveMood(newSession.mood);
      setLiveEmotion(newSession.emotion || null);
      setLiveConf(newSession.confidence);
      setLiveStatusText(`${visual.shortTr} · %${Math.round(newSession.confidence * 100)}`);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSessionCreated(newSession);
      onCatalogExpanded();

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 470, animated: true });
      }, 220);
    } catch (err: any) {
      setLiveStatusText('Tekrar Deneyin');
      if (err?.message) {
        Alert.alert('Tarama Tamamlanamadı', err.message);
      }
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  };

  const handlePickFromLibrary = async () => {
    Haptics.selectionAsync().catch(() => {});
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.55,
      base64: true,
      allowsEditing: true,
      aspect: [3, 4],
    });
    if (res.canceled || !res.assets?.[0]?.base64) return;

    const pickedAsset = res.assets[0];
    deleteTempUriQuietly(pickedAsset.uri);

    setCapturing(true);
    try {
      const newSession = await captureAndSaveSessionOnServer({
        userId,
        imageBase64: pickedAsset.base64!,
        fallbackMood: 'neutral',
        fallbackEmotion: 'neutral',
        fallbackConfidence: 0.8,
        deviceLabel: 'iPhone Fotoğraf Arşivi',
        captureSource: 'upload',
        language: langFilter,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSessionCreated(newSession);
      onCatalogExpanded();
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 470, animated: true });
      }, 200);
    } catch (err: any) {
      if (err?.message) {
        Alert.alert('Fotoğraf Analiz Edilemedi', err.message);
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleRefreshOnlinePlaylist = async () => {
    if (!activeSession || refreshingPlaylist) return;
    Haptics.selectionAsync().catch(() => {});
    setRefreshingPlaylist(true);
    try {
      const freshTracks = await selectPlaylistForMood(
        activeSession.mood,
        userId,
        16,
        langFilter,
        activeSession.emotion || null
      );
      onCatalogExpanded();
      onSessionCreated({
        ...activeSession,
        tracks: freshTracks,
        trackCount: freshTracks.length,
      });
    } finally {
      setRefreshingPlaylist(false);
    }
  };

  const visibleTracks = (activeSession?.tracks || []).filter((t) =>
    langFilter === 'all' ? true : t.language === langFilter
  );

  const formatTimeTR = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting Header */}
      <View style={styles.greetingBlock}>
        <Text style={styles.pageTitle}>Merhaba {userFirstName}, bugün hangi ritimdesin?</Text>
        <Text style={styles.pageSub}>
          Kamerada sağ üstten canlı modunu takip et, fotoğraf çek tuşuna basarak anlık şarkı listeni oluştur.
        </Text>
      </View>

      {/* LIVE CAMERA CARD */}
      <View style={styles.cameraCard}>
        <View style={styles.viewport}>
          {permission?.granted && cameraOpen && isActiveTab ? (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              animateShutter={false}
              mute={true}
              onCameraReady={() => setCameraReady(true)}
            />
          ) : (
            <View style={styles.permissionBox}>
              <View style={styles.permIconWrap}>
                <Ionicons name="camera-outline" size={32} color="#FFFFFF" />
              </View>
              <Text style={styles.permTitle}>
                {!permission?.granted ? 'iPhone Kamera İzni Gerekiyor' : 'Kamera Duraklatıldı'}
              </Text>
              <Text style={styles.permDesc}>
                {!permission?.granted
                  ? 'Canlı duygu analizi ve mod göstergesi için kamera erişimine izin verin.'
                  : 'Canlı yüz ifadesi analizine devam etmek için kamerayı başlatın.'}
              </Text>
              <View style={styles.permBtnRow}>
                <Pressable
                  onPress={() => {
                    if (!permission?.granted) {
                      requestPermission();
                    } else {
                      setCameraOpen(true);
                    }
                  }}
                  style={styles.startCamBtn}
                >
                  <Text style={styles.startCamBtnText}>
                    {!permission?.granted ? 'Kameraya İzin Ver' : 'Kamerayı Aç'}
                  </Text>
                </Pressable>
                <Pressable onPress={handlePickFromLibrary} style={styles.secondaryCamBtn}>
                  <Text style={styles.secondaryCamBtnText}>Galeriden Seç</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Face Tracking Reticle */}
          {permission?.granted && cameraOpen && faceBox && (
            <View
              pointerEvents="none"
              style={[
                styles.reticle,
                {
                  left: `${(facing === 'front' ? 1 - faceBox[2] : faceBox[0]) * 100}%`,
                  top: `${faceBox[1] * 100}%`,
                  width: `${Math.max(18, (faceBox[2] - faceBox[0]) * 100)}%`,
                  height: `${Math.max(18, (faceBox[3] - faceBox[1]) * 100)}%`,
                },
              ]}
            >
              <View style={[styles.corner, styles.cTL]} />
              <View style={[styles.corner, styles.cTR]} />
              <View style={[styles.corner, styles.cBL]} />
              <View style={[styles.corner, styles.cBR]} />
            </View>
          )}

          {/* Top-Left Live Stream Pill */}
          {permission?.granted && cameraOpen && (
            <View style={styles.topLeftPill}>
              <View
                style={[
                  styles.recDot,
                  { backgroundColor: aiConnected ? '#22C55E' : '#F59E0B' },
                ]}
              />
              <Text style={styles.recText}>
                {aiConnected ? 'CANLI · AI AKTİF' : 'BAĞLANIYOR…'}
              </Text>
            </View>
          )}

          {/* TOP-RIGHT LIVE MOOD HUD (Core Requirement: Sağ Yukarıda Canlı Mod Göstergesi) */}
          <View style={styles.liveMoodHud}>
            <View
              style={[
                styles.liveMoodDot,
                liveMood
                  ? { backgroundColor: resolveMoodVisual(liveMood, liveEmotion).dotColor }
                  : null,
              ]}
            />
            <View>
              <Text style={styles.liveHudEyebrow}>CANLI MOD</Text>
              <Text style={styles.liveHudValue}>
                {permission?.granted && cameraOpen ? liveStatusText : 'Kamera Kapalı'}
              </Text>
            </View>
          </View>

          {/* Shutter Flash */}
          <Animated.View
            pointerEvents="none"
            style={[styles.flashOverlay, { opacity: flashOpacity }]}
          />

          {/* Bottom Camera Controls Overlay */}
          {permission?.granted && cameraOpen && (
            <View style={styles.cameraBottomBar}>
              <Pressable onPress={handlePickFromLibrary} style={styles.auxCircleBtn}>
                <Ionicons name="images-outline" size={21} color="#FFFFFF" />
              </Pressable>

              <Pressable
                onPress={handleShutterPress}
                disabled={capturing}
                style={({ pressed }) => [
                  styles.shutterOuter,
                  pressed && { transform: [{ scale: 0.92 }] },
                ]}
              >
                <View style={[styles.shutterInner, capturing && styles.shutterInnerBusy]}>
                  {capturing && <ActivityIndicator color="#FFFFFF" size="small" />}
                </View>
              </Pressable>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setFacing((prev) => (prev === 'front' ? 'back' : 'front'));
                }}
                style={styles.auxCircleBtn}
              >
                <Ionicons name="camera-reverse-outline" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.cameraFooter}>
          <Text style={styles.footerHint}>
            Mutlu, Dingin, Üzgün veya Kızgın ifadeni canlı yakalar; çektiğinde uygun şarkıları listeler.
          </Text>
          {permission?.granted && (
            <Pressable onPress={() => setCameraOpen((v) => !v)}>
              <Text style={styles.toggleCamLink}>{cameraOpen ? 'Duraklat' : 'Aç'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ACTIVE SESSION RECOMMENDED PLAYLIST */}
      {activeSession && (() => {
        const activeMeta = resolveMoodVisual(activeSession.mood, activeSession.emotion);
        return (
          <View style={styles.playlistCard}>
            <View style={styles.sessionBanner}>
              {activeSession.snapshotUri ? (
                <Image source={{ uri: activeSession.snapshotUri }} style={styles.snapThumb} />
              ) : (
                <View style={[styles.snapThumb, styles.snapFallback]}>
                  <Ionicons name="sparkles" size={22} color={activeMeta.color} />
                </View>
              )}

              <View style={{ flex: 1 }}>
                <View style={styles.badgeLine}>
                  <View
                    style={[
                      styles.moodPill,
                      { backgroundColor: activeMeta.softColor },
                    ]}
                  >
                    <Text style={[styles.moodPillText, { color: activeMeta.color }]}>
                      {activeMeta.fullTr}
                    </Text>
                  </View>
                  <Text style={styles.confText}>%{Math.round(activeSession.confidence * 100)} güven</Text>
                </View>
                <Text style={styles.playlistHeading}>Moduna Uygun Şarkı Listesi</Text>
                <Text style={styles.sessionMetaText}>
                  {formatTimeTR(activeSession.createdAt)} · {activeSession.deviceLabel}
                </Text>
              </View>
            </View>

            <View style={styles.filterToolbar}>
              <View style={styles.langTabs}>
                {(['all', 'tr', 'global'] as const).map((lg) => (
                  <Pressable
                    key={lg}
                    onPress={() => setLangFilter(lg)}
                    style={[styles.langTab, langFilter === lg && styles.langTabActive]}
                  >
                    <Text style={[styles.langTabText, langFilter === lg && styles.langTabTextActive]}>
                      {lg === 'all' ? 'Tümü' : lg === 'tr' ? 'Türkçe' : 'Yabancı'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                onPress={handleRefreshOnlinePlaylist}
                disabled={refreshingPlaylist}
                style={styles.refreshOnlineBtn}
              >
                <Ionicons name="refresh" size={14} color={Colors.brand} />
                <Text style={styles.refreshOnlineText}>
                  {refreshingPlaylist ? 'Çekiliyor…' : 'İnternetten Yenile'}
                </Text>
              </Pressable>
            </View>

            {visibleTracks.map((tr, idx) => (
              <TrackRow
                key={tr.id}
                track={tr}
                isActiveTrack={playingTrackId === tr.id}
                isPlaying={playingTrackId === tr.id && isAudioPlaying}
                onPlayPress={() => onPlayTrack(visibleTracks, idx)}
                onToggleFavorite={() => onToggleFavorite(tr.id)}
              />
            ))}
          </View>
        );
      })()}

      {/* RECENT PAST SCANS STRIP ON MAIN INTERFACE */}
      <View style={styles.recentSection}>
        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>Önceki Taramaların</Text>
          <Pressable onPress={onSeeAllHistory}>
            <Text style={styles.seeAllText}>Tümünü Gör →</Text>
          </Pressable>
        </View>

        {recentScans.length === 0 ? (
          <Text style={styles.emptyRecentText}>
            Henüz geçmiş taraman yok. İlk fotoğrafını çektiğinde burada listelenecek.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 11 }}>
            {recentScans.slice(0, 8).map((scan) => {
              const meta = resolveMoodVisual(scan.mood, scan.emotion);
              return (
                <Pressable
                  key={scan.id}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onSelectPastSession(scan.id);
                  }}
                  style={[
                    styles.recentMiniCard,
                    activeSession?.id === scan.id && styles.recentMiniCardActive,
                  ]}
                >
                  {scan.snapshotUri ? (
                    <Image source={{ uri: scan.snapshotUri }} style={styles.recentMiniThumb} />
                  ) : (
                    <View style={[styles.recentMiniThumb, styles.snapFallback]}>
                      <Ionicons name="musical-note" size={18} color={meta.color} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.recentMoodLabel, { color: meta.color }]}>
                      {meta.shortTr} · %{Math.round(scan.confidence * 100)}
                    </Text>
                    <Text numberOfLines={1} style={styles.recentDateText}>
                      {formatTimeTR(scan.createdAt)}
                    </Text>
                    <Text style={styles.recentTrackCount}>{scan.trackCount} şarkı</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 150,
  },
  greetingBlock: {
    marginBottom: 14,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: Colors.inkPrimary,
  },
  pageSub: {
    marginTop: 4,
    fontSize: 13.5,
    color: Colors.inkSecondary,
    lineHeight: 19,
  },
  cameraCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 11,
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: '#181D25',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 5,
  },
  viewport: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: Colors.cameraBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionBox: {
    paddingHorizontal: 26,
    alignItems: 'center',
  },
  permIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  permTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  permDesc: {
    marginTop: 6,
    fontSize: 13,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  permBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  startCamBtn: {
    backgroundColor: Colors.brand,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
  },
  startCamBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13.5,
  },
  secondaryCamBtn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  secondaryCamBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13.5,
  },
  topLeftPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(14, 16, 22, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  recDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FF4D4D',
  },
  recText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  liveMoodHud: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.hudGlass,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  liveMoodDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  liveHudEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: 'rgba(255,255,255,0.65)',
  },
  liveHudValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reticle: {
    position: 'absolute',
  },
  corner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderColor: 'rgba(255,255,255,0.88)',
  },
  cTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 8 },
  cTR: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 8 },
  cBL: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 8 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 8 },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
  },
  cameraBottomBar: {
    position: 'absolute',
    bottom: 16,
    left: 22,
    right: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  auxCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(14, 16, 22, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    padding: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInnerBusy: {
    backgroundColor: Colors.brand,
  },
  cameraFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 2,
    gap: 10,
  },
  footerHint: {
    flex: 1,
    fontSize: 12,
    color: Colors.inkMuted,
  },
  toggleCamLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.brand,
  },
  playlistCard: {
    marginTop: 18,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: '#181D25',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
  sessionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.subtle,
    padding: 12,
    borderRadius: 16,
    marginBottom: 14,
  },
  snapThumb: {
    width: 62,
    height: 62,
    borderRadius: 13,
    backgroundColor: Colors.surface,
  },
  snapFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  moodPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  moodPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  confText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: Colors.inkSecondary,
  },
  playlistHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.inkPrimary,
  },
  sessionMetaText: {
    fontSize: 11.5,
    color: Colors.inkMuted,
    marginTop: 1,
  },
  filterToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  langTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.subtle,
    padding: 3,
    borderRadius: 10,
  },
  langTab: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
  },
  langTabActive: {
    backgroundColor: Colors.surface,
  },
  langTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.inkSecondary,
  },
  langTabTextActive: {
    color: Colors.inkPrimary,
    fontWeight: '700',
  },
  refreshOnlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.brandSoft,
  },
  refreshOnlineText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.brand,
  },
  recentSection: {
    marginTop: 22,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.inkPrimary,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.brand,
  },
  emptyRecentText: {
    fontSize: 13,
    color: Colors.inkMuted,
  },
  recentMiniCard: {
    width: 215,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  recentMiniCardActive: {
    borderColor: Colors.brand,
    backgroundColor: Colors.elevated,
  },
  recentMiniThumb: {
    width: 48,
    height: 48,
    borderRadius: 11,
    backgroundColor: Colors.subtle,
  },
  recentMoodLabel: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  recentDateText: {
    fontSize: 11,
    color: Colors.inkSecondary,
    marginTop: 2,
  },
  recentTrackCount: {
    fontSize: 10.5,
    color: Colors.inkMuted,
    marginTop: 1,
  },
});
