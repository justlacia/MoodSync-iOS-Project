import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  ALL_EMOTIONS,
  EmotionScores,
  emotionToMood,
  EmotionType,
  MoodStrategy,
  MoodType,
  resolveMoodVisual,
  resolveTargetMoodForStrategy,
  ThemePalette,
} from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { AnimatedSegmentedControl, SpringPressable } from './MotionPrimitives';

interface Props {
  mood: MoodType;
  emotion?: EmotionType | null;
  emotionScores?: EmotionScores | null;
  strategy: MoodStrategy;
  isManualOverride?: boolean;
  updating?: boolean;
  onChangeStrategy: (next: MoodStrategy) => void;
  onChangeEmotion: (next: EmotionType) => void;
}

export const EmotionBreakdownCard: React.FC<Props> = ({
  mood,
  emotion,
  emotionScores,
  strategy,
  isManualOverride = false,
  updating = false,
  onChangeStrategy,
  onChangeEmotion,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const activeEmotion: EmotionType =
    emotion && ALL_EMOTIONS.includes(emotion)
      ? emotion
      : mood === 'positive'
        ? 'happy'
        : mood === 'negative'
          ? 'sad'
          : 'neutral';

  const strategyInfo = resolveTargetMoodForStrategy(activeEmotion, mood, strategy);

  const rankedScores = useMemo(() => {
    if (!emotionScores) return [];
    const entries = ALL_EMOTIONS.map((em) => ({
      emotion: em,
      score: Math.max(0, Number(emotionScores[em] ?? 0)),
    }))
      .filter((item) => item.score > 0.02)
      .sort((a, b) => b.score - a.score);

    const total = entries.reduce((acc, item) => acc + item.score, 0) || 1;
    return entries.slice(0, 4).map((item) => ({
      ...item,
      pct: Math.max(1, Math.round((item.score / total) * 100)),
      visual: resolveMoodVisual(emotionToMood(item.emotion), item.emotion, colors),
    }));
  }, [colors, emotionScores]);

  return (
    <View style={styles.container}>
      {/* Strategy Toggle: Match vs Uplift */}
      <View style={styles.strategyRow}>
        <AnimatedSegmentedControl<MoodStrategy>
          compact
          value={strategy}
          onChange={(next) => {
            if (updating) return;
            onChangeStrategy(next);
          }}
          options={[
            { key: 'match', label: 'Moduma Eşlik Et' },
            { key: 'uplift', label: 'Modumu Yükselt' },
          ]}
          style={{ flex: 1 }}
        />
        {updating && <ActivityIndicator size="small" color={colors.brand} style={{ marginLeft: 8 }} />}
      </View>

      <Text style={styles.strategyHint}>{strategyInfo.descriptionTr}</Text>

      {/* Multi-Emotion Distribution Bar */}
      {rankedScores.length > 0 && (
        <View style={styles.breakdownWrap}>
          <View style={styles.barTrack}>
            {rankedScores.map((item) => (
              <View
                key={item.emotion}
                style={[
                  styles.barSegment,
                  {
                    flex: item.score,
                    backgroundColor: item.visual.dotColor,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.legendRow}>
            {rankedScores.slice(0, 3).map((item) => (
              <View key={item.emotion} style={styles.legendChip}>
                <View style={[styles.legendDot, { backgroundColor: item.visual.dotColor }]} />
                <Text style={styles.legendText}>
                  {item.visual.shortTr} %{item.pct}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Manual Emotion Correction */}
      <View style={styles.correctionHeader}>
        <View style={styles.correctionLabelRow}>
          <Ionicons name="sparkles-outline" size={13} color={colors.inkMuted} />
          <Text style={styles.correctionLabel}>
            {isManualOverride ? 'Duygu manuel güncellendi' : 'AI tahmini farklı mı?'}
          </Text>
          {isManualOverride && (
            <View style={styles.manualBadge}>
              <Text style={styles.manualBadgeText}>Manuel</Text>
            </View>
          )}
        </View>

        <SpringPressable
          haptic
          onPress={() => setPickerOpen((v) => !v)}
          style={styles.adjustBtn}
        >
          <Ionicons
            name={pickerOpen ? 'chevron-up' : 'options-outline'}
            size={13}
            color={colors.brand}
          />
          <Text style={styles.adjustBtnText}>
            {pickerOpen ? 'Gizle' : 'Duyguyu Düzelt'}
          </Text>
        </SpringPressable>
      </View>

      {pickerOpen && (
        <View style={styles.emotionChipsWrap}>
          {ALL_EMOTIONS.map((em) => {
            const selected = em === activeEmotion;
            const v = resolveMoodVisual(emotionToMood(em), em, colors);
            return (
              <SpringPressable
                key={em}
                haptic
                disabled={updating}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setPickerOpen(false);
                  if (em !== activeEmotion) {
                    onChangeEmotion(em);
                  }
                }}
                style={[
                  styles.emotionChip,
                  selected && {
                    backgroundColor: v.softColor,
                    borderColor: v.dotColor,
                  },
                ]}
              >
                <View style={[styles.emotionChipDot, { backgroundColor: v.dotColor }]} />
                <Text
                  style={[
                    styles.emotionChipText,
                    selected && { color: v.color, fontWeight: '800' },
                  ]}
                >
                  {v.shortTr}
                </Text>
              </SpringPressable>
            );
          })}
        </View>
      )}
    </View>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    container: {
      backgroundColor: colors.elevated,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: 12,
      gap: 9,
    },
    strategyRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    strategyHint: {
      fontSize: 12,
      color: colors.inkSecondary,
      lineHeight: 17,
    },
    breakdownWrap: {
      gap: 7,
    },
    barTrack: {
      height: 7,
      borderRadius: 999,
      overflow: 'hidden',
      flexDirection: 'row',
      gap: 2,
      backgroundColor: colors.subtle,
    },
    barSegment: {
      height: '100%',
      borderRadius: 999,
    },
    legendRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    legendChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    legendDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
    },
    legendText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.inkSecondary,
    },
    correctionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      gap: 8,
    },
    correctionLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      flex: 1,
    },
    correctionLabel: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.inkMuted,
    },
    manualBadge: {
      backgroundColor: colors.brandSoft,
      paddingHorizontal: 6,
      paddingVertical: 1.5,
      borderRadius: 999,
    },
    manualBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.brand,
    },
    adjustBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.brandSoft,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
    },
    adjustBtnText: {
      fontSize: 11.5,
      fontWeight: '800',
      color: colors.brand,
    },
    emotionChipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      paddingTop: 2,
    },
    emotionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    emotionChipDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    emotionChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.inkPrimary,
    },
  });
