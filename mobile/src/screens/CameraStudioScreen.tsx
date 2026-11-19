import { Ionicons } from '@expo/vector-icons';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AnimatedSegmentedControl,
  PulseDot,
  SpringPressable,
  StaggeredEntry,
} from '../components/MotionPrimitives';
import { TrackRow } from '../components/TrackRow';
import {
  captureAndSaveSessionOnServer,
  ScanSessionRecord,
  TrackRecord,
} from '../database/iosDatabase';
import { analyzeCameraFrame } from '../services/moodAiService';
import {
  emotionToMood,
  EmotionType,
  MoodType,
  resolveMoodVisual,
  ThemePalette,
} from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

function isFrontCameraSession(deviceLabel?: string | null): boolean {
  return Boolean(deviceLabel && deviceLabel.toLowerCase().includes('ön kamera'));
}

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
  visitTick?: number;
  launchCameraTick?: number;
  activeSession: ScanSessionRecord | null;
  recentScans: ScanSessionRecord[];
  playingTrackId: number | null;
  isAudioPlaying: boolean;
  onSessionCreated: (session: ScanSessionRecord) => void;
  onSelectPastSession: (sessionId: number) => void;
  onSeeAllHistory: () => void;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onToggleFavorite: (trackId: number) => void;
  onExpandSessionTracks: (
    sessionId: number,
    addCount: number,
    language: 'all' | 'tr' | 'global'
  ) => Promise<{ addedCount: number; totalCount: number } | null>;
  onCatalogExpanded: () => void;
}

const EXPAND_PRESETS = [5, 10, 15] as const;

export const CameraStudioScreen: React.FC<Props> = ({
  userId,
  userFirstName,
  isActiveTab,
  visitTick = 0,
  launchCameraTick = 0,
  activeSession,
  recentScans,
  playingTrackId,
  isAudioPlaying,
  onSessionCreated,
  onSelectPastSession,
  onSeeAllHistory,
  onPlayTrack,
  onToggleFavorite,
  onExpandSessionTracks,
  onCatalogExpanded,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [autoPausedNotice, setAutoPausedNotice] = useState(false);
  const [facing, setFacing] = useState<CameraType>('front');
  const [capturing, setCapturing] = useState(false);
  const [expandingCount, setExpandingCount] = useState<number | null>(null);
  const [expandNotice, setExpandNotice] = useState<string | null>(null);
  const [newlyAddedStartIndex, setNewlyAddedStartIndex] = useState<number | null>(null);
  const [langFilter, setLangFilter] = useState<'all' | 'tr' | 'global'>('all');

  // Top-right live mood & fine-grained emotion state
  const [liveMood, setLiveMood] = useState<MoodType | null>(null);
  const [liveEmotion, setLiveEmotion] = useState<EmotionType | null>(null);
  const [liveConf, setLiveConf] = useState<number>(0);
  const [liveStatusText, setLiveStatusText] = useState<string>('Yüz Aranıyor…');
  const [aiConnected, setAiConnected] = useState<boolean>(true);
  const [faceBox, setFaceBox] = useState<[number, number, number, number] | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<{
    previewBase64: string;
    mirrored: boolean;
  } | null>(null);

  const cameraRef = useRef<CameraView | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const cameraReadyRef = useRef(false);
  const liveBusyRef = useRef(false);
  const liveCapturePromiseRef = useRef<Promise<void> | null>(null);
  const capturingRef = useRef(false);
  const lastLaunchTickRef = useRef<number>(launchCameraTick || 0);
  const pendingExpandRef = useRef<{ sessionId: number; prevVisibleCount: number } | null>(null);
  const expandToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const cameraAppear = useRef(new Animated.Value(0)).current;
  const hudScale = useRef(new Animated.Value(1)).current;
  const flipSpin = useRef(new Animated.Value(0)).current;
  const playlistOpacity = useRef(new Animated.Value(1)).current;
  const playlistTranslateY = useRef(new Animated.Value(0)).current;
  const playlistScale = useRef(new Animated.Value(1)).current;

  const flipRotate = flipSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  // Smooth pulse on live mood HUD whenever detected emotion changes
  useEffect(() => {
    if (!liveEmotion) return;
    Animated.sequence([
      Animated.timing(hudScale, {
        toValue: 1.06,
        duration: 130,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(hudScale, {
        toValue: 1,
        damping: 14,
        stiffness: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [hudScale, liveEmotion]);

  // Smooth downward slide-in when a new photo scan session appears
  useEffect(() => {
    if (!activeSession?.id) return;
    playlistOpacity.setValue(0);
    playlistTranslateY.setValue(-34);
    playlistScale.setValue(0.95);
    Animated.parallel([
      Animated.timing(playlistOpacity, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(playlistTranslateY, {
        toValue: 0,
        damping: 18,
        stiffness: 150,
        mass: 0.8,
        useNativeDriver: true,
      }),
      Animated.spring(playlistScale, {
        toValue: 1,
        damping: 18,
        stiffness: 160,
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeSession?.id, playlistOpacity, playlistScale, playlistTranslateY]);

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
    const task = (async () => {
      try {
        // skipProcessing: false ensures iOS CoreImage normalizes portrait EXIF orientation properly!
        const frame = await cameraRef.current?.takePictureAsync({
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
        liveCapturePromiseRef.current = null;
      }
    })();

    liveCapturePromiseRef.current = task;
    await task;
  }, [cameraOpen, cameraReady, isActiveTab, permission?.granted]);

  const closeCamera = useCallback((reasonAutoPaused = false) => {
    cameraReadyRef.current = false;
    setCameraOpen(false);
    setCameraReady(false);
    setFaceBox(null);
    setLiveMood(null);
    setLiveEmotion(null);
    setLiveConf(0);
    setLiveStatusText('Yüz Aranıyor…');
    historyVotesRef.current = [];
    setAutoPausedNotice(reasonAutoPaused);
  }, []);

  const handleStartCamera = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    if (!permission?.granted) {
      const permRes = await requestPermission();
      if (!permRes.granted) {
        Alert.alert(
          'Kamera İzni Gerekli',
          'Canlı duygu analizi için Ayarlar üzerinden MoodSync kamera iznini açabilirsiniz.'
        );
        return;
      }
    }
    cameraReadyRef.current = false;
    setAutoPausedNotice(false);
    setCameraReady(false);
    setCameraOpen(true);
  }, [permission?.granted, requestPermission]);

  // Animate viewfinder entrance when opened
  useEffect(() => {
    if (!cameraOpen) {
      cameraAppear.setValue(0);
      return;
    }
    cameraAppear.setValue(0);
    Animated.timing(cameraAppear, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cameraAppear, cameraOpen]);

  // Auto-close camera when switching away from Camera tab
  useEffect(() => {
    if (!isActiveTab && cameraOpen) {
      closeCamera(false);
    }
  }, [cameraOpen, closeCamera, isActiveTab]);

  // Auto-close camera when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        closeCamera(false);
      }
    });
    return () => sub.remove();
  }, [closeCamera]);

  // Auto-close camera after 45 seconds of inactivity to save battery
  useEffect(() => {
    if (!cameraOpen || !isActiveTab || capturing) return;
    const timer = setTimeout(() => {
      closeCamera(true);
    }, 45000);
    return () => clearTimeout(timer);
  }, [cameraOpen, capturing, closeCamera, isActiveTab]);

  // Open camera when triggered explicitly via "Yeni Çekim" from History
  useEffect(() => {
    if (launchCameraTick && launchCameraTick !== lastLaunchTickRef.current) {
      lastLaunchTickRef.current = launchCameraTick;
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      handleStartCamera();
    }
  }, [handleStartCamera, launchCameraTick]);

  // Reset expand notice / stagger cutoff when session or language filter changes
  useEffect(() => {
    setExpandNotice(null);
    setNewlyAddedStartIndex(null);
    pendingExpandRef.current = null;
  }, [activeSession?.id]);

  useEffect(() => {
    setNewlyAddedStartIndex(null);
  }, [langFilter]);

  useEffect(() => {
    return () => {
      if (expandToastTimerRef.current) clearTimeout(expandToastTimerRef.current);
    };
  }, []);

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

  // Instant shutter capture: never requires live AI pre-lock; closes camera right away & analyzes in background!
  const handleShutterPress = async () => {
    if (capturingRef.current) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    triggerShutterFlash();
    setCapturing(true);
    capturingRef.current = true;
    setLiveStatusText('Fotoğraf Çekiliyor…');

    let capturedBase64: string | null = null;
    const isFrontLens = facing === 'front';
    const lensName = isFrontLens ? 'iPhone 16 Pro · Ön Kamera' : 'iPhone 16 Pro · Arka Kamera';

    const recentValid = Date.now() - lastLockRef.current.ts < 5000;
    const fallbackEmotion: EmotionType =
      recentValid && lastLockRef.current.emotion ? lastLockRef.current.emotion : 'neutral';
    const fallbackMood: MoodType =
      recentValid && lastLockRef.current.mood
        ? lastLockRef.current.mood
        : emotionToMood(fallbackEmotion);
    const fallbackConf =
      recentValid && lastLockRef.current.conf > 0 ? lastLockRef.current.conf : 0.82;

    try {
      // Wait briefly if camera hardware is still warming up (eliminates instant-tap errors)
      if (!cameraReadyRef.current) {
        const waitStart = Date.now();
        while (!cameraReadyRef.current && Date.now() - waitStart < 1200) {
          await new Promise((r) => setTimeout(r, 60));
        }
      }

      // Wait for any in-flight live preview capture so AVCapturePhotoOutput never collides
      if (liveCapturePromiseRef.current) {
        await liveCapturePromiseRef.current.catch(() => {});
      }

      const captureOnce = async () => {
        if (!cameraRef.current) {
          throw new Error('Kamera henüz hazır değil.');
        }
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
        return photo.base64;
      };

      try {
        capturedBase64 = await captureOnce();
      } catch {
        // Single gentle retry for iOS warm-up contention
        await new Promise((r) => setTimeout(r, 120));
        capturedBase64 = await captureOnce();
      }
    } catch (err: any) {
      setLiveStatusText('Tekrar Deneyin');
      if (err?.message) {
        Alert.alert('Fotoğraf Çekilemedi', err.message);
      }
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }

    if (!capturedBase64) return;

    // Close camera immediately and run emotion analysis + playlist generation in the background
    closeCamera(false);
    setPendingAnalysis({ previewBase64: capturedBase64, mirrored: isFrontLens });

    try {
      const newSession = await captureAndSaveSessionOnServer({
        userId,
        imageBase64: capturedBase64,
        fallbackMood,
        fallbackEmotion,
        fallbackConfidence: fallbackConf,
        deviceLabel: lensName,
        captureSource: 'camera',
        language: langFilter,
      });

      setAiConnected(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSessionCreated(newSession);
      onCatalogExpanded();

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 190, animated: true });
      }, 220);
    } catch (err: any) {
      if (err?.message) {
        Alert.alert('Tarama Tamamlanamadı', err.message);
      }
    } finally {
      setPendingAnalysis(null);
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

    if (cameraOpen) {
      closeCamera(false);
    }
    setPendingAnalysis({ previewBase64: pickedAsset.base64!, mirrored: false });
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
        scrollRef.current?.scrollTo({ y: 190, animated: true });
      }, 200);
    } catch (err: any) {
      if (err?.message) {
        Alert.alert('Fotoğraf Analiz Edilemedi', err.message);
      }
    } finally {
      setPendingAnalysis(null);
    }
  };

  const visibleTracks = useMemo(
    () =>
      (activeSession?.tracks || []).filter((t) =>
        langFilter === 'all' ? true : t.language === langFilter
      ),
    [activeSession?.tracks, langFilter]
  );

  const handleExpandActivePlaylist = async (addCount: number) => {
    if (!activeSession || expandingCount !== null) return;
    Haptics.selectionAsync().catch(() => {});
    setExpandingCount(addCount);
    pendingExpandRef.current = {
      sessionId: activeSession.id,
      prevVisibleCount: visibleTracks.length,
    };

    try {
      const res = await onExpandSessionTracks(activeSession.id, addCount, langFilter);
      if (res && res.addedCount > 0) {
        if (pendingExpandRef.current?.sessionId === activeSession.id) {
          setNewlyAddedStartIndex(pendingExpandRef.current.prevVisibleCount);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (expandToastTimerRef.current) clearTimeout(expandToastTimerRef.current);
        setExpandNotice(`+${res.addedCount} yeni şarkı eklendi · Toplam ${res.totalCount} şarkı`);
        expandToastTimerRef.current = setTimeout(() => setExpandNotice(null), 3200);
      } else {
        setNewlyAddedStartIndex(null);
        if (expandToastTimerRef.current) clearTimeout(expandToastTimerRef.current);
        setExpandNotice('Bu filtre için tüm mevcut şarkılar zaten listede.');
        expandToastTimerRef.current = setTimeout(() => setExpandNotice(null), 3200);
      }
    } catch {
      if (expandToastTimerRef.current) clearTimeout(expandToastTimerRef.current);
      setExpandNotice('Şarkılar eklenirken bir sorun oluştu.');
      expandToastTimerRef.current = setTimeout(() => setExpandNotice(null), 3200);
    } finally {
      pendingExpandRef.current = null;
      setExpandingCount(null);
    }
  };

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
      <StaggeredEntry index={0} animationKey={visitTick} style={styles.greetingBlock}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          style={styles.pageTitle}
        >
          Merhaba {userFirstName}, bugün hangi ritimdesin?
        </Text>
        <Text style={styles.pageSub}>
          Kamerayı açıp hemen fotoğrafını çek; duygu analizi ve şarkı listesi arka planda anında hazırlanır.
        </Text>
      </StaggeredEntry>

      {/* ON-DEMAND CAMERA CARD */}
      <StaggeredEntry index={1} animationKey={visitTick} style={styles.cameraCard}>
        {permission?.granted && cameraOpen ? (
          <>
            <Animated.View style={[styles.viewport, { opacity: cameraAppear }]}>
              {isActiveTab && (
                <CameraView
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  facing={facing}
                  animateShutter={false}
                  mute={true}
                  onCameraReady={() => {
                    cameraReadyRef.current = true;
                    setCameraReady(true);
                  }}
                />
              )}

              {/* Face Tracking Reticle */}
              {faceBox && (
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
              <View style={styles.topLeftPill}>
                <PulseDot color={aiConnected ? '#22C55E' : '#F59E0B'} size={6.5} />
                <Text style={styles.recText}>
                  {aiConnected ? 'CANLI · AI AKTİF' : 'BAĞLANIYOR…'}
                </Text>
              </View>

              {/* TOP-RIGHT LIVE MOOD HUD */}
              <Animated.View style={[styles.liveMoodHud, { transform: [{ scale: hudScale }] }]}>
                <View
                  style={[
                    styles.liveMoodDot,
                    liveMood
                      ? { backgroundColor: resolveMoodVisual(liveMood, liveEmotion, colors).dotColor }
                      : null,
                  ]}
                />
                <View>
                  <Text style={styles.liveHudEyebrow}>CANLI MOD</Text>
                  <Text style={styles.liveHudValue}>{liveStatusText}</Text>
                </View>
              </Animated.View>

              {/* Shutter Flash */}
              <Animated.View
                pointerEvents="none"
                style={[styles.flashOverlay, { opacity: flashOpacity }]}
              />

              {/* Bottom Camera Controls Overlay */}
              <View style={styles.cameraBottomBar}>
                <SpringPressable haptic onPress={handlePickFromLibrary} style={styles.auxCircleBtn}>
                  <Ionicons name="images-outline" size={21} color="#FFFFFF" />
                </SpringPressable>

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

                <SpringPressable
                  haptic
                  onPress={() => {
                    flipSpin.setValue(0);
                    Animated.spring(flipSpin, {
                      toValue: 1,
                      damping: 14,
                      stiffness: 180,
                      useNativeDriver: true,
                    }).start();
                    setFacing((prev) => (prev === 'front' ? 'back' : 'front'));
                  }}
                  style={styles.auxCircleBtn}
                >
                  <Animated.View style={{ transform: [{ rotate: flipRotate }] }}>
                    <Ionicons name="camera-reverse-outline" size={22} color="#FFFFFF" />
                  </Animated.View>
                </SpringPressable>
              </View>
            </Animated.View>

            <View style={styles.cameraFooter}>
              <Text style={styles.footerHint}>
                İfadeni canlı yakalar; çektiğinde kamera otomatik kapanır ve şarkı listesi açılır.
              </Text>
              <SpringPressable
                haptic
                onPress={() => closeCamera(false)}
                style={styles.closeCamBtn}
              >
                <Ionicons name="close" size={14} color={colors.danger} />
                <Text style={styles.closeCamText}>Kapat</Text>
              </SpringPressable>
            </View>
          </>
        ) : (
          <View style={styles.idleLaunchCard}>
            <View style={styles.idleHeader}>
              <View style={styles.idleIconBadge}>
                <Ionicons name="camera" size={22} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.idleTitle}>
                  {!permission?.granted ? 'iPhone Kamera İzni Gerekiyor' : 'Canlı Yüz Analizi'}
                </Text>
                <Text style={styles.idleSub}>
                  Yüz ifadenden anlık modunu yakala veya galeriden fotoğraf seç.
                </Text>
              </View>
            </View>

            <View style={styles.idleNoticePill}>
              <View
                style={[
                  styles.idleNoticeDot,
                  { backgroundColor: autoPausedNotice ? '#F59E0B' : colors.inkMuted },
                ]}
              />
              <Text style={styles.idleNoticeText}>
                {autoPausedNotice
                  ? 'Pil tasarrufu için kamera otomatik kapatıldı'
                  : !permission?.granted
                    ? 'Kamera izni verildiğinde canlı mod analizi aktif olur'
                    : 'Kamera kapalı · Yalnızca sen başlattığında açılır'}
              </Text>
            </View>

            <View style={styles.idleBtnRow}>
              <SpringPressable
                haptic
                onPress={handleStartCamera}
                style={styles.idlePrimaryBtn}
              >
                <Ionicons name="camera" size={17} color="#FFFFFF" />
                <Text style={styles.idlePrimaryText}>
                  {!permission?.granted ? 'Kameraya İzin Ver' : 'Kamerayı Başlat'}
                </Text>
              </SpringPressable>

              <SpringPressable
                haptic
                onPress={handlePickFromLibrary}
                style={styles.idleSecondaryBtn}
              >
                <Ionicons name="images-outline" size={17} color={colors.inkPrimary} />
                <Text style={styles.idleSecondaryText}>Galeriden Seç</Text>
              </SpringPressable>
            </View>
          </View>
        )}
      </StaggeredEntry>

      {/* BACKGROUND ANALYSIS STATUS CARD */}
      {pendingAnalysis && (
        <View style={styles.pendingAnalysisCard}>
          <Image
            source={{ uri: `data:image/jpeg;base64,${pendingAnalysis.previewBase64}` }}
            style={[styles.pendingThumb, pendingAnalysis.mirrored && styles.mirroredImage]}
          />
          <View style={{ flex: 1 }}>
            <View style={styles.pendingTitleRow}>
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={styles.pendingTitle}>Fotoğrafın analiz ediliyor…</Text>
            </View>
            <Text style={styles.pendingSub}>
              Duygu ifaden arka planda çözümleniyor ve moduna özel şarkı listesi hazırlanıyor.
            </Text>
          </View>
        </View>
      )}

      {/* ACTIVE SESSION RECOMMENDED PLAYLIST */}
      {activeSession && (() => {
        const activeMeta = resolveMoodVisual(activeSession.mood, activeSession.emotion, colors);
        const mirrored = isFrontCameraSession(activeSession.deviceLabel);
        return (
          <Animated.View
            style={[
              styles.playlistCard,
              {
                opacity: playlistOpacity,
                transform: [{ translateY: playlistTranslateY }, { scale: playlistScale }],
              },
            ]}
          >
            <View style={styles.sessionBanner}>
              {activeSession.snapshotUri ? (
                <Image
                  source={{ uri: activeSession.snapshotUri }}
                  style={[styles.snapThumb, mirrored && styles.mirroredImage]}
                />
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
                onPress={() => handleExpandActivePlaylist(8)}
                disabled={expandingCount !== null}
                style={styles.refreshOnlineBtn}
              >
                {expandingCount !== null ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : (
                  <Ionicons name="add-circle-outline" size={15} color={colors.brand} />
                )}
                <Text style={styles.refreshOnlineText}>
                  {expandingCount !== null ? 'Ekleniyor…' : '+8 Ekle'}
                </Text>
              </SpringPressable>
            </View>

            {expandNotice && (
              <View style={styles.expandToast}>
                <Ionicons name="sparkles" size={14} color={colors.brand} />
                <Text style={styles.expandToastText}>{expandNotice}</Text>
              </View>
            )}

            {visibleTracks.map((tr, idx) => (
              <TrackRow
                key={`${activeSession.id}-${tr.id}`}
                track={tr}
                index={idx}
                staggerIndex={
                  newlyAddedStartIndex !== null && idx >= newlyAddedStartIndex
                    ? idx - newlyAddedStartIndex
                    : idx
                }
                animationKey={`${activeSession.id}-${langFilter}`}
                isActiveTrack={playingTrackId === tr.id}
                isPlaying={playingTrackId === tr.id && isAudioPlaying}
                onPlayPress={() => onPlayTrack(visibleTracks, idx)}
                onToggleFavorite={() => onToggleFavorite(tr.id)}
              />
            ))}

            <View style={styles.expandFooter}>
              <Text style={styles.expandFooterLabel}>Şarkı Sayısını Artır</Text>
              <View style={styles.expandPresetRow}>
                {EXPAND_PRESETS.map((cnt) => {
                  const busyThis = expandingCount === cnt;
                  return (
                    <SpringPressable
                      key={cnt}
                      haptic
                      disabled={expandingCount !== null}
                      onPress={() => handleExpandActivePlaylist(cnt)}
                      style={[
                        styles.expandPresetPill,
                        cnt === 10 && styles.expandPresetPillPrimary,
                        expandingCount !== null && !busyThis && { opacity: 0.6 },
                      ]}
                    >
                      {busyThis ? (
                        <ActivityIndicator
                          size="small"
                          color={cnt === 10 ? '#FFFFFF' : colors.brand}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.expandPresetText,
                            cnt === 10 && styles.expandPresetTextPrimary,
                          ]}
                        >
                          +{cnt}
                        </Text>
                      )}
                    </SpringPressable>
                  );
                })}
              </View>
            </View>
          </Animated.View>
        );
      })()}

      {/* RECENT PAST SCANS STRIP ON MAIN INTERFACE */}
      <StaggeredEntry index={2} animationKey={visitTick} style={styles.recentSection}>
        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>Önceki Taramaların</Text>
          <SpringPressable haptic onPress={onSeeAllHistory}>
            <Text style={styles.seeAllText}>Tümünü Gör →</Text>
          </SpringPressable>
        </View>

        {recentScans.length === 0 ? (
          <Text style={styles.emptyRecentText}>
            Henüz geçmiş taraman yok. İlk fotoğrafını çektiğinde burada listelenecek.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 11 }}>
            {recentScans.slice(0, 8).map((scan, idx) => {
              const meta = resolveMoodVisual(scan.mood, scan.emotion, colors);
              const scanMirrored = isFrontCameraSession(scan.deviceLabel);
              return (
                <StaggeredEntry key={scan.id} index={idx} direction="left" animationKey={visitTick}>
                  <SpringPressable
                    haptic
                    scaleTo={0.96}
                    onPress={() => onSelectPastSession(scan.id)}
                    style={[
                      styles.recentMiniCard,
                      activeSession?.id === scan.id && styles.recentMiniCardActive,
                    ]}
                  >
                    {scan.snapshotUri ? (
                      <Image
                        source={{ uri: scan.snapshotUri }}
                        style={[styles.recentMiniThumb, scanMirrored && styles.mirroredImage]}
                      />
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
                  </SpringPressable>
                </StaggeredEntry>
              );
            })}
          </ScrollView>
        )}
      </StaggeredEntry>
    </ScrollView>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 150,
    },
    mirroredImage: {
      transform: [{ scaleX: -1 }],
    },
    greetingBlock: {
      marginBottom: 14,
    },
    pageTitle: {
      fontSize: 19,
      fontWeight: '800',
      letterSpacing: -0.5,
      color: colors.inkPrimary,
    },
    pendingAnalysisCard: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 13,
      borderWidth: 1,
      borderColor: colors.brand,
    },
    pendingThumb: {
      width: 56,
      height: 56,
      borderRadius: 13,
      backgroundColor: colors.subtle,
    },
    pendingTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    pendingTitle: {
      fontSize: 14.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    pendingSub: {
      marginTop: 3,
      fontSize: 12,
      color: colors.inkSecondary,
      lineHeight: 17,
    },
    pageSub: {
      marginTop: 4,
      fontSize: 13.5,
      color: colors.inkSecondary,
      lineHeight: 19,
    },
    cameraCard: {
      backgroundColor: colors.surface,
      borderRadius: 24,
      padding: 11,
      borderWidth: 1,
      borderColor: colors.hairline,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: colors.isDark ? 0.45 : 0.08,
      shadowRadius: 22,
      elevation: 5,
    },
    viewport: {
      width: '100%',
      aspectRatio: 3 / 4,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: colors.cameraBg,
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
      backgroundColor: colors.brand,
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
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
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
      backgroundColor: colors.hudGlass,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
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
      backgroundColor: 'rgba(0, 0, 0, 0.62)',
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
      backgroundColor: colors.brand,
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
      color: colors.inkMuted,
    },
    toggleCamLink: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.brand,
    },
    closeCamBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 999,
    },
    closeCamText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.danger,
    },
    idleLaunchCard: {
      padding: 6,
      gap: 12,
    },
    idleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    idleIconBadge: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: colors.brandSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    idleTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    idleSub: {
      fontSize: 12.5,
      color: colors.inkSecondary,
      marginTop: 2,
      lineHeight: 17,
    },
    idleNoticePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: colors.subtle,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 10,
    },
    idleNoticeDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
    },
    idleNoticeText: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.inkSecondary,
      flex: 1,
    },
    idleBtnRow: {
      flexDirection: 'row',
      gap: 9,
    },
    idlePrimaryBtn: {
      flex: 1.25,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      backgroundColor: colors.brand,
      paddingVertical: 12,
      borderRadius: 14,
    },
    idlePrimaryText: {
      fontSize: 13.5,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    idleSecondaryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.subtle,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingVertical: 12,
      borderRadius: 14,
    },
    idleSecondaryText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    expandToast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: colors.brandSoft,
      paddingHorizontal: 11,
      paddingVertical: 8,
      borderRadius: 11,
      marginBottom: 10,
    },
    expandToastText: {
      flex: 1,
      fontSize: 12,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    expandFooter: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    expandFooterLabel: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    expandPresetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    expandPresetPill: {
      minWidth: 46,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: colors.brandSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    expandPresetPillPrimary: {
      backgroundColor: colors.brand,
    },
    expandPresetText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: colors.brand,
    },
    expandPresetTextPrimary: {
      color: '#FFFFFF',
    },
    playlistCard: {
      marginTop: 18,
      backgroundColor: colors.surface,
      borderRadius: 24,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.hairline,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: colors.isDark ? 0.45 : 0.06,
      shadowRadius: 20,
      elevation: 4,
    },
    sessionBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.subtle,
      padding: 12,
      borderRadius: 16,
      marginBottom: 14,
    },
    snapThumb: {
      width: 62,
      height: 62,
      borderRadius: 13,
      backgroundColor: colors.surface,
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
      color: colors.inkSecondary,
    },
    playlistHeading: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    sessionMetaText: {
      fontSize: 11.5,
      color: colors.inkMuted,
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
      backgroundColor: colors.subtle,
      padding: 3,
      borderRadius: 10,
    },
    langTab: {
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 8,
    },
    langTabActive: {
      backgroundColor: colors.surface,
    },
    langTabText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    langTabTextActive: {
      color: colors.inkPrimary,
      fontWeight: '700',
    },
    refreshOnlineBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: colors.brandSoft,
    },
    refreshOnlineText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.brand,
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
      color: colors.inkPrimary,
    },
    seeAllText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.brand,
    },
    emptyRecentText: {
      fontSize: 13,
      color: colors.inkMuted,
    },
    recentMiniCard: {
      width: 215,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      padding: 10,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    recentMiniCardActive: {
      borderColor: colors.brand,
      backgroundColor: colors.elevated,
    },
    recentMiniThumb: {
      width: 48,
      height: 48,
      borderRadius: 11,
      backgroundColor: colors.subtle,
    },
    recentMoodLabel: {
      fontSize: 12.5,
      fontWeight: '800',
    },
    recentDateText: {
      fontSize: 11,
      color: colors.inkSecondary,
      marginTop: 2,
    },
    recentTrackCount: {
      fontSize: 10.5,
      color: colors.inkMuted,
      marginTop: 1,
    },
  });
