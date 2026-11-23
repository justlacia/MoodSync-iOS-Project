import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { JOURNAL_QUICK_TAGS, ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { SpringPressable } from './MotionPrimitives';

interface Props {
  initialNote?: string;
  initialTags?: string[];
  compact?: boolean;
  onSave: (note: string, tags: string[]) => Promise<void>;
}

export const ScanJournalCard: React.FC<Props> = ({
  initialNote = '',
  initialTags = [],
  compact = false,
  onSave,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [expanded, setExpanded] = useState(!compact);
  const [note, setNote] = useState(initialNote);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNote(initialNote || '');
    setTags(Array.isArray(initialTags) ? initialTags : []);
    setSavedToast(false);
  }, [initialNote, initialTags]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const flashSaved = () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setSavedToast(true);
    toastTimerRef.current = setTimeout(() => setSavedToast(false), 2200);
  };

  const persist = async (nextNote: string, nextTags: string[]) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(nextNote.trim(), nextTags);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      flashSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTag = (tag: string) => {
    Haptics.selectionAsync().catch(() => {});
    const exists = tags.includes(tag);
    const nextTags = exists ? tags.filter((t) => t !== tag) : [...tags, tag];
    setTags(nextTags);
    void persist(note, nextTags);
  };

  const hasNoteChanges = note.trim() !== (initialNote || '').trim();
  const hasAnyContent = Boolean(note.trim() || tags.length > 0);

  if (compact && !expanded) {
    return (
      <SpringPressable
        haptic
        onPress={() => setExpanded(true)}
        style={styles.collapsedCard}
      >
        <View style={styles.collapsedLeft}>
          <View style={styles.journalIconWrap}>
            <Ionicons name="journal-outline" size={16} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.collapsedTitle}>
              {hasAnyContent ? 'Duygu Günlüğü' : 'Bu Ana Not & Etiket Ekle'}
            </Text>
            <Text numberOfLines={1} style={styles.collapsedSub}>
              {tags.length > 0 ? tags.map((t) => `#${t}`).join(' · ') : ''}
              {tags.length > 0 && note.trim() ? ' — ' : ''}
              {note.trim() || (tags.length === 0 ? 'Kahve, İş, Spor gibi etiketler ve kısa bir not ekle' : '')}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-down" size={16} color={colors.inkMuted} />
      </SpringPressable>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons name="journal-outline" size={15} color={colors.brand} />
          <Text style={styles.sectionTitle}>DUYGU GÜNLÜĞÜ &amp; ETİKETLER</Text>
        </View>
        <View style={styles.headerRight}>
          {savedToast && (
            <View style={styles.savedPill}>
              <Ionicons name="checkmark" size={12} color={colors.moodNeutral} />
              <Text style={styles.savedPillText}>Kaydedildi</Text>
            </View>
          )}
          {compact && (
            <SpringPressable haptic onPress={() => setExpanded(false)} hitSlop={8}>
              <Ionicons name="chevron-up" size={17} color={colors.inkMuted} />
            </SpringPressable>
          )}
        </View>
      </View>

      <View style={styles.tagsWrap}>
        {JOURNAL_QUICK_TAGS.map((tag) => {
          const active = tags.includes(tag);
          return (
            <SpringPressable
              key={tag}
              haptic
              onPress={() => handleToggleTag(tag)}
              style={[styles.tagChip, active && styles.tagChipActive]}
            >
              <Text style={[styles.tagText, active && styles.tagTextActive]}>#{tag}</Text>
            </SpringPressable>
          );
        })}
      </View>

      <View style={styles.inputWrap}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Bu an nasıl hissettirdi? Kısa bir günlük notu bırak…"
          placeholderTextColor={colors.inkMuted}
          multiline
          maxLength={280}
          style={styles.textInput}
        />
        <View style={styles.inputFooter}>
          <Text style={styles.charCount}>{note.length}/280</Text>
          <SpringPressable
            haptic
            disabled={saving || !hasNoteChanges}
            onPress={() => persist(note, tags)}
            style={[
              styles.saveBtn,
              (!hasNoteChanges || saving) && styles.saveBtnDisabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                <Text style={styles.saveBtnText}>Notu Kaydet</Text>
              </>
            )}
          </SpringPressable>
        </View>
      </View>
    </View>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    collapsedCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.elevated,
      borderRadius: 15,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 12,
      gap: 10,
    },
    collapsedLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    journalIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: colors.brandSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    collapsedTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    collapsedSub: {
      marginTop: 1,
      fontSize: 11.5,
      color: colors.inkMuted,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 12,
      gap: 10,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sectionTitle: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.7,
      color: colors.inkMuted,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    savedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.moodNeutralSoft,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    savedPillText: {
      fontSize: 10.5,
      fontWeight: '800',
      color: colors.moodNeutral,
    },
    tagsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    tagChip: {
      paddingHorizontal: 10,
      paddingVertical: 5.5,
      borderRadius: 999,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    tagChipActive: {
      backgroundColor: colors.brandSoft,
      borderColor: colors.brand,
    },
    tagText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    tagTextActive: {
      color: colors.brand,
      fontWeight: '800',
    },
    inputWrap: {
      backgroundColor: colors.elevated,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      padding: 11,
    },
    textInput: {
      minHeight: 56,
      maxHeight: 110,
      fontSize: 13.5,
      color: colors.inkPrimary,
      textAlignVertical: 'top',
    },
    inputFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    charCount: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.inkMuted,
    },
    saveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.brand,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
    },
    saveBtnDisabled: {
      opacity: 0.45,
    },
    saveBtnText: {
      fontSize: 12,
      fontWeight: '800',
      color: '#FFFFFF',
    },
  });
