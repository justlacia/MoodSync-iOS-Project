import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  adminCleanOrphanSnapshots,
  adminCreateUser,
  AdminDatabaseOverview,
  adminDeleteScanSession,
  adminDeleteTrack,
  adminDeleteUser,
  AdminFavoriteRecord,
  adminGetScanSessionWithTracks,
  adminInspectTable,
  adminListAllScanSessions,
  adminListFavorites,
  adminListUsers,
  adminResetUserPassword,
  adminRunReadOnlyQuery,
  adminSeedCloudCatalog,
  AdminScanSessionRecord,
  AdminTableName,
  AdminUserSummary,
  getAdminDatabaseOverview,
  isAdminUser,
  TrackRecord,
  UserRecord,
} from '../database/iosDatabase';
import { getAiEngineSummary } from '../services/moodAiService';
import {
  EmotionType,
  MoodType,
  resolveMoodVisual,
  ThemePalette,
} from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import {
  AnimatedProgressBar,
  AnimatedSegmentedControl,
  PulseDot,
  SpringPressable,
  StaggeredEntry,
} from '../components/MotionPrimitives';

type AdminSubTab = 'overview' | 'users' | 'scans' | 'database';
type BrowserTable = AdminTableName | 'prefs';

const SUB_TAB_ORDER: AdminSubTab[] = ['overview', 'users', 'scans', 'database'];

const SQL_PRESETS: Array<{ label: string; sql: string }> = [
  {
    label: 'Tablolar',
    sql: "SELECT tablename AS name, 'table' AS type FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  },
  {
    label: 'Kullanıcılar',
    sql: 'SELECT id, username, display_name, role, created_at FROM users ORDER BY id',
  },
  {
    label: 'Son 15 Tarama',
    sql: 'SELECT s.id, u.username, s.mood, s.emotion, ROUND((s.confidence*100)::numeric) AS pct, s.created_at FROM scan_sessions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 15',
  },
  {
    label: 'Mod Özeti',
    sql: 'SELECT mood, emotion, COUNT(*) AS adet FROM scan_sessions GROUP BY mood, emotion ORDER BY adet DESC',
  },
  {
    label: 'En Popüler Şarkılar',
    sql: 'SELECT id, title, artist, mood, language, popularity FROM tracks ORDER BY popularity DESC LIMIT 15',
  },
];

interface Props {
  currentUser: UserRecord;
  isActiveTab?: boolean;
  skipInitialEntrance?: boolean;
  onBack: () => void;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onDatabaseMutated: () => void;
  onWipeAllData: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTR(iso: string | null | undefined): string {
  if (!iso) return '—';
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
}

function resolveEmotionVisualSafe(emotionOrMood: string, palette: ThemePalette) {
  const knownEmotions: EmotionType[] = ['happy', 'surprise', 'neutral', 'sad', 'angry'];
  if (knownEmotions.includes(emotionOrMood as EmotionType)) {
    const em = emotionOrMood as EmotionType;
    const mood: MoodType =
      em === 'happy' || em === 'surprise'
        ? 'positive'
        : em === 'neutral'
          ? 'neutral'
          : 'negative';
    return resolveMoodVisual(mood, em, palette);
  }
  const mood: MoodType =
    emotionOrMood === 'positive'
      ? 'positive'
      : emotionOrMood === 'negative'
        ? 'negative'
        : 'neutral';
  return resolveMoodVisual(mood, null, palette);
}

export const AdminPanelScreen: React.FC<Props> = ({
  currentUser,
  isActiveTab = true,
  skipInitialEntrance = false,
  onBack,
  onPlayTrack,
  onDatabaseMutated,
  onWipeAllData,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const engineInfo = getAiEngineSummary();

  const [subTab, setSubTab] = useState<AdminSubTab>('overview');
  const [loading, setLoading] = useState(true);

  // Overview + Lists
  const [overview, setOverview] = useState<AdminDatabaseOverview | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [scansState, setScansState] = useState<{
    rows: AdminScanSessionRecord[];
  }>({
    rows: [],
  });
  const [scanFilterUserId, setScanFilterUserId] = useState<number | null>(null);
  const scansFilterMountedRef = useRef(false);
  const scanRequestIdRef = useRef(0);

  // Create user inline form
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  // Password reset modal
  const [passwordModalUser, setPasswordModalUser] = useState<AdminUserSummary | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Scan detail modal
  const [detailScan, setDetailScan] = useState<AdminScanSessionRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Database explorer state
  const [activeTable, setActiveTable] = useState<BrowserTable>('users');
  const [tableState, setTableState] = useState<{
    table: BrowserTable;
    rows: Record<string, unknown>[];
    totalCount: number;
  }>({
    table: 'users',
    rows: [],
    totalCount: 0,
  });
  const [favoriteLinks, setFavoriteLinks] = useState<AdminFavoriteRecord[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [tableLoading, setTableLoading] = useState(false);
  const tableRequestIdRef = useRef(0);

  // SQL Console state
  const [sqlText, setSqlText] = useState(SQL_PRESETS[0].sql);
  const [sqlRunning, setSqlRunning] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlResult, setSqlResult] = useState<{
    columns: string[];
    rows: Record<string, unknown>[];
    totalRows: number;
    elapsedMs: number;
  } | null>(null);

  // Sub-tab directional transition animation
  const prevSubTabRef = useRef<AdminSubTab>(subTab);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentTranslateX = useRef(new Animated.Value(0)).current;
  const subTabAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // Refresh button spin animation
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const switchSubTab = useCallback(
    (next: AdminSubTab) => {
      if (next === subTab) return;
      setSubTab(next);
    },
    [subTab]
  );

  useLayoutEffect(() => {
    if (prevSubTabRef.current === subTab) return;
    const prevIdx = SUB_TAB_ORDER.indexOf(prevSubTabRef.current);
    const nextIdx = SUB_TAB_ORDER.indexOf(subTab);
    const dir = nextIdx >= prevIdx ? 1 : -1;
    prevSubTabRef.current = subTab;

    subTabAnimRef.current?.stop();
    contentOpacity.setValue(0.35);
    contentTranslateX.setValue(dir * 28);

    const anim = Animated.parallel([
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(contentTranslateX, {
        toValue: 0,
        damping: 20,
        stiffness: 210,
        mass: 0.78,
        useNativeDriver: true,
      }),
    ]);
    subTabAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && subTabAnimRef.current === anim) {
        subTabAnimRef.current = null;
      }
    });
  }, [contentOpacity, contentTranslateX, subTab]);

  useEffect(() => {
    return () => {
      subTabAnimRef.current?.stop();
      spinAnimRef.current?.stop();
    };
  }, []);

  const loadTableData = useCallback(
    async (table: BrowserTable, prefsSnapshot?: Record<string, string>) => {
      const reqId = ++tableRequestIdRef.current;
      setTableLoading(true);
      try {
        if (table === 'prefs') {
          const prefsObj = prefsSnapshot || overview?.prefs || {};
          const entries = Object.entries(prefsObj).map(([key, value]) => ({ key, value }));
          if (reqId !== tableRequestIdRef.current) return;
          setTableState({
            table,
            rows: entries,
            totalCount: entries.length,
          });
          setFavoriteLinks([]);
          return;
        }
        const inspected = await adminInspectTable(table, 60);
        if (reqId !== tableRequestIdRef.current) return;
        setTableState({
          table,
          rows: inspected.rows,
          totalCount: inspected.totalCount,
        });

        if (table === 'favorites') {
          const favs = await adminListFavorites(80);
          if (reqId !== tableRequestIdRef.current) return;
          setFavoriteLinks(favs);
        } else {
          setFavoriteLinks([]);
        }
      } catch (err: any) {
        Alert.alert('Tablo Okunamadı', err?.message || 'Tablo verisi yüklenemedi.');
      } finally {
        if (reqId === tableRequestIdRef.current) {
          setTableLoading(false);
        }
      }
    },
    [overview?.prefs]
  );

  const loadAllAdminData = useCallback(async () => {
    const reqId = ++scanRequestIdRef.current;
    setLoading(true);
    spinAnimRef.current?.stop();
    spinAnim.setValue(0);
    const spin = Animated.timing(spinAnim, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    spinAnimRef.current = spin;
    spin.start(({ finished }) => {
      if (finished && spinAnimRef.current === spin) {
        spinAnimRef.current = null;
      }
    });

    try {
      const [ov, userList, scanList] = await Promise.all([
        getAdminDatabaseOverview(),
        adminListUsers(),
        adminListAllScanSessions(100, scanFilterUserId),
      ]);
      setOverview(ov);
      setUsers(userList);
      if (reqId === scanRequestIdRef.current) {
        setScansState({
          rows: scanList,
        });
      }
      await loadTableData(activeTable, ov.prefs);
    } catch (err: any) {
      Alert.alert('Veri Yükleme Hatası', err?.message || 'Admin verileri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [activeTable, loadTableData, scanFilterUserId, spinAnim]);

  useEffect(() => {
    if (!isAdminUser(currentUser)) {
      onBack();
      return;
    }
    loadAllAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  // Reload scans whenever user filter changes (skip initial mount, fetched by loadAllAdminData)
  useEffect(() => {
    if (!scansFilterMountedRef.current) {
      scansFilterMountedRef.current = true;
      return;
    }
    if (!isAdminUser(currentUser)) return;
    const reqId = ++scanRequestIdRef.current;
    adminListAllScanSessions(100, scanFilterUserId)
      .then((rows) => {
        if (reqId !== scanRequestIdRef.current) return;
        setScansState({
          rows,
        });
      })
      .catch(() => {});
  }, [currentUser, scanFilterUserId]);

  const handleSelectTable = async (table: BrowserTable) => {
    if (table === activeTable) return;
    Haptics.selectionAsync().catch(() => {});
    setActiveTable(table);
    setTableSearch('');
    await loadTableData(table, overview?.prefs);
  };

  const handleCreateUser = async () => {
    if (creatingUser) return;
    if (!newUsername.trim() || !newPassword) {
      Alert.alert('Eksik Bilgi', 'Kullanıcı adı ve şifre zorunludur.');
      return;
    }
    setCreatingUser(true);
    try {
      await adminCreateUser(newDisplayName, newUsername, newPassword);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNewDisplayName('');
      setNewUsername('');
      setNewPassword('');
      setCreateFormOpen(false);
      await loadAllAdminData();
      onDatabaseMutated();
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert('Hesap Oluşturulamadı', err?.message || 'Bir hata oluştu.');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleConfirmResetPassword = async () => {
    if (!passwordModalUser || savingPassword) return;
    setSavingPassword(true);
    try {
      await adminResetUserPassword(passwordModalUser.id, resetPasswordVal);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPasswordModalUser(null);
      setResetPasswordVal('');
      Alert.alert('Başarılı', `@${passwordModalUser.username} şifresi güncellendi.`);
    } catch (err: any) {
      Alert.alert('Hata', err?.message || 'Şifre güncellenemedi.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteUser = (u: AdminUserSummary) => {
    Alert.alert(
      'Hesabı Sil',
      `@${u.username} hesabı, bu hesaba ait ${u.scanCount} tarama ve tüm fotoğrafları kalıcı olarak silinecek. Emin misin?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            try {
              await adminDeleteUser(u.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              if (scanFilterUserId === u.id) {
                setScanFilterUserId(null);
              }
              await loadAllAdminData();
              onDatabaseMutated();
            } catch (err: any) {
              Alert.alert('Silinemedi', err?.message || 'Kullanıcı silinemedi.');
            }
          },
        },
      ]
    );
  };

  const handleOpenScanDetail = async (sessionId: number) => {
    setDetailLoading(true);
    try {
      const full = await adminGetScanSessionWithTracks(sessionId);
      if (full) {
        setDetailScan(full);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteScan = (sessionId: number, ownerUsername: string) => {
    Alert.alert(
      'Taramayı Sil',
      `#${sessionId} numaralı tarama (@${ownerUsername}) ve fotoğrafı kalıcı olarak silinsin mi?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await adminDeleteScanSession(sessionId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            if (detailScan?.id === sessionId) {
              setDetailScan(null);
            }
            await loadAllAdminData();
            onDatabaseMutated();
          },
        },
      ]
    );
  };

  const handleDeleteTrack = (trackId: number, title: string) => {
    Alert.alert(
      'Şarkıyı Sil',
      `"${title}" Azure bulut şarkı kataloğundan silinsin mi?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await adminDeleteTrack(trackId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            await loadAllAdminData();
            onDatabaseMutated();
          },
        },
      ]
    );
  };

  const handleCleanOrphans = async () => {
    const removed = await adminCleanOrphanSnapshots();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert(
      'Temizlik Tamamlandı',
      removed > 0
        ? `${removed} adet sahipsiz fotoğraf Azure Blob Storage'dan temizlendi.`
        : 'Sahipsiz Blob fotoğraf dosyası bulunamadı.'
    );
    await loadAllAdminData();
    onDatabaseMutated();
  };

  const [seedingCloud, setSeedingCloud] = useState(false);

  const handleSeedCloudCatalog = async () => {
    if (seedingCloud) return;
    setSeedingCloud(true);
    try {
      const res = await adminSeedCloudCatalog(12);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        'Bulut Kataloğu Güncellendi',
        `${res.totalFetched} şarkı işlendi. Azure PostgreSQL kataloğunda toplam ${res.totalCatalog} şarkı bulunuyor.`
      );
      await loadAllAdminData();
      onDatabaseMutated();
    } catch (err: any) {
      Alert.alert('Hata', err?.message || 'Bulut şarkı kataloğu genişletilemedi.');
    } finally {
      setSeedingCloud(false);
    }
  };

  const handleRunSql = async () => {
    if (sqlRunning) return;
    Haptics.selectionAsync().catch(() => {});
    setSqlRunning(true);
    setSqlError(null);
    try {
      const res = await adminRunReadOnlyQuery(sqlText);
      setSqlResult(res);
    } catch (err: any) {
      setSqlError(err?.message || 'SQL sorgusu çalıştırılamadı.');
      setSqlResult(null);
    } finally {
      setSqlRunning(false);
    }
  };

  const filteredTableRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return tableState.rows;
    return tableState.rows.filter((row) =>
      Object.values(row).some((val) => String(val ?? '').toLowerCase().includes(q))
    );
  }, [tableState.rows, tableSearch]);

  const spinRotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!isAdminUser(currentUser)) {
    return null;
  }

  return (
    <StaggeredEntry
      index={0}
      active={isActiveTab}
      enabled={!skipInitialEntrance}
      distance={14}
      style={styles.root}
    >
      {/* Sticky Admin Header */}
      <View style={styles.stickyHeader}>
        <View style={styles.headerTopRow}>
          <SpringPressable haptic onPress={onBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.inkPrimary} />
            <Text style={styles.backBtnText}>Ayarlar</Text>
          </SpringPressable>

          <View style={styles.headerTitleCenter}>
            <View style={styles.titleBadgeRow}>
              <PulseDot color={colors.brand} size={7} />
              <Text style={styles.headerTitle}>Admin Paneli</Text>
            </View>
            <Text style={styles.headerSub}>@{currentUser.username} · Tam Yetki</Text>
          </View>

          <SpringPressable haptic onPress={loadAllAdminData} style={styles.refreshIconBtn}>
            <Animated.View style={{ transform: [{ rotate: spinRotate }] }}>
              <Ionicons name="refresh" size={18} color={colors.inkPrimary} />
            </Animated.View>
          </SpringPressable>
        </View>

        <AnimatedSegmentedControl<AdminSubTab>
          compact
          value={subTab}
          onChange={switchSubTab}
          options={[
            { key: 'overview', label: 'Genel' },
            { key: 'users', label: 'Hesaplar' },
            { key: 'scans', label: 'Taramalar' },
            { key: 'database', label: 'Veritabanı' },
          ]}
        />
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={{
            opacity: contentOpacity,
            transform: [{ translateX: contentTranslateX }],
          }}
        >
          {loading && !overview ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={colors.brand} />
              <Text style={styles.loadingText}>Veritabanı yükleniyor…</Text>
            </View>
          ) : null}

          {/* ────────── SUB-TAB 1: GENEL ────────── */}
          {subTab === 'overview' && overview && (
            <View>
              <View style={styles.kpiGrid}>
                {[
                  {
                    label: 'Toplam Hesap',
                    value: String(overview.userCount),
                    sub: `${overview.adminCount} Admin · ${Math.max(0, overview.userCount - overview.adminCount)} Normal`,
                    icon: 'people-outline' as const,
                    accent: colors.brand,
                  },
                  {
                    label: 'Tüm Taramalar',
                    value: String(overview.scanCount),
                    sub: `${overview.sessionTrackLinkCount} Şarkı Eşleşmesi`,
                    icon: 'scan-outline' as const,
                    accent: colors.moodPositive,
                  },
                  {
                    label: 'Şarkı Kataloğu',
                    value: String(overview.trackCount),
                    sub: `${overview.languageBreakdown.find((l) => l.language === 'tr')?.count || 0} Türkçe · ${overview.languageBreakdown.find((l) => l.language === 'global')?.count || 0} Yabancı`,
                    icon: 'musical-notes-outline' as const,
                    accent: colors.moodNeutral,
                  },
                  {
                    label: 'Favoriler',
                    value: String(overview.favoriteCount),
                    sub: 'Tüm Kullanıcılar',
                    icon: 'heart-outline' as const,
                    accent: colors.moodAngry,
                  },
                  {
                    label: 'Azure Blob Fotoğraflar',
                    value: String(overview.photoCount),
                    sub: formatBytes(overview.photoBytes),
                    icon: 'images-outline' as const,
                    accent: colors.moodNegative,
                  },
                  {
                    label: 'Azure PostgreSQL',
                    value: formatBytes(overview.dbBytes),
                    sub: `${overview.tables.length} Tablo · Bulut SSL`,
                    icon: 'server-outline' as const,
                    accent: colors.brand,
                  },
                ].map((kpi) => (
                  <View key={kpi.label} style={styles.kpiTile}>
                    <View style={styles.kpiTop}>
                      <Text style={styles.kpiLabel}>{kpi.label}</Text>
                      <Ionicons name={kpi.icon} size={16} color={kpi.accent} />
                    </View>
                    <Text style={styles.kpiVal}>{kpi.value}</Text>
                    <Text numberOfLines={1} style={styles.kpiSub}>
                      {kpi.sub}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Emotion Breakdown */}
              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Duygu Analizi Dağılımı</Text>
                <Text style={styles.cardSub}>
                  Tüm kullanıcıların kamera taramalarından elde edilen duygular
                </Text>

                {overview.emotionBreakdown.length === 0 ? (
                  <Text style={styles.emptyInline}>Henüz kayıtlı tarama bulunmuyor.</Text>
                ) : (
                  <View style={{ gap: 11, marginTop: 12 }}>
                    {overview.emotionBreakdown.map((item, idx) => {
                      const vis = resolveEmotionVisualSafe(item.emotion, colors);
                      const ratio =
                        overview.scanCount > 0 ? item.count / overview.scanCount : 0;
                      const pct = Math.round(ratio * 100);
                      return (
                        <View key={item.emotion} style={{ gap: 5 }}>
                          <View style={styles.barLabelRow}>
                            <View style={styles.barDotRow}>
                              <View style={[styles.smallDot, { backgroundColor: vis.color }]} />
                              <Text style={styles.barLabelText}>{vis.fullTr}</Text>
                            </View>
                            <Text style={styles.barValText}>
                              {item.count} ({pct}%)
                            </Text>
                          </View>
                          <AnimatedProgressBar
                            ratio={ratio}
                            color={vis.color}
                            trackColor={colors.subtle}
                            delay={idx * 70}
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* Catalog Breakdown */}
              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Katalog Kaynak &amp; Dil Dağılımı</Text>
                <View style={{ gap: 11, marginTop: 10 }}>
                  {overview.languageBreakdown.map((item, idx) => {
                    const ratio =
                      overview.trackCount > 0 ? item.count / overview.trackCount : 0;
                    const label = item.language === 'tr' ? 'Türkçe Şarkılar' : 'Yabancı (Global)';
                    return (
                      <View key={item.language} style={{ gap: 5 }}>
                        <View style={styles.barLabelRow}>
                          <Text style={styles.barLabelText}>{label}</Text>
                          <Text style={styles.barValText}>
                            {item.count} ({Math.round(ratio * 100)}%)
                          </Text>
                        </View>
                        <AnimatedProgressBar
                          ratio={ratio}
                          color={item.language === 'tr' ? colors.brand : colors.moodNeutral}
                          trackColor={colors.subtle}
                          delay={idx * 70}
                        />
                      </View>
                    );
                  })}

                  <View style={styles.sourcePillsRow}>
                    {overview.sourceBreakdown.map((s) => (
                      <View key={s.source} style={styles.sourcePill}>
                        <Ionicons name="cloud-done-outline" size={14} color={colors.brand} />
                        <Text style={styles.sourcePillText}>
                          {s.source.toUpperCase()}: {s.count} şarkı
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {/* System & Maintenance */}
              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Sistem &amp; Veritabanı Bakımı</Text>
                <Text style={styles.infoMiniLabel}>AKTİF AI MOTORU</Text>
                <Text style={styles.infoMiniVal}>{engineInfo.label}</Text>

                <View style={styles.maintBtnCol}>
                  <SpringPressable
                    haptic
                    disabled={seedingCloud}
                    onPress={handleSeedCloudCatalog}
                    style={[styles.maintSecondaryBtn, seedingCloud && { opacity: 0.65 }]}
                  >
                    {seedingCloud ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Ionicons name="cloud-download-outline" size={17} color={colors.brand} />
                    )}
                    <Text style={[styles.maintSecondaryText, { color: colors.brand }]}>
                      {seedingCloud ? 'Bulut Kataloğu Genişletiliyor…' : 'Bulut Şarkı Havuzunu Genişlet'}
                    </Text>
                  </SpringPressable>

                  <SpringPressable
                    haptic
                    onPress={handleCleanOrphans}
                    style={styles.maintSecondaryBtn}
                  >
                    <Ionicons name="sparkles-outline" size={17} color={colors.inkPrimary} />
                    <Text style={styles.maintSecondaryText}>Sahipsiz Blob Fotoğrafları Temizle</Text>
                  </SpringPressable>

                  <SpringPressable
                    haptic
                    onPress={() => {
                      Alert.alert(
                        'Bulut Kullanıcı Verilerini Sıfırla',
                        'Tüm kullanıcılar (admin haluk korunur), taramalar, Blob fotoğraflar ve playlistler silinecek. Paylaşılan şarkı kataloğu korunur. Emin misin?',
                        [
                          { text: 'Vazgeç', style: 'cancel' },
                          {
                            text: 'Sıfırla',
                            style: 'destructive',
                            onPress: onWipeAllData,
                          },
                        ]
                      );
                    }}
                    style={styles.maintDangerBtn}
                  >
                    <Ionicons name="trash-outline" size={17} color={colors.danger} />
                    <Text style={styles.maintDangerText}>Bulut Kullanıcı Verilerini Sıfırla</Text>
                  </SpringPressable>
                </View>
              </View>
            </View>
          )}

          {/* ────────── SUB-TAB 2: HESAPLAR ────────── */}
          {subTab === 'users' && (
            <View>
              <View style={styles.sectionActionBar}>
                <Text style={styles.sectionCountText}>
                  Kayıtlı {users.length} Hesap
                </Text>
                <SpringPressable
                  haptic
                  onPress={() => setCreateFormOpen((v) => !v)}
                  style={styles.addBtn}
                >
                  <Ionicons
                    name={createFormOpen ? 'close' : 'person-add-outline'}
                    size={15}
                    color="#FFFFFF"
                  />
                  <Text style={styles.addBtnText}>
                    {createFormOpen ? 'Kapat' : 'Yeni Hesap'}
                  </Text>
                </SpringPressable>
              </View>

              {createFormOpen && (
                <StaggeredEntry index={0} direction="down" style={styles.inlineFormCard}>
                  <Text style={styles.cardTitle}>Yeni Standart Hesap Oluştur</Text>
                  <Text style={styles.cardSub}>
                    Yeni oluşturulan tüm hesaplar normal kullanıcı yetkisiyle başlar.
                  </Text>
                  <TextInput
                    value={newDisplayName}
                    onChangeText={setNewDisplayName}
                    placeholder="Ad Soyad (Örn: Ayşe Yılmaz)"
                    placeholderTextColor={colors.inkMuted}
                    style={styles.input}
                  />
                  <TextInput
                    value={newUsername}
                    onChangeText={setNewUsername}
                    placeholder="Kullanıcı Adı (min 3 karakter)"
                    placeholderTextColor={colors.inkMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Şifre (min 4 karakter)"
                    placeholderTextColor={colors.inkMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    style={styles.input}
                  />
                  <SpringPressable
                    haptic
                    disabled={creatingUser}
                    onPress={handleCreateUser}
                    style={styles.submitFormBtn}
                  >
                    {creatingUser ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.submitFormText}>Normal Hesap Oluştur</Text>
                    )}
                  </SpringPressable>
                </StaggeredEntry>
              )}

              {users.map((u) => {
                const isAdm = u.role === 'admin' || u.username.toLowerCase() === 'haluk';
                return (
                  <View
                    key={u.id}
                    style={[styles.userCard, isAdm && styles.userCardAdmin]}
                  >
                    <View style={styles.userCardTop}>
                      <View style={[styles.avatar, isAdm && styles.avatarAdmin]}>
                        <Text style={[styles.avatarLetter, isAdm && { color: '#FFFFFF' }]}>
                          {u.displayName.slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.userNameRow}>
                          <Text style={styles.userDisplayName}>{u.displayName}</Text>
                          <View style={[styles.rolePill, isAdm ? styles.rolePillAdmin : styles.rolePillUser]}>
                            <Ionicons
                              name={isAdm ? 'shield-checkmark' : 'person-outline'}
                              size={11}
                              color={isAdm ? colors.brand : colors.inkSecondary}
                            />
                            <Text
                              style={[
                                styles.rolePillText,
                                isAdm ? { color: colors.brand } : { color: colors.inkSecondary },
                              ]}
                            >
                              {isAdm ? 'ADMIN' : 'NORMAL'}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.userHandle}>
                          @{u.username} · ID #{u.id}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.userMetaLine}>
                      {u.scanCount} tarama · {u.favoriteCount} favori · Katılım: {formatDateTR(u.createdAt)}
                    </Text>
                    {u.lastScanAt && (
                      <Text style={styles.userLastScan}>
                        Son tarama: {formatDateTR(u.lastScanAt)}
                      </Text>
                    )}

                    <View style={styles.userActionsRow}>
                      <SpringPressable
                        haptic
                        onPress={() => {
                          setScanFilterUserId(u.id);
                          switchSubTab('scans');
                        }}
                        style={styles.userActionPill}
                      >
                        <Ionicons name="scan-outline" size={14} color={colors.inkPrimary} />
                        <Text style={styles.userActionText}>Taramaları</Text>
                      </SpringPressable>

                      <SpringPressable
                        haptic
                        onPress={() => {
                          setPasswordModalUser(u);
                          setResetPasswordVal('');
                        }}
                        style={styles.userActionPill}
                      >
                        <Ionicons name="key-outline" size={14} color={colors.inkPrimary} />
                        <Text style={styles.userActionText}>Şifre</Text>
                      </SpringPressable>

                      {!isAdm && (
                        <SpringPressable
                          haptic
                          onPress={() => handleDeleteUser(u)}
                          style={styles.userDeletePill}
                        >
                          <Ionicons name="trash-outline" size={14} color={colors.danger} />
                          <Text style={[styles.userActionText, { color: colors.danger }]}>Sil</Text>
                        </SpringPressable>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ────────── SUB-TAB 3: TARAMALAR ────────── */}
          {subTab === 'scans' && (
            <View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                <SpringPressable
                  haptic
                  onPress={() => setScanFilterUserId(null)}
                  style={[styles.filterChip, scanFilterUserId === null && styles.filterChipActive]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      scanFilterUserId === null && styles.filterChipTextActive,
                    ]}
                  >
                    Tümü ({overview?.scanCount || scansState.rows.length})
                  </Text>
                </SpringPressable>

                {users.map((u) => {
                  const selected = scanFilterUserId === u.id;
                  return (
                    <SpringPressable
                      key={u.id}
                      haptic
                      onPress={() => setScanFilterUserId(u.id)}
                      style={[styles.filterChip, selected && styles.filterChipActive]}
                    >
                      <Text
                        style={[styles.filterChipText, selected && styles.filterChipTextActive]}
                      >
                        @{u.username} ({u.scanCount})
                      </Text>
                    </SpringPressable>
                  );
                })}
              </ScrollView>

              {scansState.rows.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="scan-outline" size={34} color={colors.inkMuted} />
                  <Text style={styles.emptyTitle}>Kayıtlı tarama bulunamadı</Text>
                  <Text style={styles.emptySub}>
                    Seçili filtreye uygun kamera taraması bulunmuyor.
                  </Text>
                </View>
              ) : (
                scansState.rows.map((scan) => {
                  const vis = resolveMoodVisual(scan.mood, scan.emotion, colors);
                  const mirrored = scan.deviceLabel.toLowerCase().includes('ön kamera');
                  return (
                    <View key={scan.id}>
                      <SpringPressable
                        haptic
                        scaleTo={0.98}
                        onPress={() => handleOpenScanDetail(scan.id)}
                        style={styles.scanCard}
                      >
                        {scan.snapshotUri ? (
                          <Image
                            source={{ uri: scan.snapshotUri }}
                            style={[styles.scanThumb, mirrored && styles.mirroredImage]}
                          />
                        ) : (
                          <View style={[styles.scanThumb, styles.scanThumbFallback]}>
                            <Ionicons name="sparkles" size={20} color={vis.color} />
                          </View>
                        )}

                        <View style={{ flex: 1 }}>
                          <View style={styles.scanTopBadges}>
                            <View style={styles.ownerBadge}>
                              <Text style={styles.ownerBadgeText}>@{scan.username}</Text>
                            </View>
                            <View style={[styles.moodPill, { backgroundColor: vis.softColor }]}>
                              <Text style={[styles.moodPillText, { color: vis.color }]}>
                                {vis.shortTr} · %{Math.round(scan.confidence * 100)}
                              </Text>
                            </View>
                          </View>
                          <Text numberOfLines={1} style={styles.scanDevice}>
                            #{scan.id} · {scan.deviceLabel}
                          </Text>
                          <Text style={styles.scanMeta}>
                            {formatDateTR(scan.createdAt)} · {scan.trackCount} şarkı
                          </Text>
                        </View>

                        <SpringPressable
                          haptic
                          onPress={() => handleDeleteScan(scan.id, scan.username)}
                          hitSlop={8}
                          style={styles.scanDeleteBtn}
                        >
                          <Ionicons name="trash-outline" size={17} color={colors.inkMuted} />
                        </SpringPressable>
                      </SpringPressable>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* ────────── SUB-TAB 4: VERİTABANI ────────── */}
          {subTab === 'database' && (
            <View>
              <Text style={styles.sectionMiniHeader}>TABLO GEZGİNİ</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {(overview?.tables || []).map((t) => {
                  const selected = activeTable === t.name;
                  return (
                    <SpringPressable
                      key={t.name}
                      haptic
                      onPress={() => handleSelectTable(t.name)}
                      style={[styles.filterChip, selected && styles.filterChipActive]}
                    >
                      <Text
                        style={[styles.filterChipText, selected && styles.filterChipTextActive]}
                      >
                        {t.name} ({t.rowCount})
                      </Text>
                    </SpringPressable>
                  );
                })}
                <SpringPressable
                  haptic
                  onPress={() => handleSelectTable('prefs')}
                  style={[styles.filterChip, activeTable === 'prefs' && styles.filterChipActive]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      activeTable === 'prefs' && styles.filterChipTextActive,
                    ]}
                  >
                    prefs ({Object.keys(overview?.prefs || {}).length})
                  </Text>
                </SpringPressable>
              </ScrollView>

              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={colors.inkMuted} />
                <TextInput
                  value={tableSearch}
                  onChangeText={setTableSearch}
                  placeholder={`${activeTable} içinde ara…`}
                  placeholderTextColor={colors.inkMuted}
                  style={styles.searchInput}
                />
                {tableSearch.length > 0 && (
                  <Pressable onPress={() => setTableSearch('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={17} color={colors.inkMuted} />
                  </Pressable>
                )}
              </View>

              <View style={styles.tableStatusRow}>
                <Text style={styles.tableStatusText}>
                  {tableState.table} · Toplam {tableState.totalCount} kayıt (Gösterilen: {filteredTableRows.length})
                </Text>
                {tableLoading && <ActivityIndicator size="small" color={colors.brand} />}
              </View>

              {tableState.table === 'favorites' && favoriteLinks.length > 0 && (
                <View style={styles.sectionCard}>
                  <Text style={styles.cardTitle}>Okunabilir Favori Eşleşmeleri</Text>
                  <View style={{ gap: 7, marginTop: 8 }}>
                    {favoriteLinks.slice(0, 12).map((fav) => (
                      <View key={`${fav.userId}-${fav.trackId}`} style={styles.favJoinRow}>
                        <Text style={styles.favJoinUser}>@{fav.username}</Text>
                        <Text numberOfLines={1} style={styles.favJoinTrack}>
                          {fav.title} — {fav.artist}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {filteredTableRows.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>Bu tabloda kayıt yok</Text>
                </View>
              ) : (
                filteredTableRows.map((row, idx) => {
                  const rowIdLabel =
                    row.id !== undefined
                      ? `#${row.id}`
                      : row.key !== undefined
                        ? String(row.key)
                        : `Satır ${idx + 1}`;
                  return (
                    <View
                      key={`${tableState.table}-${idx}`}
                      style={styles.dbRowCard}
                    >
                      <View style={styles.dbRowHeader}>
                        <Text style={styles.dbRowTitle}>{rowIdLabel}</Text>
                        {tableState.table === 'tracks' && row.id !== undefined && (
                          <SpringPressable
                            haptic
                            onPress={() =>
                              handleDeleteTrack(Number(row.id), String(row.title || 'Şarkı'))
                            }
                            hitSlop={8}
                          >
                            <Ionicons name="trash-outline" size={16} color={colors.danger} />
                          </SpringPressable>
                        )}
                        {tableState.table === 'scan_sessions' && row.id !== undefined && (
                          <SpringPressable
                            haptic
                            onPress={() =>
                              handleDeleteScan(Number(row.id), `user#${row.user_id ?? '?'}`)
                            }
                            hitSlop={8}
                          >
                            <Ionicons name="trash-outline" size={16} color={colors.danger} />
                          </SpringPressable>
                        )}
                      </View>
                      {Object.entries(row).map(([col, val]) => (
                        <View key={col} style={styles.dbFieldRow}>
                          <Text style={styles.dbFieldKey}>{col}</Text>
                          <Text selectable style={styles.dbFieldVal}>
                            {val === null || val === undefined ? 'NULL' : String(val)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })
              )}

              {/* SQL Console */}
              <View style={[styles.sectionCard, { marginTop: 14 }]}>
                <Text style={styles.cardTitle}>SQL Sorgu Konsolu (Salt-Okunur)</Text>
                <Text style={styles.cardSub}>
                  SELECT, WITH veya EXPLAIN sorguları ile Azure PostgreSQL veritabanını doğrudan sorgula.
                </Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[styles.chipRow, { marginTop: 10 }]}
                >
                  {SQL_PRESETS.map((preset) => (
                    <SpringPressable
                      key={preset.label}
                      haptic
                      onPress={() => setSqlText(preset.sql)}
                      style={styles.presetChip}
                    >
                      <Text style={styles.presetChipText}>{preset.label}</Text>
                    </SpringPressable>
                  ))}
                </ScrollView>

                <TextInput
                  value={sqlText}
                  onChangeText={setSqlText}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="SELECT * FROM users;"
                  placeholderTextColor={colors.inkMuted}
                  style={styles.sqlInput}
                />

                <SpringPressable
                  haptic
                  disabled={sqlRunning}
                  onPress={handleRunSql}
                  style={styles.runSqlBtn}
                >
                  {sqlRunning ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <Ionicons name="play" size={15} color="#FFFFFF" />
                      <Text style={styles.runSqlText}>Sorguyu Çalıştır</Text>
                    </>
                  )}
                </SpringPressable>

                {sqlError && (
                  <View style={styles.sqlErrorBox}>
                    <Ionicons name="alert-circle" size={16} color={colors.danger} />
                    <Text style={styles.sqlErrorText}>{sqlError}</Text>
                  </View>
                )}

                {sqlResult && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.sqlMetaText}>
                      {sqlResult.totalRows} satır döndü ({sqlResult.elapsedMs} ms)
                      {sqlResult.totalRows > 100 ? ' · İlk 100 gösteriliyor' : ''}
                    </Text>
                    {sqlResult.rows.map((r, rIdx) => (
                      <View key={rIdx} style={styles.sqlResultCard}>
                        {Object.entries(r).map(([k, v]) => (
                          <View key={k} style={styles.dbFieldRow}>
                            <Text style={styles.dbFieldKey}>{k}</Text>
                            <Text selectable style={styles.dbFieldVal}>
                              {v === null || v === undefined ? 'NULL' : String(v)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* Password Reset Modal */}
      <Modal visible={Boolean(passwordModalUser)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Şifre Güncelle</Text>
            <Text style={styles.modalSub}>
              @{passwordModalUser?.username} hesabı için yeni şifre belirle (en az 4 karakter).
            </Text>
            <TextInput
              value={resetPasswordVal}
              onChangeText={setResetPasswordVal}
              placeholder="Yeni şifre"
              placeholderTextColor={colors.inkMuted}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
            />
            <View style={styles.modalBtnRow}>
              <SpringPressable
                onPress={() => setPasswordModalUser(null)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelText}>Vazgeç</Text>
              </SpringPressable>
              <SpringPressable
                haptic
                disabled={savingPassword}
                onPress={handleConfirmResetPassword}
                style={styles.modalSaveBtn}
              >
                {savingPassword ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Kaydet</Text>
                )}
              </SpringPressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Scan Detail Modal */}
      <Modal visible={Boolean(detailScan) || detailLoading} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '86%' }]}>
            {detailLoading && !detailScan ? (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.brand} />
              </View>
            ) : detailScan ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.detailHeaderRow}>
                  <Text style={styles.modalTitle}>Tarama #{detailScan.id}</Text>
                  <SpringPressable onPress={() => setDetailScan(null)} hitSlop={8}>
                    <Ionicons name="close" size={22} color={colors.inkSecondary} />
                  </SpringPressable>
                </View>

                {detailScan.snapshotUri && (
                  <Image
                    source={{ uri: detailScan.snapshotUri }}
                    style={[
                      styles.detailPhoto,
                      detailScan.deviceLabel.toLowerCase().includes('ön kamera') &&
                        styles.mirroredImage,
                    ]}
                  />
                )}

                <View style={styles.detailMetaBox}>
                  <Text style={styles.detailMetaLine}>
                    Kullanıcı: @{detailScan.username} ({detailScan.displayName})
                  </Text>
                  <Text style={styles.detailMetaLine}>
                    Duygu / Mod: {resolveMoodVisual(detailScan.mood, detailScan.emotion, colors).fullTr} (%
                    {Math.round(detailScan.confidence * 100)})
                  </Text>
                  <Text style={styles.detailMetaLine}>Cihaz: {detailScan.deviceLabel}</Text>
                  <Text style={styles.detailMetaLine}>Tarih: {formatDateTR(detailScan.createdAt)}</Text>
                  <Text numberOfLines={1} style={styles.detailMetaFile}>
                    Dosya: {detailScan.snapshotUri ? detailScan.snapshotUri.split('/').pop() : 'Yok'}
                  </Text>
                </View>

                <Text style={[styles.sectionMiniHeader, { marginTop: 12 }]}>
                  ÖNERİLEN ŞARKILAR ({detailScan.tracks?.length || 0})
                </Text>
                {(detailScan.tracks || []).map((tr, idx) => (
                  <SpringPressable
                    key={tr.id}
                    haptic
                    onPress={() => onPlayTrack(detailScan.tracks || [], idx)}
                    style={styles.detailTrackRow}
                  >
                    <Ionicons name="play-circle" size={22} color={colors.brand} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.detailTrackTitle}>
                        {tr.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.detailTrackArtist}>
                        {tr.artist} · {tr.language.toUpperCase()}
                      </Text>
                    </View>
                  </SpringPressable>
                ))}

                <View style={[styles.modalBtnRow, { marginTop: 14 }]}>
                  <SpringPressable
                    haptic
                    onPress={() => handleDeleteScan(detailScan.id, detailScan.username)}
                    style={styles.maintDangerBtn}
                  >
                    <Text style={styles.maintDangerText}>Taramayı Sil</Text>
                  </SpringPressable>
                  <SpringPressable onPress={() => setDetailScan(null)} style={styles.modalSaveBtn}>
                    <Text style={styles.modalSaveText}>Kapat</Text>
                  </SpringPressable>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </StaggeredEntry>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    stickyHeader: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
      backgroundColor: colors.canvas,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
      gap: 10,
    },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    backBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    headerTitleCenter: {
      alignItems: 'center',
    },
    titleBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    headerTitle: {
      fontSize: 16.5,
      fontWeight: '800',
      color: colors.inkPrimary,
      letterSpacing: -0.3,
    },
    headerSub: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.brand,
    },
    refreshIconBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 155,
    },
    loadingBox: {
      paddingVertical: 48,
      alignItems: 'center',
      gap: 10,
    },
    loadingText: {
      fontSize: 13.5,
      color: colors.inkSecondary,
      fontWeight: '600',
    },
    kpiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 12,
    },
    kpiTile: {
      width: '48%',
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 13,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    kpiTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    kpiLabel: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkMuted,
    },
    kpiVal: {
      marginTop: 5,
      fontSize: 21,
      fontWeight: '800',
      color: colors.inkPrimary,
      letterSpacing: -0.4,
    },
    kpiSub: {
      marginTop: 2,
      fontSize: 11,
      color: colors.inkSecondary,
      fontWeight: '600',
    },
    sectionCard: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 15,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 12,
    },
    cardTitle: {
      fontSize: 15.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    cardSub: {
      marginTop: 3,
      fontSize: 12,
      color: colors.inkSecondary,
      lineHeight: 17,
    },
    emptyInline: {
      marginTop: 10,
      fontSize: 12.5,
      color: colors.inkMuted,
    },
    barLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    barDotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    smallDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    barLabelText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    barValText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    sourcePillsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 4,
    },
    sourcePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.elevated,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    sourcePillText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    infoMiniLabel: {
      marginTop: 10,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.6,
      color: colors.inkMuted,
    },
    infoMiniVal: {
      marginTop: 2,
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    maintBtnCol: {
      marginTop: 14,
      gap: 9,
    },
    maintSecondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: colors.subtle,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    maintSecondaryText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    maintDangerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: colors.dangerSoft,
    },
    maintDangerText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.danger,
    },
    sectionActionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    sectionCountText: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brand,
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: 11,
    },
    addBtnText: {
      color: '#FFFFFF',
      fontSize: 12.5,
      fontWeight: '700',
    },
    inlineFormCard: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 15,
      borderWidth: 1,
      borderColor: colors.brand,
      marginBottom: 12,
      gap: 9,
    },
    input: {
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      backgroundColor: colors.elevated,
      paddingHorizontal: 13,
      fontSize: 14,
      color: colors.inkPrimary,
    },
    submitFormBtn: {
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    submitFormText: {
      color: '#FFFFFF',
      fontSize: 13.5,
      fontWeight: '700',
    },
    userCard: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 10,
    },
    userCardAdmin: {
      borderColor: colors.brand,
      backgroundColor: colors.elevated,
    },
    userCardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: colors.subtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarAdmin: {
      backgroundColor: colors.brand,
    },
    avatarLetter: {
      fontSize: 17,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    userNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      flexWrap: 'wrap',
    },
    userDisplayName: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    rolePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 2.5,
      borderRadius: 999,
    },
    rolePillAdmin: {
      backgroundColor: colors.brandSoft,
    },
    rolePillUser: {
      backgroundColor: colors.subtle,
    },
    rolePillText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    userHandle: {
      fontSize: 12,
      color: colors.inkSecondary,
      marginTop: 1,
    },
    userMetaLine: {
      marginTop: 10,
      fontSize: 12,
      color: colors.inkSecondary,
      fontWeight: '600',
    },
    userLastScan: {
      marginTop: 2,
      fontSize: 11.5,
      color: colors.inkMuted,
    },
    userActionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 11,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    userActionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.subtle,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 9,
    },
    userDeletePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 9,
    },
    userActionText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    chipRow: {
      flexDirection: 'row',
      gap: 7,
      paddingBottom: 10,
    },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    filterChipActive: {
      backgroundColor: colors.brandSoft,
      borderColor: colors.brand,
    },
    filterChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    filterChipTextActive: {
      color: colors.brand,
      fontWeight: '800',
    },
    scanCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 11,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 9,
    },
    scanThumb: {
      width: 56,
      height: 56,
      borderRadius: 12,
      backgroundColor: colors.subtle,
    },
    scanThumbFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    mirroredImage: {
      transform: [{ scaleX: -1 }],
    },
    scanTopBadges: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
      marginBottom: 3,
    },
    ownerBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: colors.subtle,
    },
    ownerBadgeText: {
      fontSize: 10.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    moodPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
    },
    moodPillText: {
      fontSize: 10.5,
      fontWeight: '800',
    },
    scanDevice: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    scanMeta: {
      fontSize: 11.5,
      color: colors.inkMuted,
      marginTop: 2,
    },
    scanDeleteBtn: {
      width: 34,
      height: 34,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 28,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    emptyTitle: {
      marginTop: 8,
      fontSize: 15,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    emptySub: {
      marginTop: 4,
      fontSize: 12.5,
      color: colors.inkSecondary,
      textAlign: 'center',
    },
    sectionMiniHeader: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.7,
      color: colors.inkMuted,
      marginBottom: 8,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      paddingHorizontal: 12,
      height: 42,
      marginBottom: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 13.5,
      color: colors.inkPrimary,
    },
    tableStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 9,
    },
    tableStatusText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkMuted,
    },
    favJoinRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    favJoinUser: {
      fontSize: 11.5,
      fontWeight: '800',
      color: colors.brand,
    },
    favJoinTrack: {
      flex: 1,
      fontSize: 12,
      color: colors.inkPrimary,
    },
    dbRowCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 8,
      gap: 4,
    },
    dbRowHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 5,
      marginBottom: 3,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    dbRowTitle: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.brand,
      fontFamily: 'Courier',
    },
    dbFieldRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    dbFieldKey: {
      width: 110,
      fontSize: 11,
      fontWeight: '700',
      color: colors.inkMuted,
      fontFamily: 'Courier',
    },
    dbFieldVal: {
      flex: 1,
      fontSize: 11.5,
      color: colors.inkPrimary,
      fontFamily: 'Courier',
    },
    presetChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    presetChipText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    sqlInput: {
      minHeight: 82,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      backgroundColor: colors.elevated,
      padding: 11,
      fontSize: 12,
      color: colors.inkPrimary,
      fontFamily: 'Courier',
      textAlignVertical: 'top',
      marginBottom: 10,
    },
    runSqlBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 42,
      borderRadius: 11,
      backgroundColor: colors.brand,
    },
    runSqlText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    sqlErrorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginTop: 10,
      padding: 10,
      borderRadius: 10,
      backgroundColor: colors.dangerSoft,
    },
    sqlErrorText: {
      flex: 1,
      fontSize: 12,
      fontWeight: '600',
      color: colors.danger,
    },
    sqlMetaText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkSecondary,
      marginBottom: 8,
    },
    sqlResultCard: {
      backgroundColor: colors.elevated,
      borderRadius: 12,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 7,
      gap: 3,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.74)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 18,
    },
    modalCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    modalTitle: {
      fontSize: 17.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    modalSub: {
      marginTop: 4,
      marginBottom: 12,
      fontSize: 12.5,
      color: colors.inkSecondary,
      lineHeight: 18,
    },
    modalBtnRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 14,
    },
    modalCancelBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.subtle,
    },
    modalCancelText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    modalSaveBtn: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.brand,
    },
    modalSaveText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    detailHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    detailPhoto: {
      width: '100%',
      aspectRatio: 3 / 4,
      borderRadius: 16,
      backgroundColor: colors.subtle,
      marginBottom: 12,
    },
    detailMetaBox: {
      backgroundColor: colors.elevated,
      borderRadius: 14,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.hairline,
      gap: 4,
    },
    detailMetaLine: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.inkPrimary,
    },
    detailMetaFile: {
      fontSize: 11,
      color: colors.inkMuted,
      fontFamily: 'Courier',
      marginTop: 2,
    },
    detailTrackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 6,
    },
    detailTrackTitle: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    detailTrackArtist: {
      fontSize: 11.5,
      color: colors.inkSecondary,
    },
  });
