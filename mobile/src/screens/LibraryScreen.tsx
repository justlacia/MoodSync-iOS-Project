import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AnimatedSegmentedControl,
  SpringPressable,
  StaggeredEntry,
} from '../components/MotionPrimitives';
import { TrackRow } from '../components/TrackRow';
import {
  createPlaylist,
  deletePlaylist,
  fetchAndStoreOnlineSongs,
  getPlaylistWithTracks,
  listUserPlaylists,
  PlaylistRecord,
  queryCatalogTracksPage,
  renamePlaylist,
  TrackRecord,
} from '../database/iosDatabase';
import { MoodType, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

const SONGS_PER_PAGE = 30;
const TRACK_ROW_STRIDE = 78;

const keyExtractorTrack = (item: TrackRecord) => String(item.id);
const getTrackItemLayout = (_: ArrayLike<TrackRecord> | null | undefined, index: number) => ({
  length: TRACK_ROW_STRIDE,
  offset: TRACK_ROW_STRIDE * index,
  index,
});

interface LibraryTrackItemProps {
  item: TrackRecord;
  index: number;
  animKey?: string;
  isActiveTrack: boolean;
  isPlaying: boolean;
  onPlayIndex: (index: number) => void;
  onToggleFav: (trackId: number) => void;
  onMore: (track: TrackRecord) => void;
}

const LibraryTrackItem: React.FC<LibraryTrackItemProps> = React.memo(
  ({ item, index, animKey, isActiveTrack, isPlaying, onPlayIndex, onToggleFav, onMore }) => {
    const handlePlay = useCallback(() => onPlayIndex(index), [index, onPlayIndex]);
    const handleToggle = useCallback(() => onToggleFav(item.id), [item.id, onToggleFav]);
    const handleMore = useCallback(() => onMore(item), [item, onMore]);

    return (
      <TrackRow
        track={item}
        index={index}
        animationKey={animKey}
        isActiveTrack={isActiveTrack}
        isPlaying={isPlaying}
        onPlayPress={handlePlay}
        onToggleFavorite={handleToggle}
        onMorePress={handleMore}
      />
    );
  }
);

interface Props {
  userId: number;
  catalogTotal: number;
  isActiveTab: boolean;
  playlistsRefreshTick?: number;
  playingTrackId: number | null;
  isAudioPlaying: boolean;
  onPlayTrack: (queue: TrackRecord[], index: number) => void;
  onToggleFavorite: (trackId: number) => Promise<void>;
  onTrackMorePress: (track: TrackRecord, playlistContext?: PlaylistRecord | null) => void;
  onCatalogExpanded: () => void;
}

export const LibraryScreen: React.FC<Props> = React.memo(({
  userId,
  catalogTotal,
  isActiveTab,
  playlistsRefreshTick = 0,
  playingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onToggleFavorite,
  onTrackMorePress,
  onCatalogExpanded,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [libraryMode, setLibraryMode] = useState<'songs' | 'playlists'>('songs');
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistRecord | null>(null);
  const [playlistModalMode, setPlaylistModalMode] = useState<'create' | 'rename' | null>(null);
  const [playlistNameInput, setPlaylistNameInput] = useState('');

  const [catalogState, setCatalogState] = useState<{
    rows: TrackRecord[];
    totalCount: number;
    animKey: number;
    hasLoaded: boolean;
  }>({
    rows: [],
    totalCount: 0,
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageAnimTick, setPageAnimTick] = useState(0);
  const hasMountedFiltersRef = useRef(false);
  const prevPlaylistsTickRef = useRef(playlistsRefreshTick);
  const songsListRef = useRef<FlatList<TrackRecord>>(null);

  const totalSongs = catalogState.totalCount;
  const totalPages = Math.max(1, Math.ceil(totalSongs / SONGS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStartIdx = (safePage - 1) * SONGS_PER_PAGE;
  const pagedRows = catalogState.rows;
  const rangeStart = totalSongs > 0 ? pageStartIdx + 1 : 0;
  const rangeEnd = Math.min(totalSongs, pageStartIdx + pagedRows.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [moodFilter, langFilter, favOnly, debouncedSearch]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleSelectPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPages, page));
      if (clamped === safePage) return;
      Haptics.selectionAsync().catch(() => {});
      setCurrentPage(clamped);
      setPageAnimTick((t) => t + 1);
      songsListRef.current?.scrollToOffset({ offset: 0, animated: true });
    },
    [safePage, totalPages]
  );

  const renderPaginationBar = useCallback(
    (position: 'top' | 'bottom') => {
      if (totalPages <= 1) return null;
      const pages: number[] = [];
      if (totalPages <= 14) {
        for (let p = 1; p <= totalPages; p++) pages.push(p);
      } else {
        const set = new Set<number>([1, totalPages]);
        for (let p = Math.max(1, safePage - 3); p <= Math.min(totalPages, safePage + 3); p++) {
          set.add(p);
        }
        pages.push(...Array.from(set).sort((a, b) => a - b));
      }
      return (
        <View
          style={[
            styles.paginationContainer,
            position === 'bottom' ? styles.paginationBottom : styles.paginationTop,
          ]}
        >
          <View style={styles.paginationMetaRow}>
            <Text style={styles.paginationPageLabel}>
              Sayfa {safePage} / {totalPages}
            </Text>
            <Text style={styles.paginationRangeLabel}>
              {rangeStart}–{rangeEnd} / {totalSongs} şarkı
            </Text>
          </View>

          <View style={styles.paginationControlsRow}>
            <SpringPressable
              haptic
              disabled={safePage <= 1}
              onPress={() => handleSelectPage(safePage - 1)}
              style={[styles.pageArrowBtn, safePage <= 1 && styles.pageArrowBtnDisabled]}
            >
              <Ionicons
                name="chevron-back"
                size={16}
                color={safePage <= 1 ? colors.inkMuted : colors.inkPrimary}
              />
            </SpringPressable>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pageNumbersScroll}
              style={styles.pageNumbersScroller}
            >
              {pages.map((pageNum, idx) => {
                const active = pageNum === safePage;
                const prev = idx > 0 ? pages[idx - 1] : null;
                const hasGap = prev !== null && pageNum - prev > 1;
                return (
                  <React.Fragment key={pageNum}>
                    {hasGap && (
                      <Text style={[styles.pageNumText, { alignSelf: 'center', paddingHorizontal: 4 }]}>
                        …
                      </Text>
                    )}
                    <SpringPressable
                      haptic
                      onPress={() => handleSelectPage(pageNum)}
                      style={[styles.pageNumBtn, active && styles.pageNumBtnActive]}
                    >
                      <Text style={[styles.pageNumText, active && styles.pageNumTextActive]}>
                        {pageNum}
                      </Text>
                    </SpringPressable>
                  </React.Fragment>
                );
              })}
            </ScrollView>

            <SpringPressable
              haptic
              disabled={safePage >= totalPages}
              onPress={() => handleSelectPage(safePage + 1)}
              style={[
                styles.pageArrowBtn,
                safePage >= totalPages && styles.pageArrowBtnDisabled,
              ]}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={safePage >= totalPages ? colors.inkMuted : colors.inkPrimary}
              />
            </SpringPressable>
          </View>
        </View>
      );
    },
    [
      colors.inkMuted,
      colors.inkPrimary,
      handleSelectPage,
      rangeEnd,
      rangeStart,
      safePage,
      styles,
      totalPages,
      totalSongs,
    ]
  );

  const loadPlaylists = useCallback(async () => {
    try {
      const list = await listUserPlaylists(userId);
      setPlaylists(list);
      setSelectedPlaylist((prev) => {
        if (!prev) return null;
        if (!list.some((p) => p.id === prev.id)) return null;
        return prev;
      });
    } catch {
      // Ignore transient error
    }
  }, [userId]);

  const refreshSelectedPlaylist = useCallback(
    async (playlistId: number) => {
      const full = await getPlaylistWithTracks(playlistId, userId);
      setSelectedPlaylist(full);
    },
    [userId]
  );

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists, playlistsRefreshTick]);

  useEffect(() => {
    if (selectedPlaylist?.id) {
      refreshSelectedPlaylist(selectedPlaylist.id).catch(() => {});
    }
  }, [playlistsRefreshTick, refreshSelectedPlaylist, selectedPlaylist?.id]);

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
        const pageData = await queryCatalogTracksPage({
          userId,
          mood: moodFilter,
          language: langFilter,
          search: debouncedSearch,
          favoritesOnly: favOnly,
          page: currentPage,
          pageSize: SONGS_PER_PAGE,
        });
        if (reqId !== requestIdRef.current) return;
        setCatalogState((prev) => ({
          rows: pageData.tracks,
          totalCount: pageData.totalCount,
          animKey: shouldAnimate ? prev.animKey + 1 : prev.animKey,
          hasLoaded: true,
        }));
        if (shouldAnimate) {
          setPageAnimTick((t) => t + 1);
        }
      } catch {
        if (reqId === requestIdRef.current) {
          setCatalogState((prev) => (prev.hasLoaded ? prev : { ...prev, hasLoaded: true }));
        }
      }
    },
    [currentPage, debouncedSearch, favOnly, langFilter, moodFilter, userId]
  );

  useEffect(() => {
    const shouldAnimate = hasMountedFiltersRef.current;
    hasMountedFiltersRef.current = true;
    void loadTracks(shouldAnimate);
  }, [loadTracks]);

  useEffect(() => {
    if (prevPlaylistsTickRef.current === playlistsRefreshTick) return;
    prevPlaylistsTickRef.current = playlistsRefreshTick;
    void loadTracks(false);
  }, [loadTracks, playlistsRefreshTick]);

  const handlePullOnline = useCallback(async () => {
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
    } catch (err: any) {
      Alert.alert('Bağlantı Hatası', err?.message || 'Şarkılar buluta eklenemedi.');
    } finally {
      setFetchingOnline(false);
    }
  }, [fetchingOnline, langFilter, loadTracks, moodFilter, onCatalogExpanded, search]);

  const catalogRowsRef = useRef(catalogState.rows);
  catalogRowsRef.current = catalogState.rows;
  const loadTracksRef = useRef(loadTracks);
  loadTracksRef.current = loadTracks;

  const handlePlayPagedIndex = useCallback(
    (pageIndex: number) => {
      onPlayTrack(catalogRowsRef.current, pageIndex);
    },
    [onPlayTrack]
  );

  const handleToggleFavoriteItem = useCallback(
    async (trackId: number) => {
      await onToggleFavorite(trackId);
      await loadTracksRef.current(false);
    },
    [onToggleFavorite]
  );

  const handleMoreTrackItem = useCallback(
    (item: TrackRecord) => {
      onTrackMorePress(item, null);
    },
    [onTrackMorePress]
  );

  const pageAnimKey = pageAnimTick > 0 ? `lib-${pageAnimTick}` : undefined;

  const renderTrackItem = useCallback(
    ({ item, index }: { item: TrackRecord; index: number }) => (
      <LibraryTrackItem
        item={item}
        index={index}
        animKey={pageAnimKey}
        isActiveTrack={playingTrackId === item.id}
        isPlaying={playingTrackId === item.id && isAudioPlaying}
        onPlayIndex={handlePlayPagedIndex}
        onToggleFav={handleToggleFavoriteItem}
        onMore={handleMoreTrackItem}
      />
    ),
    [
      handleMoreTrackItem,
      handlePlayPagedIndex,
      handleToggleFavoriteItem,
      isAudioPlaying,
      pageAnimKey,
      playingTrackId,
    ]
  );

  const listHeaderElement = useMemo(
    () => (
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Müzik Veritabanı</Text>
            <Text style={styles.subtitle}>
              {catalogTotal} Azure bulut şarkısı · Apple iTunes &amp; Deezer destekli
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
        </View>

        <View style={styles.searchWrap}>
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
        </View>

        <View style={styles.filterGroup}>
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
        </View>

        <View style={styles.filterGroup}>
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
        </View>

        {renderPaginationBar('top')}
      </View>
    ),
    [
      catalogTotal,
      colors.inkMuted,
      favOnly,
      fetchingOnline,
      handlePullOnline,
      langFilter,
      moodFilter,
      renderPaginationBar,
      search,
      styles,
    ]
  );

  const listEmptyElement = useMemo(
    () =>
      catalogState.hasLoaded ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Bulut kütüphanesinde aramana uygun şarkı bulunamadı. &quot;İnternetten Çek&quot; tuşuyla Azure kataloğuna anında yeni şarkılar ekleyebilirsin.
          </Text>
        </View>
      ) : undefined,
    [catalogState.hasLoaded, styles.emptyBox, styles.emptyText]
  );

  const listFooterElement = useMemo(
    () => renderPaginationBar('bottom') ?? undefined,
    [renderPaginationBar]
  );

  const handleSharePlaylist = async (pl: PlaylistRecord) => {
    Haptics.selectionAsync().catch(() => {});
    const full = pl.tracks ? pl : await getPlaylistWithTracks(pl.id, userId);
    const tracks = full?.tracks || [];
    const lines = tracks.slice(0, 20).map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`);
    try {
      await Share.share({
        message: `🎧 ${pl.name} (MoodSync)\n\n${lines.length ? lines.join('\n') : 'Henüz şarkı eklenmedi.'}`,
      });
    } catch {
      // Cancelled
    }
  };

  const handleSavePlaylistModal = async () => {
    const clean = playlistNameInput.trim();
    if (!clean) return;
    if (playlistModalMode === 'create') {
      const created = await createPlaylist({ userId, name: clean });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPlaylistModalMode(null);
      setPlaylistNameInput('');
      await loadPlaylists();
      setSelectedPlaylist(created);
    } else if (playlistModalMode === 'rename' && selectedPlaylist) {
      await renamePlaylist(selectedPlaylist.id, userId, clean);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPlaylistModalMode(null);
      setPlaylistNameInput('');
      await loadPlaylists();
      await refreshSelectedPlaylist(selectedPlaylist.id);
    }
  };

  const handleDeletePlaylist = (pl: PlaylistRecord) => {
    Alert.alert(
      'Çalma Listesini Sil',
      `“${pl.name}” listesi kalıcı olarak silinsin mi? (Şarkılar kütüphaneden silinmez.)`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await deletePlaylist(pl.id, userId);
            setSelectedPlaylist(null);
            await loadPlaylists();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          },
        },
      ]
    );
  };

  const renderPlaylistModal = () => (
    <Modal
      visible={playlistModalMode !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setPlaylistModalMode(null)}
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPlaylistModalMode(null)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {playlistModalMode === 'create' ? 'Yeni Çalma Listesi' : 'Listeyi Yeniden Adlandır'}
          </Text>
          <TextInput
            value={playlistNameInput}
            onChangeText={setPlaylistNameInput}
            placeholder="Liste adını yazın…"
            placeholderTextColor={colors.inkMuted}
            style={styles.modalInput}
            autoFocus
            maxLength={50}
          />
          <View style={styles.modalActions}>
            <SpringPressable
              onPress={() => setPlaylistModalMode(null)}
              style={styles.modalCancelBtn}
            >
              <Text style={styles.modalCancelText}>Vazgeç</Text>
            </SpringPressable>
            <SpringPressable
              haptic
              onPress={handleSavePlaylistModal}
              style={styles.modalConfirmBtn}
            >
              <Text style={styles.modalConfirmText}>Kaydet</Text>
            </SpringPressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  const showModeSwitch = !(libraryMode === 'playlists' && selectedPlaylist);

  let bodyContent: React.ReactNode;
  if (libraryMode === 'playlists') {
    if (selectedPlaylist) {
      const plTracks = selectedPlaylist.tracks || [];
      bodyContent = (
        <StaggeredEntry index={0} active={isActiveTab} distance={14} style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.plDetailNav}>
              <SpringPressable
                haptic
                onPress={() => setSelectedPlaylist(null)}
                style={styles.backPill}
              >
                <Ionicons name="chevron-back" size={17} color={colors.inkPrimary} />
                <Text style={styles.backPillText}>Listelerim</Text>
              </SpringPressable>

              <View style={styles.plDetailIcons}>
                <SpringPressable
                  haptic
                  onPress={() => {
                    setPlaylistNameInput(selectedPlaylist.name);
                    setPlaylistModalMode('rename');
                  }}
                  style={styles.iconCircleBtn}
                >
                  <Ionicons name="create-outline" size={17} color={colors.inkPrimary} />
                </SpringPressable>
                <SpringPressable
                  haptic
                  onPress={() => handleSharePlaylist(selectedPlaylist)}
                  style={styles.iconCircleBtn}
                >
                  <Ionicons name="share-outline" size={17} color={colors.inkPrimary} />
                </SpringPressable>
                <SpringPressable
                  haptic
                  onPress={() => handleDeletePlaylist(selectedPlaylist)}
                  style={[styles.iconCircleBtn, { backgroundColor: colors.dangerSoft }]}
                >
                  <Ionicons name="trash-outline" size={17} color={colors.danger} />
                </SpringPressable>
              </View>
            </View>

            <View style={styles.plHeroCard}>
              <View style={styles.plHeroMeta}>
                <Text style={styles.plHeroTitle}>{selectedPlaylist.name}</Text>
                <Text style={styles.plHeroSub}>{plTracks.length} şarkı · Kişisel Çalma Listesi</Text>
              </View>
              {plTracks.length > 0 && (
                <SpringPressable
                  haptic
                  onPress={() => onPlayTrack(plTracks, 0)}
                  style={styles.playAllBtn}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                  <Text style={styles.playAllText}>Tümünü Çal</Text>
                </SpringPressable>
              )}
            </View>

            {plTracks.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>
                  Bu liste henüz boş. Herhangi bir şarkının yanındaki “•••” butonundan bu listeye şarkı ekleyebilirsin.
                </Text>
              </View>
            ) : (
              plTracks.map((item, idx) => (
                <TrackRow
                  key={`${selectedPlaylist.id}-${item.id}`}
                  track={item}
                  index={idx}
                  isActiveTrack={playingTrackId === item.id}
                  isPlaying={playingTrackId === item.id && isAudioPlaying}
                  onPlayPress={() => onPlayTrack(plTracks, idx)}
                  onToggleFavorite={async () => {
                    await onToggleFavorite(item.id);
                    await refreshSelectedPlaylist(selectedPlaylist.id);
                  }}
                  onMorePress={() => onTrackMorePress(item, selectedPlaylist)}
                />
              ))
            )}
          </ScrollView>
        </StaggeredEntry>
      );
    } else {
      bodyContent = (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.contentAfterToggle}
          showsVerticalScrollIndicator={false}
        >
          <StaggeredEntry index={1} active={isActiveTab} style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Çalma Listelerim</Text>
              <Text style={styles.subtitle}>
                Taramalarından veya favori şarkılarından oluşturduğun özel listeler.
              </Text>
            </View>
            <SpringPressable
              haptic
              onPress={() => {
                setPlaylistNameInput('');
                setPlaylistModalMode('create');
              }}
              style={styles.onlineFetchBtn}
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.onlineFetchText}>Yeni Liste</Text>
            </SpringPressable>
          </StaggeredEntry>

          {playlists.length === 0 ? (
            <StaggeredEntry index={2} active={isActiveTab} style={styles.emptyBox}>
              <Ionicons name="albums-outline" size={32} color={colors.inkMuted} />
              <Text style={styles.emptyTitle}>Henüz özel çalma listen yok</Text>
              <Text style={styles.emptyText}>
                Yeni liste oluşturabilir veya tarama sonuçlarındaki “Çalma Listesi Yap” tuşuyla tek dokunuşta liste kaydedebilirsin.
              </Text>
            </StaggeredEntry>
          ) : (
            <View style={{ gap: 10 }}>
              {playlists.map((pl, idx) => {
                const accent = pl.colorHex || colors.brand;
                return (
                  <StaggeredEntry
                    key={pl.id}
                    index={Math.min(idx + 2, 6)}
                    active={isActiveTab}
                    enabled={idx < 6}
                  >
                    <SpringPressable
                      haptic
                      scaleTo={0.985}
                      onPress={async () => {
                        const full = await getPlaylistWithTracks(pl.id, userId);
                        if (full) setSelectedPlaylist(full);
                      }}
                      style={styles.plCard}
                    >
                      {pl.coverArtworks.length >= 4 ? (
                        <View style={styles.mosaicWrap}>
                          {pl.coverArtworks.slice(0, 4).map((uri, i) => (
                            <Image key={i} source={{ uri }} style={styles.mosaicTile} />
                          ))}
                        </View>
                      ) : pl.coverArtworks[0] ? (
                        <Image source={{ uri: pl.coverArtworks[0] }} style={styles.plSingleCover} />
                      ) : (
                        <View style={[styles.plSingleCover, { backgroundColor: `${accent}24` }]}>
                          <Ionicons name="musical-notes" size={24} color={accent} />
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.plCardTitle}>
                          {pl.name}
                        </Text>
                        <Text style={styles.plCardMeta}>{pl.trackCount} şarkı</Text>
                      </View>

                      <SpringPressable
                        haptic
                        onPress={(e) => {
                          e.stopPropagation?.();
                          handleSharePlaylist(pl);
                        }}
                        style={styles.iconCircleBtn}
                      >
                        <Ionicons name="share-outline" size={16} color={colors.inkSecondary} />
                      </SpringPressable>
                      <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
                    </SpringPressable>
                  </StaggeredEntry>
                );
              })}
            </View>
          )}
        </ScrollView>
      );
    }
  } else {
    bodyContent = (
      <StaggeredEntry index={1} active={isActiveTab} distance={16} style={{ flex: 1 }}>
        <FlatList
          ref={songsListRef}
          data={pagedRows}
          keyExtractor={keyExtractorTrack}
          getItemLayout={getTrackItemLayout}
          contentContainerStyle={styles.contentAfterToggle}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={5}
          updateCellsBatchingPeriod={30}
          ListHeaderComponent={listHeaderElement}
          ListEmptyComponent={listEmptyElement}
          ListFooterComponent={listFooterElement}
          renderItem={renderTrackItem}
        />
      </StaggeredEntry>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {showModeSwitch && (
        <StaggeredEntry
          index={0}
          active={isActiveTab}
          distance={12}
          style={styles.modeSwitchTopBar}
        >
          <AnimatedSegmentedControl<'songs' | 'playlists'>
            value={libraryMode}
            onChange={setLibraryMode}
            options={[
              { key: 'songs', label: 'Şarkılar' },
              { key: 'playlists', label: 'Listelerim', badge: playlists.length },
            ]}
          />
        </StaggeredEntry>
      )}
      {bodyContent}
      {renderPlaylistModal()}
    </View>
  );
});

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 150,
    },
    contentAfterToggle: {
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 150,
    },
    modeSwitchTopBar: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    modeSwitchWrap: {
      marginBottom: 14,
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
    paginationContainer: {
      gap: 8,
    },
    paginationTop: {
      marginTop: 4,
      marginBottom: 2,
    },
    paginationBottom: {
      marginTop: 12,
      marginBottom: 8,
    },
    paginationMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 2,
    },
    paginationPageLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    paginationRangeLabel: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.inkMuted,
    },
    paginationControlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    pageNumbersScroller: {
      flex: 1,
    },
    pageNumbersScroll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 2,
    },
    pageArrowBtn: {
      width: 34,
      height: 34,
      borderRadius: 11,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageArrowBtnDisabled: {
      opacity: 0.4,
    },
    pageNumBtn: {
      minWidth: 34,
      height: 34,
      paddingHorizontal: 10,
      borderRadius: 11,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageNumBtnActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    pageNumText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    pageNumTextActive: {
      color: '#FFFFFF',
      fontWeight: '800',
    },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 22,
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    emptyTitle: {
      fontSize: 15.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    emptyText: {
      fontSize: 13,
      color: colors.inkSecondary,
      textAlign: 'center',
      lineHeight: 19,
    },
    plCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    mosaicWrap: {
      width: 56,
      height: 56,
      borderRadius: 13,
      overflow: 'hidden',
      flexDirection: 'row',
      flexWrap: 'wrap',
      backgroundColor: colors.subtle,
    },
    mosaicTile: {
      width: 28,
      height: 28,
    },
    plSingleCover: {
      width: 56,
      height: 56,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.subtle,
    },
    plCardTitle: {
      fontSize: 15.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    plCardMeta: {
      marginTop: 2,
      fontSize: 12.5,
      color: colors.inkSecondary,
    },
    iconCircleBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    plDetailNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    backPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: 11,
      paddingVertical: 8,
      borderRadius: 999,
    },
    backPillText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    plDetailIcons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    plHeroCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    plHeroMeta: {
      flex: 1,
    },
    plHeroTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    plHeroSub: {
      marginTop: 3,
      fontSize: 12.5,
      color: colors.inkSecondary,
    },
    playAllBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brand,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 12,
    },
    playAllText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.62)',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      gap: 12,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    modalInput: {
      height: 46,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      backgroundColor: colors.elevated,
      paddingHorizontal: 12,
      fontSize: 14.5,
      color: colors.inkPrimary,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
    },
    modalCancelBtn: {
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    modalCancelText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    modalConfirmBtn: {
      backgroundColor: colors.brand,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 11,
    },
    modalConfirmText: {
      fontSize: 13.5,
      fontWeight: '800',
      color: '#FFFFFF',
    },
  });
