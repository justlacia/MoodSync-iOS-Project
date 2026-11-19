import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { TrackRow } from '../components/TrackRow';
import { queryCatalogTracks, TrackRecord } from '../database/iosDatabase';
import { fetchAndStoreOnlineSongs } from '../services/onlineMusicService';
import { Colors, MoodType } from '../theme/colors';

interface Props {
  userId: number;
  catalogTotal: number;
  playingTrackId: number | null;
  isAudioPlaying: boolean;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onToggleFavorite: (trackId: number) => Promise<void>;
  onCatalogExpanded: () => void;
}

export const LibraryScreen: React.FC<Props> = ({
  userId,
  catalogTotal,
  playingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onToggleFavorite,
  onCatalogExpanded,
}) => {
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [moodFilter, setMoodFilter] = useState<MoodType | ''>('');
  const [langFilter, setLangFilter] = useState<'tr' | 'global' | ''>('');
  const [favOnly, setFavOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [fetchingOnline, setFetchingOnline] = useState(false);

  const loadTracks = useCallback(async () => {
    try {
      const rows = await queryCatalogTracks({
        userId,
        mood: moodFilter,
        language: langFilter,
        search,
        favoritesOnly: favOnly,
        limit: 140,
      });
      setTracks(rows);
    } catch {
      // Ignore transient connection error
    }
  }, [favOnly, langFilter, moodFilter, search, userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTracks();
    }, 180);
    return () => clearTimeout(timer);
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
      await loadTracks();
    } finally {
      setFetchingOnline(false);
    }
  };

  return (
    <FlatList
      data={tracks}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      initialNumToRender={16}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Müzik Veritabanı</Text>
              <Text style={styles.subtitle}>
                {catalogTotal} çevrimiçi şarkı senkronize edildi · Apple iTunes &amp; Deezer destekli
              </Text>
            </View>
            <Pressable
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
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={Colors.inkMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Sanatçı, şarkı veya tür ara…"
              placeholderTextColor={Colors.inkMuted}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={handlePullOnline}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={Colors.inkMuted} />
              </Pressable>
            )}
          </View>

          <View style={styles.filterGroup}>
            {([
              { key: '', label: 'Tüm Modlar' },
              { key: 'positive', label: 'Mutlu' },
              { key: 'neutral', label: 'Dingin' },
              { key: 'negative', label: 'Üzgün & Kızgın' },
            ] as const).map((m) => (
              <Pressable
                key={m.key || 'all'}
                onPress={() => setMoodFilter(m.key)}
                style={[styles.chip, moodFilter === m.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, moodFilter === m.key && styles.chipTextActive]}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.filterGroup}>
            {([
              { key: '', label: 'Tüm Diller' },
              { key: 'tr', label: 'Türkçe' },
              { key: 'global', label: 'Yabancı' },
            ] as const).map((lg) => (
              <Pressable
                key={lg.key || 'all-lang'}
                onPress={() => setLangFilter(lg.key)}
                style={[styles.chip, langFilter === lg.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, langFilter === lg.key && styles.chipTextActive]}>
                  {lg.label}
                </Text>
              </Pressable>
            ))}

            <Pressable
              onPress={() => setFavOnly((v) => !v)}
              style={[styles.chip, favOnly && styles.chipActive]}
            >
              <Text style={[styles.chipText, favOnly && styles.chipTextActive]}>♥ Favorilerim</Text>
            </Pressable>
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Aramana uygun yerel kayıt bulunamadı. &quot;İnternetten Çek&quot; tuşuyla çevrimiçi veritabanından anında ekleyebilirsin.
          </Text>
        </View>
      }
      renderItem={({ item, index }) => (
        <TrackRow
          track={item}
          isActiveTrack={playingTrackId === item.id}
          isPlaying={playingTrackId === item.id && isAudioPlaying}
          onPlayPress={() => onPlayTrack(tracks, index)}
          onToggleFavorite={async () => {
            await onToggleFavorite(item.id);
            await loadTracks();
          }}
        />
      )}
    />
  );
};

const styles = StyleSheet.create({
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
    color: Colors.inkPrimary,
  },
  subtitle: {
    marginTop: 3,
    fontSize: 12.5,
    color: Colors.inkSecondary,
  },
  onlineFetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.brand,
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
    backgroundColor: Colors.surface,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.hairlineStrong,
    paddingHorizontal: 12,
    height: 46,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14.5,
    color: Colors.inkPrimary,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairlineStrong,
  },
  chipActive: {
    backgroundColor: Colors.brandSoft,
    borderColor: Colors.brand,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.inkSecondary,
  },
  chipTextActive: {
    color: Colors.brand,
    fontWeight: '800',
  },
  emptyBox: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.inkSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
