import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  DashboardStats,
  isAdminUser,
  TrackRecord,
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
  visitTick: number;
  onSetAdminMode: (open: boolean) => void;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onDatabaseMutated: () => void;
  onClearOwnHistory: () => Promise<void>;
  onWipeAllData: () => Promise<void>;
  onLogout: () => void;
}

export const SettingsScreen: React.FC<Props> = ({
  user,
  stats,
  storageInfo,
  adminMode,
  visitTick,
  onSetAdminMode,
  onPlayTrack,
  onDatabaseMutated,
  onClearOwnHistory,
  onWipeAllData,
  onLogout,
}) => {
  const { colors, themeId, themes, setThemeId } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isAdmin = isAdminUser(user);
  const showAdmin = isAdmin && adminMode;
  const engineInfo = getAiEngineSummary();

  const slideX = useRef(new Animated.Value(0)).current;
  const viewOpacity = useRef(new Animated.Value(1)).current;
  const prevShowAdmin = useRef(showAdmin);

  useEffect(() => {
    if (prevShowAdmin.current === showAdmin) return;
    const enteringAdmin = showAdmin;
    prevShowAdmin.current = showAdmin;

    slideX.setValue(enteringAdmin ? 34 : -34);
    viewOpacity.setValue(0);

    Animated.parallel([
      Animated.timing(viewOpacity, {
        toValue: 1,
        duration: 240,
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
    ]).start();
  }, [showAdmin, slideX, viewOpacity]);

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
        <StaggeredEntry index={0} animationKey={visitTick} style={styles.headerBlock}>
          <Text style={styles.pageTitle}>Ayarlar</Text>
          <Text style={styles.pageSub}>
            Profilin, tema tercihin, yapay zeka gizlilik ayarların ve hesap yönetimi.
          </Text>
        </StaggeredEntry>

        {/* 1. Profile Card */}
        <StaggeredEntry index={1} animationKey={visitTick} style={styles.card}>
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
          <StaggeredEntry index={2} animationKey={visitTick}>
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
                  Tüm hesapları, taramaları, fotoğrafları ve SQLite veritabanını görüntüle ve yönet
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.brand} />
            </SpringPressable>
          </StaggeredEntry>
        )}

        {/* 3. Theme Selection */}
        <StaggeredEntry index={isAdmin ? 3 : 2} animationKey={visitTick} style={styles.card}>
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

        {/* 4. AI Engine & Device Info */}
        <StaggeredEntry index={isAdmin ? 4 : 3} animationKey={visitTick} style={styles.card}>
          <View style={styles.aiHeaderRow}>
            <Text style={styles.sectionMiniTitle}>YAPAY ZEKA &amp; CİHAZ BİLGİSİ</Text>
            <View style={styles.privacyBadge}>
              <Ionicons name="lock-closed" size={11} color={colors.moodNeutral} />
              <Text style={styles.privacyBadgeText}>Cihaz İçi · Buluta Gönderilmez</Text>
            </View>
          </View>

          <View style={styles.infoRowBox}>
            <Text style={styles.infoLabel}>Aktif AI Motoru</Text>
            <Text style={styles.infoValue}>{engineInfo.label}</Text>
          </View>

          <View style={[styles.infoRowBox, { marginTop: 10 }]}>
            <Text style={styles.infoLabel}>
              {isAdmin ? 'Uygulama İçi Global Veriler' : 'Kişisel Hesap Verilerin'}
            </Text>
            <Text style={styles.infoValue}>
              {isAdmin
                ? `${storageInfo.photoCount} fotoğraf · ${storageInfo.scanCount} tarama · ${storageInfo.trackCount} şarkı`
                : `${stats.totalScans} tarama · ${stats.favoriteCount} favori · ${stats.catalogTotal} şarkı`}
            </Text>
          </View>
        </StaggeredEntry>

        {/* 5. Account & Data Actions */}
        <StaggeredEntry index={isAdmin ? 5 : 4} animationKey={visitTick} style={styles.card}>
          <Text style={styles.sectionMiniTitle}>HESAP &amp; VERİ YÖNETİMİ</Text>

          <View style={styles.actionsCol}>
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
                    'Tüm Yerel Verileri Sil',
                    'Çekilen tüm fotoğraflar, tarama geçmişi, tüm hesaplar ve yerel müzik veritabanı telefondan kalıcı olarak silinecek. Devam edilsin mi?',
                    [
                      { text: 'Vazgeç', style: 'cancel' },
                      {
                        text: 'Hepsini Sil',
                        style: 'destructive',
                        onPress: onWipeAllData,
                      },
                    ]
                  );
                }}
                style={styles.dangerActionBtn}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={styles.dangerActionText}>Tüm Yerel Verileri Sıfırla</Text>
              </SpringPressable>
            )}

            <SpringPressable haptic onPress={onLogout} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
              <Text style={styles.logoutBtnText}>Çıkış Yap</Text>
            </SpringPressable>
          </View>
        </StaggeredEntry>
      </ScrollView>
    </Animated.View>
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
  });
