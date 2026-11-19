import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface StaggeredEntryProps {
  children: React.ReactNode;
  index?: number;
  animationKey?: string | number;
  direction?: 'up' | 'down' | 'left' | 'right';
  distance?: number;
  style?: StyleProp<ViewStyle>;
}

export const StaggeredEntry: React.FC<StaggeredEntryProps> = ({
  children,
  index = 0,
  animationKey,
  direction = 'up',
  distance = 16,
  style,
}) => {
  const initialOffset =
    direction === 'down'
      ? -distance
      : direction === 'right'
        ? -distance
        : distance;

  const indexRef = useRef(index);
  indexRef.current = index;

  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(initialOffset)).current;
  const scale = useRef(new Animated.Value(0.97)).current;

  useEffect(() => {
    opacity.setValue(0);
    translate.setValue(initialOffset);
    scale.setValue(0.97);

    const delay = Math.min(indexRef.current, 12) * 45;
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(translate, {
        toValue: 0,
        delay,
        damping: 18,
        stiffness: 180,
        mass: 0.8,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        delay,
        damping: 18,
        stiffness: 185,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animationKey, initialOffset, opacity, scale, translate]);

  const isHorizontal = direction === 'left' || direction === 'right';
  const transformStyle = isHorizontal
    ? [{ translateX: translate }, { scale }]
    : [{ translateY: translate }, { scale }];

  return (
    <Animated.View style={[style, { opacity, transform: transformStyle }]}>
      {children}
    </Animated.View>
  );
};

interface SpringPressableProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  scaleTo?: number;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const SpringPressable: React.FC<SpringPressableProps> = ({
  children,
  scaleTo = 0.95,
  haptic = false,
  style,
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  ...rest
}) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: GestureResponderEvent) => {
    if (!disabled) {
      Animated.spring(scale, {
        toValue: scaleTo,
        damping: 16,
        stiffness: 320,
        mass: 0.6,
        useNativeDriver: true,
      }).start();
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    Animated.spring(scale, {
      toValue: 1,
      damping: 14,
      stiffness: 240,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
    onPressOut?.(e);
  };

  const handlePress = (e: GestureResponderEvent) => {
    if (haptic && !disabled) {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.(e);
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
};

export interface SegmentedOption<T extends string> {
  key: T;
  label: string;
  badge?: string | number;
}

interface AnimatedSegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function AnimatedSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
  compact = false,
}: AnimatedSegmentedControlProps<T>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createSegStyles(colors, compact), [colors, compact]);

  const [containerWidth, setContainerWidth] = useState(0);
  const padding = compact ? 3 : 4;
  const activeIdx = Math.max(
    0,
    options.findIndex((o) => o.key === value)
  );
  const pillWidth =
    containerWidth > padding * 2 && options.length > 0
      ? (containerWidth - padding * 2) / options.length
      : 0;

  const translateX = useRef(new Animated.Value(0)).current;
  const hasMeasured = useRef(false);

  useEffect(() => {
    if (pillWidth <= 0) return;
    const targetX = activeIdx * pillWidth;
    if (!hasMeasured.current) {
      translateX.setValue(targetX);
      hasMeasured.current = true;
      return;
    }
    Animated.spring(translateX, {
      toValue: targetX,
      damping: 20,
      stiffness: 240,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [activeIdx, pillWidth, translateX]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== containerWidth) {
      setContainerWidth(w);
    }
  };

  return (
    <View style={[styles.track, style]} onLayout={handleLayout}>
      {pillWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activePill,
            {
              width: pillWidth,
              transform: [{ translateX }],
            },
          ]}
        />
      )}
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              if (opt.key === value) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(opt.key);
            }}
            style={styles.tabBtn}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={[styles.tabLabel, active && styles.tabLabelActive]}
            >
              {opt.label}
              {opt.badge !== undefined ? ` (${opt.badge})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createSegStyles = (colors: ThemePalette, compact: boolean) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.subtle,
      borderRadius: compact ? 11 : 13,
      padding: compact ? 3 : 4,
      position: 'relative',
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    activePill: {
      position: 'absolute',
      top: compact ? 3 : 4,
      bottom: compact ? 3 : 4,
      left: compact ? 3 : 4,
      borderRadius: compact ? 8 : 9.5,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: colors.isDark ? 0.35 : 0.08,
      shadowRadius: 5,
      elevation: 2,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: compact ? 6.5 : 9,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    tabLabel: {
      fontSize: compact ? 11.5 : 13,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    tabLabelActive: {
      color: colors.inkPrimary,
      fontWeight: '800',
    },
  });

interface AnimatedProgressBarProps {
  ratio: number;
  color: string;
  trackColor: string;
  height?: number;
  delay?: number;
}

export const AnimatedProgressBar: React.FC<AnimatedProgressBarProps> = ({
  ratio,
  color,
  trackColor,
  height = 7,
  delay = 80,
}) => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: clamped,
      duration: 620,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [anim, clamped, delay]);

  const widthInterpolate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: trackColor,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: color,
          width: widthInterpolate,
        }}
      />
    </View>
  );
};

interface PulseDotProps {
  color: string;
  size?: number;
}

export const PulseDot: React.FC<PulseDotProps> = ({ color, size = 8 }) => {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View
      style={{
        width: size * 2.1,
        height: size * 2.1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.65, 0],
          }),
          transform: [
            {
              scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 2.3],
              }),
            },
          ],
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
};
