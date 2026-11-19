import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SpringPressable, StaggeredEntry } from '../components/MotionPrimitives';
import { TrackRow } from '../components/TrackRow';
import {
  fetchAndStoreOnlineSongs,
  queryCatalogTracks,
  TrackRecord,
} from '../database/iosDatabase';
import { MoodType, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  userId: number;
  catalogTotal: number;
  visitTick?: number;
  playingTrackId: number | null;
  isAudioPlaying: boolean;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onToggleFavorite: (trackId: number) => Promise<void>;
  onCatalogExpanded: () => void;
}

export const LibraryScreen: React.FC<Props> = ({
  userId,
  catalogTotal,
  visitTick = 0,
  playingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onToggleFavorite,
  onCatalogExpanded,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [catalogState, setCatalogState] = useState<{
    rows: TrackRecord[];
    animKey: number;
    hasLoaded: boolean;
  }>({
    rows: [],
    animKey: 0,
    hasLoaded: false,
  });
  const [moodFilter, setMoodFilter] = useState<MoodType | ''>('');
  const [langFilter, setLangFilter] = useState<'tr' | 'global' | ''>('');
  const [favOnly, setFavOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fetchingOnline, setFetchingOnline] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      setDebouncedSearch('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(trimmed);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);

  const loadTracks = useCallback(
    async (shouldAnimate = true) => {
      const reqId = ++requestIdRef.current;
      try {
        const rows = await queryCatalogTracks({
          userId,
          mood: moodFilter,
          language: langFilter,
          search: debouncedSearch,
          favoritesOnly: favOnly,
          limit: 140,
        });
        if (reqId !== requestIdRef.current) return;
        setCatalogState((prev) => ({
          rows,
          animKey: shouldAnimate ? prev.animKey + 1 : prev.animKey,
          hasLoaded: true,
        }));
      } catch {
        // Ignore transient error
      }
    },
    [debouncedSearch, favOnly, langFilter, moodFilter, userId]
  );

  useEffect(() => {
    loadTracks(true);
  }, [loadTracks]);

  const handlePullOnline = async () => {
    if (fetchingOnline) return;
    Haptics.selectionAsync().catch(() => {});
    setFetchingOnline(true);
    try {
      await fetchAndStoreOnlineSongs({
        mood: moodFilter || 'positive',
        language: langFilter || 'all',
        customQuery: search.trim() || undefined,
      });
      onCatalogExpanded();
      await loadTracks(true);
    } finally {
      setFetchingOnline(false);
    }
  };

  return (
    <FlatList
      data={catalogState.rows}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      initialNumToRender={16}
      ListHeaderComponent={
        <View style={styles.header}>
          <StaggeredEntry index={0} animationKey={visitTick} style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Müzik Veritabanı</Text>
              <Text style={styles.subtitle}>
                {catalogTotal} çevrimiçi şarkı senkronize edildi · Apple iTunes &amp; Deezer destekli
              </Text>
            </View>
            <SpringPressable
              haptic
              onPress={handlePullOnline}
              disabled={fetchingOnline}
              style={styles.onlineFetchBtn}
            >
              {fetchingOnline ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="cloud-download-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.onlineFetchText}>İnternetten Çek</Text>
                </>
              )}
            </SpringPressable>
          </StaggeredEntry>

          <StaggeredEntry index={1} animationKey={visitTick} style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={colors.inkMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Sanatçı, şarkı veya tür ara…"
              placeholderTextColor={colors.inkMuted}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={handlePullOnline}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
              </Pressable>
            )}
          </StaggeredEntry>

          <StaggeredEntry index={2} animationKey={visitTick} style={styles.filterGroup}>
            {([
              { key: '', label: 'Tüm Modlar' },
              { key: 'positive', label: 'Mutlu' },
              { key: 'neutral', label: 'Dingin' },
              { key: 'negative', label: 'Üzgün & Kızgın' },
            ] as const).map((m) => (
              <SpringPressable
                key={m.key || 'all'}
                haptic
                onPress={() => setMoodFilter(m.key)}
                style={[styles.chip, moodFilter === m.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, moodFilter === m.key && styles.chipTextActive]}>
                  {m.label}
                </Text>
              </SpringPressable>
            ))}
          </StaggeredEntry>

          <StaggeredEntry index={3} animationKey={visitTick} style={styles.filterGroup}>
            {([
              { key: '', label: 'Tüm Diller' },
              { key: 'tr', label: 'Türkçe' },
              { key: 'global', label: 'Yabancı' },
            ] as const).map((lg) => (
              <SpringPressable
                key={lg.key || 'all-lang'}
                haptic
                onPress={() => setLangFilter(lg.key)}
                style={[styles.chip, langFilter === lg.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, langFilter === lg.key && styles.chipTextActive]}>
                  {lg.label}
                </Text>
              </SpringPressable>
            ))}

            <SpringPressable
              haptic
              onPress={() => setFavOnly((v) => !v)}
              style={[styles.chip, favOnly && styles.chipActive]}
            >
              <Text style={[styles.chipText, favOnly && styles.chipTextActive]}>♥ Favorilerim</Text>
            </SpringPressable>
          </StaggeredEntry>
        </View>
      }
      ListEmptyComponent={
        catalogState.hasLoaded ? (
          <StaggeredEntry index={1} animationKey={`${visitTick}-${catalogState.animKey}`} style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              Aramana uygun yerel kayıt bulunamadı. &quot;İnternetten Çek&quot; tuşuyla çevrimiçi veritabanından anında ekleyebilirsin.
            </Text>
          </StaggeredEntry>
        ) : undefined
      }
      renderItem={({ item, index }) => (
        <TrackRow
          track={item}
          index={index}
          animationKey={`${visitTick}-${catalogState.animKey}`}
          isActiveTrack={playingTrackId === item.id}
          isPlaying={playingTrackId === item.id && isAudioPlaying}
          onPlayPress={() => onPlayTrack(catalogState.rows, index)}
          onToggleFavorite={async () => {
            await onToggleFavorite(item.id);
            await loadTracks(false);
          }}
        />
      )}
    />
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 150,
    },
    header: {
      marginBottom: 12,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 14,
    },
    title: {
      fontSize: 23,
      fontWeight: '800',
      letterSpacing: -0.6,
      color: colors.inkPrimary,
    },
    subtitle: {
      marginTop: 3,
      fontSize: 12.5,
      color: colors.inkSecondary,
    },
    onlineFetchBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brand,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 12,
    },
    onlineFetchText: {
      color: '#FFFFFF',
      fontSize: 12.5,
      fontWeight: '700',
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      paddingHorizontal: 12,
      height: 46,
      gap: 8,
      marginBottom: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 14.5,
      color: colors.inkPrimary,
    },
    filterGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      marginBottom: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6.5,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    chipActive: {
      backgroundColor: colors.brandSoft,
      borderColor: colors.brand,
    },
    chipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    chipTextActive: {
      color: colors.brand,
      fontWeight: '800',
    },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 22,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    emptyText: {
      fontSize: 13,
      color: colors.inkSecondary,
      textAlign: 'center',
      lineHeight: 19,
    },
  });
