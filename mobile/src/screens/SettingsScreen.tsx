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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BiometricCapabilities,
  getBiometricCapabilities,
} from '../../modules/moodsync-vision';
import {
  BiometricBindingInfo,
  DashboardStats,
  disableBiometricBinding,
  enableBiometricBindingForUser,
  getBiometricBinding,
  isAdminUser,
  listDislikedTracks,
  TrackRecord,
  undislikeTrack,
  UserRecord,
} from '../database/iosDatabase';
import { getAiEngineSummary } from '../services/moodAiService';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import {
  PulseDot,
  SpringPressable,
  StaggeredEntry,
} from '../components/MotionPrimitives';
import { AdminPanelScreen } from './AdminPanelScreen';

interface Props {
  user: UserRecord;
  stats: DashboardStats;
  storageInfo: { photoCount: number; trackCount: number; scanCount: number };
  adminMode: boolean;
  isActiveTab: boolean;
  onSetAdminMode: (open: boolean) => void;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onDatabaseMutated: () => void;
  onBiometricSettingsChanged?: () => void;
  onClearOwnHistory: () => Promise<void>;
  onWipeAllData: () => Promise<void>;
  onLogout: () => void;
}

export const SettingsScreen: React.FC<Props> = React.memo(({
  user,
  stats,
  storageInfo,
  adminMode,
  isActiveTab,
  onSetAdminMode,
  onPlayTrack,
  onDatabaseMutated,
  onBiometricSettingsChanged,
  onClearOwnHistory,
  onWipeAllData,
  onLogout,
}) => {
  const { colors, themeId, themes, setThemeId } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isAdmin = isAdminUser(user);
  const showAdmin = isAdmin && adminMode;
  const engineInfo = getAiEngineSummary();

  const [bioCaps, setBioCaps] = useState<BiometricCapabilities>(() => getBiometricCapabilities());
  const [bioBinding, setBioBinding] = useState<BiometricBindingInfo | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const [dislikedTracks, setDislikedTracks] = useState<TrackRecord[]>([]);
  const [dislikedModalOpen, setDislikedModalOpen] = useState(false);

  const loadSecurityAndDisliked = useCallback(async () => {
    setBioCaps(getBiometricCapabilities());
    const [binding, disliked] = await Promise.all([
      getBiometricBinding(),
      listDislikedTracks(user.id),
    ]);
    setBioBinding(binding);
    setDislikedTracks(disliked);
  }, [user.id]);

  useEffect(() => {
    if (isActiveTab) {
      loadSecurityAndDisliked().catch(() => {});
    }
  }, [isActiveTab, loadSecurityAndDisliked]);

  const handleLinkBiometric = async () => {
    if (bioBusy) return;
    setBioBusy(true);
    try {
      const res = await enableBiometricBindingForUser(user, {
        appLockEnabled: false,
        adminLockEnabled: false,
      });
      if (res.ok && res.binding) {
        setBioBinding(res.binding);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onBiometricSettingsChanged?.();
      } else if (!res.cancelled && res.error) {
        Alert.alert('Face ID Eşleştirilemedi', res.error);
      }
    } finally {
      setBioBusy(false);
    }
  };

  const handleUnlinkBiometric = () => {
    Alert.alert(
      `${bioCaps.label} Eşleştirmesini Kaldır`,
      `@${bioBinding?.username || user.username} hesabı için hızlı ${bioCaps.label} girişi kapatılacak. Devam edilsin mi?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: async () => {
            await disableBiometricBinding();
            setBioBinding(null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            onBiometricSettingsChanged?.();
          },
        },
      ]
    );
  };

  const handleRestoreDisliked = async (trackId: number) => {
    await undislikeTrack(user.id, trackId);
    setDislikedTracks((prev) => prev.filter((t) => t.id !== trackId));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onDatabaseMutated();
  };

  const slideX = useRef(new Animated.Value(0)).current;
  const viewOpacity = useRef(new Animated.Value(1)).current;
  const prevShowAdmin = useRef(showAdmin);
  const prevActiveTabRef = useRef(isActiveTab);
  const adminAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const returningFromAdmin =
    prevShowAdmin.current && !showAdmin && prevActiveTabRef.current && isActiveTab;
  const enteringAdminFromTab =
    !prevShowAdmin.current && showAdmin && prevActiveTabRef.current && isActiveTab;

  useLayoutEffect(() => {
    const wasActiveTab = prevActiveTabRef.current;
    prevActiveTabRef.current = isActiveTab;

    if (prevShowAdmin.current === showAdmin) return;
    const enteringAdmin = showAdmin;
    prevShowAdmin.current = showAdmin;

    adminAnimRef.current?.stop();

    if (!wasActiveTab || !isActiveTab) {
      slideX.setValue(0);
      viewOpacity.setValue(1);
      adminAnimRef.current = null;
      return;
    }

    slideX.setValue(enteringAdmin ? 28 : -28);
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
    adminAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && adminAnimRef.current === anim) {
        adminAnimRef.current = null;
      }
    });
  }, [isActiveTab, showAdmin, slideX, viewOpacity]);

  useEffect(() => {
    return () => {
      adminAnimRef.current?.stop();
    };
  }, []);

  if (showAdmin) {
    return (
      <Animated.View
        style={{
          flex: 1,
          opacity: viewOpacity,
          transform: [{ translateX: slideX }],
        }}
      >
        <AdminPanelScreen
          currentUser={user}
          isActiveTab={isActiveTab}
          skipInitialEntrance={enteringAdminFromTab}
          onBack={() => onSetAdminMode(false)}
          onPlayTrack={onPlayTrack}
          onDatabaseMutated={onDatabaseMutated}
          onWipeAllData={onWipeAllData}
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
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <StaggeredEntry
          index={0}
          active={isActiveTab}
          enabled={!returningFromAdmin}
          style={styles.headerBlock}
        >
          <Text style={styles.pageTitle}>Ayarlar</Text>
          <Text style={styles.pageSub}>
            Profilin, tema tercihin, yapay zeka gizlilik ayarların ve hesap yönetimi.
          </Text>
        </StaggeredEntry>

        {/* 1. Profile Card */}
        <StaggeredEntry
          index={1}
          active={isActiveTab}
          enabled={!returningFromAdmin}
          style={styles.card}
        >
          <View style={styles.profileTop}>
            <View style={[styles.avatarCircle, isAdmin && styles.avatarCircleAdmin]}>
              <Text style={[styles.avatarText, isAdmin && { color: '#FFFFFF' }]}>
                {user.displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameBadgeRow}>
                <Text style={styles.profileName}>{user.displayName}</Text>
                <View style={[styles.roleBadge, isAdmin ? styles.roleBadgeAdmin : styles.roleBadgeUser]}>
                  <Ionicons
                    name={isAdmin ? 'shield-checkmark' : 'person-outline'}
                    size={12}
                    color={isAdmin ? colors.brand : colors.inkSecondary}
                  />
                  <Text
                    style={[
                      styles.roleBadgeText,
                      isAdmin ? { color: colors.brand } : { color: colors.inkSecondary },
                    ]}
                  >
                    {isAdmin ? 'ADMIN' : 'Standart Hesap'}
                  </Text>
                </View>
              </View>
              <Text style={styles.profileHandle}>@{user.username}</Text>
            </View>
          </View>

          <View style={styles.profileStatsRow}>
            <View style={styles.miniStat}>
              <Text style={styles.miniStatVal}>{stats.totalScans}</Text>
              <Text style={styles.miniStatLabel}>Tarama</Text>
            </View>
            <View style={styles.miniStatDivider} />
            <View style={styles.miniStat}>
              <Text style={styles.miniStatVal}>{stats.favoriteCount}</Text>
              <Text style={styles.miniStatLabel}>Favori</Text>
            </View>
            <View style={styles.miniStatDivider} />
            <View style={styles.miniStat}>
              <Text style={styles.miniStatVal}>{stats.catalogTotal}</Text>
              <Text style={styles.miniStatLabel}>Katalog</Text>
            </View>
          </View>
        </StaggeredEntry>

        {/* 2. Admin Panel Entry (Strictly Admin Only) */}
        {isAdmin && (
          <StaggeredEntry index={2} active={isActiveTab} enabled={!returningFromAdmin}>
            <SpringPressable
              haptic
              scaleTo={0.97}
              onPress={() => onSetAdminMode(true)}
              style={styles.adminEntryCard}
            >
              <View style={styles.adminIconWrap}>
                <Ionicons name="shield-checkmark" size={22} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.adminTitleRow}>
                  <Text style={styles.adminEntryTitle}>Admin Paneli &amp; Veritabanı</Text>
                  <PulseDot color={colors.brand} size={6} />
                </View>
                <Text style={styles.adminEntrySub}>
                  Tüm hesapları, taramaları, Blob fotoğrafları ve Azure PostgreSQL veritabanını yönet
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.brand} />
            </SpringPressable>
          </StaggeredEntry>
        )}

        {/* 3. Account-Bound Face ID & Security */}
        <StaggeredEntry
          index={isAdmin ? 3 : 2}
          active={isActiveTab}
          enabled={!returningFromAdmin}
          style={styles.card}
        >
          <View style={styles.aiHeaderRow}>
            <Text style={styles.sectionMiniTitle}>GÜVENLİK &amp; {bioCaps.label.toUpperCase()}</Text>
            {bioBinding && bioBinding.userId === user.id && (
              <View style={styles.privacyBadge}>
                <Ionicons name="shield-checkmark" size={11} color={colors.moodNeutral} />
                <Text style={styles.privacyBadgeText}>Hesaba Bağlı</Text>
              </View>
            )}
          </View>

          {!bioCaps.available ? (
            <View style={styles.infoRowBox}>
              <Text style={styles.infoLabel}>{bioCaps.label} Kullanılamıyor</Text>
              <Text style={styles.bioSubtleText}>
                Cihazda Face ID ayarlanmamış veya devre dışı. iPhone Ayarlar üzerinden Face ID’yi etkinleştirip tekrar deneyebilirsin.
              </Text>
            </View>
          ) : !bioBinding ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.cardSub}>
                {bioCaps.label} yalnızca @{user.username} hesabıyla eşleştirilir. Başka hesaplar Face ID ile açılamaz ve telefona yeni yüz eklenirse güvenlik nedeniyle sıfırlanır.
              </Text>
              <SpringPressable
                haptic
                disabled={bioBusy}
                onPress={handleLinkBiometric}
                style={[styles.bioEnrollBtn, bioBusy && { opacity: 0.65 }]}
              >
                {bioBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.bioEnrollBtnText}>
                      {bioCaps.label}’yi @{user.username} Hesabıyla Eşleştir
                    </Text>
                  </>
                )}
              </SpringPressable>
            </View>
          ) : bioBinding.userId === user.id ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.bioSubtleText}>
                Bu cihazdaki {bioCaps.label}, giriş ekranında şifre girmeden doğrudan @{user.username} hesabına giriş yapmak için iOS Keychain (.biometryCurrentSet) ile eşleştirildi. Uygulama kilidi uygulanmaz.
              </Text>

              <SpringPressable
                haptic
                onPress={handleUnlinkBiometric}
                style={styles.bioUnlinkBtn}
              >
                <Ionicons name="unlink-outline" size={16} color={colors.danger} />
                <Text style={styles.bioUnlinkText}>
                  {bioCaps.label} Eşleştirmesini Kaldır
                </Text>
              </SpringPressable>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={styles.infoRowBox}>
                <Text style={styles.infoLabel}>Başka Hesaba Eşleştirilmiş</Text>
                <Text style={styles.bioSubtleText}>
                  Bu cihazdaki {bioCaps.label} yalnızca @{bioBinding.username} (
                  {bioBinding.role === 'admin' ? 'Admin' : 'Standart'}) hesabıyla eşleştirilmiş durumda.
                </Text>
              </View>
              {isAdmin && (
                <SpringPressable
                  haptic
                  disabled={bioBusy}
                  onPress={() => {
                    Alert.alert(
                      `${bioCaps.label} Eşleştirmesini Devral`,
                      `Mevcut @${bioBinding.username} eşleştirmesi kaldırılıp ${bioCaps.label} sadece Admin (@${user.username}) hesabına bağlansın mı?`,
                      [
                        { text: 'Vazgeç', style: 'cancel' },
                        { text: 'Devral', onPress: handleLinkBiometric },
                      ]
                    );
                  }}
                  style={styles.secondaryActionBtn}
                >
                  <Ionicons name="shield-checkmark-outline" size={17} color={colors.brand} />
                  <Text style={[styles.secondaryActionText, { color: colors.brand }]}>
                    {bioCaps.label}’yi Admin Hesabıma Bağla
                  </Text>
                </SpringPressable>
              )}
            </View>
          )}
        </StaggeredEntry>

        {/* 4. Theme Selection */}
        <StaggeredEntry
          index={isAdmin ? 4 : 3}
          active={isActiveTab}
          enabled={!returningFromAdmin}
          style={styles.card}
        >
          <Text style={styles.sectionMiniTitle}>GÖRÜNÜM &amp; TEMA SEÇİMİ</Text>
          <Text style={styles.cardSub}>
            iPhone 16 Pro OLED ekranına özel simsiyah ve koyu temalardan birini seçebilirsin.
          </Text>

          <View style={styles.themeGrid}>
            {themes.map((t) => {
              const selected = themeId === t.id;
              return (
                <SpringPressable
                  key={t.id}
                  haptic
                  scaleTo={0.95}
                  onPress={() => setThemeId(t.id)}
                  style={[styles.themeCard, selected && styles.themeCardSelected]}
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
                </SpringPressable>
              );
            })}
          </View>
        </StaggeredEntry>

        {/* 5. AI Engine & Device Info */}
        <StaggeredEntry
          index={isAdmin ? 5 : 4}
          active={isActiveTab}
          enabled={!returningFromAdmin}
          style={styles.card}
        >
          <View style={styles.aiHeaderRow}>
            <Text style={styles.sectionMiniTitle}>YAPAY ZEKA &amp; CİHAZ BİLGİSİ</Text>
            <View style={styles.privacyBadge}>
              <Ionicons name="cloud-done" size={11} color={colors.moodNeutral} />
              <Text style={styles.privacyBadgeText}>Cihaz İçi AI · Azure Bulut Kayıt</Text>
            </View>
          </View>

          <View style={styles.infoRowBox}>
            <Text style={styles.infoLabel}>Aktif AI Motoru</Text>
            <Text style={styles.infoValue}>{engineInfo.label}</Text>
          </View>

          <View style={[styles.infoRowBox, { marginTop: 10 }]}>
            <Text style={styles.infoLabel}>
              {isAdmin ? 'Azure Bulut Global Veriler' : 'Kişisel Bulut Verilerin'}
            </Text>
            <Text style={styles.infoValue}>
              {isAdmin
                ? `${storageInfo.photoCount} Blob fotoğraf · ${storageInfo.scanCount} tarama · ${storageInfo.trackCount} şarkı`
                : `${stats.totalScans} tarama · ${stats.favoriteCount} favori · ${stats.catalogTotal} bulut şarkısı`}
            </Text>
          </View>
        </StaggeredEntry>

        {/* 6. Account & Data Actions */}
        <StaggeredEntry
          index={isAdmin ? 6 : 5}
          active={isActiveTab}
          enabled={!returningFromAdmin}
          style={styles.card}
        >
          <Text style={styles.sectionMiniTitle}>HESAP &amp; VERİ YÖNETİMİ</Text>

          <View style={styles.actionsCol}>
            <SpringPressable
              haptic
              onPress={() => {
                loadSecurityAndDisliked().catch(() => {});
                setDislikedModalOpen(true);
              }}
              style={styles.secondaryActionBtn}
            >
              <Ionicons name="eye-off-outline" size={18} color={colors.inkPrimary} />
              <Text style={styles.secondaryActionText}>
                Gizlenen Şarkılar ({dislikedTracks.length})
              </Text>
            </SpringPressable>

            <SpringPressable
              haptic
              onPress={() => {
                Alert.alert(
                  'Tarama Geçmişini Temizle',
                  'Sadece kendi hesabına ait tüm fotoğraf ve tarama kayıtların silinecek. Devam edilsin mi?',
                  [
                    { text: 'Vazgeç', style: 'cancel' },
                    {
                      text: 'Temizle',
                      style: 'destructive',
                      onPress: async () => {
                        await onClearOwnHistory();
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                          () => {}
                        );
                      },
                    },
                  ]
                );
              }}
              style={styles.secondaryActionBtn}
            >
              <Ionicons name="time-outline" size={18} color={colors.inkPrimary} />
              <Text style={styles.secondaryActionText}>Kendi Tarama Geçmişimi Temizle</Text>
            </SpringPressable>

            {isAdmin && (
              <SpringPressable
                haptic
                onPress={() => {
                  Alert.alert(
                    'Bulut Kullanıcı Verilerini Sıfırla',
                    'Tüm tarama geçmişi, Blob fotoğraflar, kullanıcılar (admin haluk hariç) ve playlistler Azure üzerinden sıfırlanacak. Paylaşılan şarkı kataloğu korunur. Devam edilsin mi?',
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
                style={styles.dangerActionBtn}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={styles.dangerActionText}>Bulut Kullanıcı Verilerini Sıfırla</Text>
              </SpringPressable>
            )}

            <SpringPressable haptic onPress={onLogout} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
              <Text style={styles.logoutBtnText}>Çıkış Yap</Text>
            </SpringPressable>
          </View>
        </StaggeredEntry>
      </ScrollView>

      {/* Disliked / Hidden Tracks Management Modal */}
      <Modal
        visible={dislikedModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDislikedModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDislikedModalOpen(false)} />
          <SafeAreaView edges={['bottom']} style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Gizlenen Şarkılar</Text>
                <Text style={styles.modalSub}>
                  “Bir Daha Önerme” dediğiniz şarkılar burada tutulur. İstediğinizi geri alabilirsiniz.
                </Text>
              </View>
              <SpringPressable
                haptic
                onPress={() => setDislikedModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={18} color={colors.inkSecondary} />
              </SpringPressable>
            </View>

            {dislikedTracks.length === 0 ? (
              <View style={styles.modalEmpty}>
                <Ionicons name="musical-notes-outline" size={28} color={colors.inkMuted} />
                <Text style={styles.modalEmptyText}>Henüz gizlediğiniz bir şarkı yok.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 8 }}>
                {dislikedTracks.map((tr) => (
                  <View key={tr.id} style={styles.dislikedRow}>
                    {tr.artworkUrl ? (
                      <Image source={{ uri: tr.artworkUrl }} style={styles.dislikedCover} />
                    ) : (
                      <View style={[styles.dislikedCover, { alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="musical-notes" size={16} color={colors.brand} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.dislikedTitle}>
                        {tr.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.dislikedArtist}>
                        {tr.artist}
                      </Text>
                    </View>
                    <SpringPressable
                      haptic
                      onPress={() => handleRestoreDisliked(tr.id)}
                      style={styles.restoreBtn}
                    >
                      <Text style={styles.restoreBtnText}>Geri Al</Text>
                    </SpringPressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </Animated.View>
  );
});

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 155,
      gap: 12,
    },
    headerBlock: {
      marginBottom: 2,
    },
    pageTitle: {
      fontSize: 23,
      fontWeight: '800',
      letterSpacing: -0.6,
      color: colors.inkPrimary,
    },
    pageSub: {
      marginTop: 4,
      fontSize: 13,
      color: colors.inkSecondary,
      lineHeight: 18,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    profileTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
    },
    avatarCircle: {
      width: 52,
      height: 52,
      borderRadius: 16,
      backgroundColor: colors.subtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarCircleAdmin: {
      backgroundColor: colors.brand,
    },
    avatarText: {
      fontSize: 21,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    nameBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    profileName: {
      fontSize: 17.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    roleBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
    },
    roleBadgeAdmin: {
      backgroundColor: colors.brandSoft,
    },
    roleBadgeUser: {
      backgroundColor: colors.subtle,
    },
    roleBadgeText: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    profileHandle: {
      marginTop: 2,
      fontSize: 13,
      color: colors.inkSecondary,
      fontWeight: '600',
    },
    profileStatsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 14,
      paddingTop: 13,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    miniStat: {
      flex: 1,
      alignItems: 'center',
    },
    miniStatVal: {
      fontSize: 17,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    miniStatLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.inkMuted,
      marginTop: 2,
    },
    miniStatDivider: {
      width: 1,
      height: 24,
      backgroundColor: colors.hairline,
    },
    adminEntryCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      backgroundColor: colors.brandSoft,
      borderRadius: 20,
      padding: 15,
      borderWidth: 1.5,
      borderColor: colors.brand,
    },
    adminIconWrap: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    adminTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    adminEntryTitle: {
      fontSize: 15.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    adminEntrySub: {
      marginTop: 2,
      fontSize: 12,
      color: colors.inkSecondary,
      lineHeight: 17,
    },
    sectionMiniTitle: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.7,
      color: colors.inkMuted,
    },
    cardSub: {
      marginTop: 4,
      fontSize: 12.5,
      color: colors.inkSecondary,
      lineHeight: 18,
      marginBottom: 12,
    },
    themeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 9,
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
    aiHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 10,
    },
    privacyBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.moodNeutralSoft,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    privacyBadgeText: {
      fontSize: 10.5,
      fontWeight: '800',
      color: colors.moodNeutral,
    },
    infoRowBox: {
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.elevated,
      padding: 12,
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
    actionsCol: {
      marginTop: 12,
      gap: 9,
    },
    secondaryActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 13,
      backgroundColor: colors.subtle,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    secondaryActionText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    dangerActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 13,
      backgroundColor: colors.dangerSoft,
    },
    dangerActionText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.danger,
    },
    logoutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: 13,
      backgroundColor: colors.brand,
      marginTop: 2,
    },
    logoutBtnText: {
      fontSize: 14,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    bioSubtleText: {
      marginTop: 4,
      fontSize: 12.5,
      color: colors.inkSecondary,
      lineHeight: 18,
    },
    bioEnrollBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brand,
      paddingVertical: 13,
      borderRadius: 13,
    },
    bioEnrollBtnText: {
      fontSize: 13.5,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.elevated,
      borderRadius: 14,
      paddingHorizontal: 13,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    switchTitle: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    switchDesc: {
      marginTop: 2,
      fontSize: 11.5,
      color: colors.inkSecondary,
      lineHeight: 16,
    },
    bioUnlinkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      backgroundColor: colors.dangerSoft,
      paddingVertical: 11,
      borderRadius: 12,
    },
    bioUnlinkText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.danger,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.62)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      maxHeight: '78%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    modalHandle: {
      alignSelf: 'center',
      width: 38,
      height: 4.5,
      borderRadius: 999,
      backgroundColor: colors.hairlineStrong,
      marginBottom: 12,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 14,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    modalSub: {
      marginTop: 2,
      fontSize: 12,
      color: colors.inkSecondary,
      lineHeight: 17,
    },
    modalCloseBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalEmpty: {
      alignItems: 'center',
      paddingVertical: 28,
      gap: 8,
    },
    modalEmptyText: {
      fontSize: 13,
      color: colors.inkSecondary,
    },
    dislikedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.elevated,
      borderRadius: 14,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    dislikedCover: {
      width: 42,
      height: 42,
      borderRadius: 10,
      backgroundColor: colors.subtle,
    },
    dislikedTitle: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    dislikedArtist: {
      marginTop: 1,
      fontSize: 12,
      color: colors.inkSecondary,
    },
    restoreBtn: {
      backgroundColor: colors.brandSoft,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 10,
    },
    restoreBtnText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.brand,
    },
  });
