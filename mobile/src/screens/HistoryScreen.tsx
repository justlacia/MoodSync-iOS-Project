import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { DashboardStats, ScanSessionRecord } from '../database/iosDatabase';
import { resolveMoodVisual, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  sessions: ScanSessionRecord[];
  stats: DashboardStats;
  onOpenSession: (sessionId: number) => void;
  onDeleteSession: (sessionId: number) => void;
  onNewScan: () => void;
}

export const HistoryScreen: React.FC<Props> = ({
  sessions,
  stats,
  onOpenSession,
  onDeleteSession,
  onNewScan,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const formatDate = (iso: string) => {
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
  };

  return (
    <FlatList
      data={sessions}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View style={styles.headerWrap}>
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Geçmiş Taramalar</Text>
              <Text style={styles.subtitle}>
                Daha önce çektiğin fotoğraflar ve o anki moduna özel oluşturulan şarkı listeleri.
              </Text>
            </View>
            <Pressable
              onPress={onNewScan}
              style={({ pressed }) => [styles.newScanBtn, pressed && { transform: [{ scale: 0.96 }] }]}
            >
              <Ionicons name="camera" size={16} color="#FFFFFF" />
              <Text style={styles.newScanText}>Yeni Çekim</Text>
            </Pressable>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Toplam Tarama</Text>
              <Text style={styles.statVal}>{stats.totalScans}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Baskın Mod</Text>
              <Text style={styles.statVal}>
                {stats.dominantMood
                  ? resolveMoodVisual(stats.dominantMood, stats.dominantEmotion, colors).shortTr
                  : '—'}
              </Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Favori Şarkılar</Text>
              <Text style={styles.statVal}>{stats.favoriteCount}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Şarkı Havuzu</Text>
              <Text style={styles.statVal}>{stats.catalogTotal}</Text>
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Ionicons name="time-outline" size={36} color={colors.inkMuted} />
          <Text style={styles.emptyTitle}>Henüz kayıtlı bir tarama yok</Text>
          <Text style={styles.emptyDesc}>
            Kamera sekmesinden fotoğraf çektiğinde tüm geçmiş session kayıtların burada saklanır.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const meta = resolveMoodVisual(item.mood, item.emotion, colors);
        const isFront = item.deviceLabel.toLowerCase().includes('ön kamera');
        return (
          <View style={styles.card}>
            <View style={styles.cardTop}>
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
                </View>
                <Text style={styles.deviceText}>{item.deviceLabel}</Text>
                <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
              </View>
            </View>

            <View style={styles.cardFooter}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onOpenSession(item.id);
                }}
                style={({ pressed }) => [styles.openBtn, pressed && { opacity: 0.78 }]}
              >
                <Ionicons name="musical-notes-outline" size={16} color={colors.inkPrimary} />
                <Text style={styles.openBtnText}>Şarkı Listesini Aç ({item.trackCount})</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  onDeleteSession(item.id);
                }}
                style={styles.deleteBtn}
              >
                <Ionicons name="trash-outline" size={17} color={colors.inkMuted} />
              </Pressable>
            </View>
          </View>
        );
      }}
    />
  );
};

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
