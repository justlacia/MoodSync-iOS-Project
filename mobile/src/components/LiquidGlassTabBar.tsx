import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  NativeMoodSyncLiquidTabBar,
  NativeTabItemConfig,
} from '../../modules/moodsync-vision';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { LiquidGlassSurface } from './LiquidGlassSurface';

export type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

export interface LiquidGlassTabItem<T extends string> {
  key: T;
  label: string;
  icon: IoniconsName;
  activeIcon: IoniconsName;
  sfSymbol?: string;
  activeSfSymbol?: string;
  showBadgeDot?: boolean;
}

interface LiquidGlassTabBarProps<T extends string> {
  tabs: ReadonlyArray<LiquidGlassTabItem<T>>;
  activeTab: T;
  onSelectTab: (tab: T) => void;
}

function LiquidGlassTabBarInner<T extends string>({
  tabs,
  activeTab,
  onSelectTab,
}: LiquidGlassTabBarProps<T>) {
  const { colors, isDark } = useTheme();

  const nativeTabs = useMemo<NativeTabItemConfig[]>(
    () =>
      tabs.map((t) => ({
        key: t.key,
        label: t.label,
        sfSymbol: t.sfSymbol || 'circle',
        activeSfSymbol: t.activeSfSymbol || t.sfSymbol || 'circle.fill',
        showBadgeDot: Boolean(t.showBadgeDot),
      })),
    [tabs]
  );

  const handleNativeSelectTab = useCallback(
    (e: { nativeEvent?: { key?: string } }) => {
      const selectedKey = e?.nativeEvent?.key as T | undefined;
      if (selectedKey) {
        onSelectTab(selectedKey);
      }
    },
    [onSelectTab]
  );

  if (NativeMoodSyncLiquidTabBar) {
    return (
      <View style={nativeWrapperStyles.outer} pointerEvents="box-none">
        <NativeMoodSyncLiquidTabBar
          tabs={nativeTabs}
          activeTab={activeTab}
          isDark={isDark}
          accentColor={colors.brand}
          onSelectTab={handleNativeSelectTab}
          style={nativeWrapperStyles.nativeBar}
        />
      </View>
    );
  }

  return (
    <JsFallbackLiquidTabBar
      tabs={tabs}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
    />
  );
}

export const LiquidGlassTabBar = React.memo(
  LiquidGlassTabBarInner
) as typeof LiquidGlassTabBarInner;

const nativeWrapperStyles = StyleSheet.create({
  outer: {
    width: '100%',
    alignItems: 'center',
    overflow: 'visible',
  },
  nativeBar: {
    width: '100%',
    height: 84,
    marginBottom: -9,
  },
});

const CAPSULE_HEIGHT = 60;
const PILL_INSET = 4;
const REST_PILL_HEIGHT = 49;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function stepSpring(
  val: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number
): [number, number] {
  const acc = stiffness * (target - val) - damping * vel;
  const nextVel = vel + acc * dt;
  const nextVal = val + nextVel * dt;
  return [nextVal, nextVel];
}

function JsFallbackLiquidTabBar<T extends string>({
  tabs,
  activeTab,
  onSelectTab,
}: LiquidGlassTabBarProps<T>) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const activeIdx = Math.max(
    0,
    tabs.findIndex((t) => t.key === activeTab)
  );

  const [capsuleWidth, setCapsuleWidth] = useState(0);

  const slotWidth =
    capsuleWidth > PILL_INSET * 2 && tabs.length > 0
      ? (capsuleWidth - PILL_INSET * 2) / tabs.length
      : 0;

  const pillX = useRef(new Animated.Value(0)).current;
  const bubbleScaleY = useRef(new Animated.Value(1)).current;
  const bubbleScaleX = useRef(new Animated.Value(1)).current;
  const lensProgress = useRef(new Animated.Value(0)).current;
  const barShiftX = useRef(new Animated.Value(0)).current;
  const shimmerX = useRef(new Animated.Value(0)).current;

  const negPillX = useMemo(() => Animated.multiply(pillX, -1), [pillX]);

  const phys = useRef({
    pos: 0,
    vel: 0,
    sx: 1,
    vsx: 0,
    sy: 1,
    vsy: 0,
    lp: 0,
    vlp: 0,
    bx: 0,
    vbx: 0,
    isPressed: false,
    hasDragged: false,
    touchStartX: 0,
    tapIdx: activeIdx,
    fingerX: 0,
    restTargetIdx: activeIdx,
    lastCrossedIdx: activeIdx,
    leapUntil: 0,
    lastFrameTime: 0,
    rafId: null as number | null,
  }).current;

  const hasMeasuredRef = useRef(false);
  const lastCommittedTabRef = useRef<T>(activeTab);

  const slotWidthRef = useRef(slotWidth);
  slotWidthRef.current = slotWidth;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;
  const grantXRef = useRef(0);
  const onSelectTabRef = useRef(onSelectTab);
  onSelectTabRef.current = onSelectTab;

  const stopPhysicsLoop = useCallback(() => {
    if (phys.rafId !== null) {
      cancelAnimationFrame(phys.rafId);
      phys.rafId = null;
    }
  }, [phys]);

  const tickPhysics = useCallback(
    (now: number) => {
      const sw = slotWidthRef.current;
      const count = tabsRef.current.length;
      if (sw <= 0 || count === 0) {
        phys.rafId = null;
        return;
      }

      const dt =
        phys.lastFrameTime > 0 ? clamp((now - phys.lastFrameTime) / 1000, 0.004, 0.032) : 0.016;
      phys.lastFrameTime = now;

      const maxTrack = Math.max(0, (count - 1) * sw);

      let clampedFingerX = phys.fingerX;
      if (phys.fingerX < 0) {
        clampedFingerX = phys.fingerX * 0.22;
      } else if (phys.fingerX > maxTrack) {
        clampedFingerX = maxTrack + (phys.fingerX - maxTrack) * 0.22;
      }

      let effectiveTargetX = phys.restTargetIdx * sw;
      if (phys.isPressed) {
        if (count > 1) {
          const u = clamp(clampedFingerX, 0, maxTrack) / sw;
          const delta = u - Math.round(u);
          const detentPull = 0.06 * sw * Math.sin(2 * Math.PI * delta);
          effectiveTargetX = clampedFingerX - detentPull;
        } else {
          effectiveTargetX = clampedFingerX;
        }
      }

      if (phys.isPressed && phys.hasDragged) {
        const halfDt = dt * 0.5;
        [phys.pos, phys.vel] = stepSpring(phys.pos, phys.vel, effectiveTargetX, 620, 45, halfDt);
        [phys.pos, phys.vel] = stepSpring(phys.pos, phys.vel, effectiveTargetX, 620, 45, halfDt);
      } else {
        const posStiffness = phys.isPressed ? 115 : 260;
        const posDamping = phys.isPressed ? 18.5 : 26.5;
        [phys.pos, phys.vel] = stepSpring(
          phys.pos,
          phys.vel,
          effectiveTargetX,
          posStiffness,
          posDamping,
          dt
        );
      }
      if (!phys.isPressed) {
        phys.pos = clamp(phys.pos, -4, maxTrack + 4);
      }

      const tension = phys.isPressed ? clampedFingerX - phys.pos : 0;
      const speed = Math.abs(phys.vel);
      const isLeaping = !phys.isPressed && now < phys.leapUntil;

      let targetLP = 0;
      let targetSX = 1;
      let targetSY = 1;
      let targetBX = 0;

      if (phys.isPressed) {
        const wobble = Math.sin(now * 0.0084) * 0.034;
        const stretch = clamp(
          (Math.abs(tension) / Math.max(1, sw * 0.6)) * 0.16 + (speed / 1400) * 0.12,
          0,
          0.22
        );
        targetLP = 1;
        targetSX = 1.18 + wobble + stretch;
        targetSY = 1.35 - wobble - stretch * 0.35;
        targetBX = clamp(tension * 0.11, -7, 7);
      } else if (isLeaping) {
        targetLP = 0.88;
        targetSX = 1.15;
        targetSY = 1.26;
      }

      [phys.sx, phys.vsx] = stepSpring(phys.sx, phys.vsx, targetSX, 310, 10.8, dt);
      [phys.sy, phys.vsy] = stepSpring(phys.sy, phys.vsy, targetSY, 310, 10.8, dt);
      [phys.lp, phys.vlp] = stepSpring(phys.lp, phys.vlp, targetLP, 250, 18, dt);
      [phys.bx, phys.vbx] = stepSpring(phys.bx, phys.vbx, targetBX, 225, 14, dt);

      pillX.setValue(phys.pos);
      bubbleScaleX.setValue(phys.sx);
      bubbleScaleY.setValue(phys.sy);
      lensProgress.setValue(clamp(phys.lp, 0, 1));
      barShiftX.setValue(phys.bx);
      shimmerX.setValue(clamp(phys.vel / 100, -14, 14));

      if (phys.isPressed) {
        const crossed = clamp(Math.round(clamp(phys.pos, 0, maxTrack) / sw), 0, count - 1);
        if (crossed !== phys.lastCrossedIdx) {
          phys.lastCrossedIdx = crossed;
          Haptics.selectionAsync().catch(() => {});
          phys.vsx -= 2.1;
          phys.vsy += 2.8;
        }
      }

      const settled =
        !phys.isPressed &&
        !isLeaping &&
        Math.abs(phys.pos - effectiveTargetX) < 0.08 &&
        Math.abs(phys.vel) < 0.4 &&
        Math.abs(phys.sx - 1) < 0.001 &&
        Math.abs(phys.vsx) < 0.01 &&
        Math.abs(phys.sy - 1) < 0.001 &&
        Math.abs(phys.vsy) < 0.01 &&
        Math.abs(phys.lp) < 0.004 &&
        Math.abs(phys.vlp) < 0.01 &&
        Math.abs(phys.bx) < 0.05 &&
        Math.abs(phys.vbx) < 0.2;

      if (settled) {
        phys.pos = effectiveTargetX;
        phys.vel = 0;
        phys.sx = 1;
        phys.vsx = 0;
        phys.sy = 1;
        phys.vsy = 0;
        phys.lp = 0;
        phys.vlp = 0;
        phys.bx = 0;
        phys.vbx = 0;

        pillX.setValue(effectiveTargetX);
        bubbleScaleX.setValue(1);
        bubbleScaleY.setValue(1);
        lensProgress.setValue(0);
        barShiftX.setValue(0);
        shimmerX.setValue(0);

        phys.rafId = null;
        return;
      }

      phys.rafId = requestAnimationFrame(tickPhysics);
    },
    [barShiftX, bubbleScaleX, bubbleScaleY, lensProgress, phys, pillX, shimmerX]
  );

  const ensurePhysicsRunning = useCallback(() => {
    if (phys.rafId === null) {
      phys.lastFrameTime = 0;
      phys.rafId = requestAnimationFrame(tickPhysics);
    }
  }, [phys, tickPhysics]);

  useEffect(() => {
    return () => stopPhysicsLoop();
  }, [stopPhysicsLoop]);

  useEffect(() => {
    if (slotWidth <= 0) return;
    const targetX = activeIdx * slotWidth;

    if (!hasMeasuredRef.current) {
      hasMeasuredRef.current = true;
      lastCommittedTabRef.current = activeTab;
      phys.pos = targetX;
      phys.restTargetIdx = activeIdx;
      phys.lastCrossedIdx = activeIdx;
      pillX.setValue(targetX);
      return;
    }

    if (phys.isPressed) return;

    const changedProgrammatically = lastCommittedTabRef.current !== activeTab;
    lastCommittedTabRef.current = activeTab;

    if (phys.restTargetIdx !== activeIdx) {
      phys.restTargetIdx = activeIdx;
      phys.lastCrossedIdx = activeIdx;
      if (changedProgrammatically) {
        phys.leapUntil = performance.now() + 280;
        phys.vsx += 1.4;
        phys.vsy += 1.8;
      }
      ensurePhysicsRunning();
    }
  }, [activeIdx, activeTab, ensurePhysicsRunning, phys, pillX, slotWidth]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt) => {
        const sw = slotWidthRef.current;
        const count = tabsRef.current.length;
        if (sw <= 0 || count === 0) return;

        const localX = evt.nativeEvent.locationX;
        grantXRef.current = localX;

        const rawTarget = localX - PILL_INSET - sw / 2;
        const idx = clamp(Math.floor((localX - PILL_INSET) / sw), 0, count - 1);

        phys.isPressed = true;
        phys.hasDragged = false;
        phys.touchStartX = localX;
        phys.tapIdx = idx;
        phys.fingerX = rawTarget;
        phys.leapUntil = 0;
        phys.vsx += 2.2;
        phys.vsy += 3.0;

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        ensurePhysicsRunning();
      },

      onPanResponderMove: (_, gs) => {
        const sw = slotWidthRef.current;
        const count = tabsRef.current.length;
        if (sw <= 0 || count === 0) return;

        if (Math.abs(gs.dx) > 8) {
          phys.hasDragged = true;
        }
        const touchX = grantXRef.current + gs.dx;
        phys.fingerX = touchX - PILL_INSET - sw / 2;
        ensurePhysicsRunning();
      },

      onPanResponderRelease: () => {
        const sw = slotWidthRef.current;
        const list = tabsRef.current;
        const count = list.length;
        const maxTrack = Math.max(0, (count - 1) * sw);

        const finalIdx = !phys.hasDragged
          ? phys.tapIdx
          : sw > 0
            ? clamp(
                Math.round((phys.pos * 0.65 + clamp(phys.fingerX, 0, maxTrack) * 0.35) / sw),
                0,
                Math.max(0, count - 1)
              )
            : activeIdxRef.current;

        phys.isPressed = false;
        phys.restTargetIdx = finalIdx;
        phys.lastCrossedIdx = finalIdx;
        if (!phys.hasDragged) {
          phys.leapUntil = performance.now() + 280;
          phys.vsx += 1.4;
          phys.vsy += 1.8;
        } else {
          phys.vsx += 1.2;
          phys.vsy -= 1.4;
        }

        const selected = list[finalIdx];
        if (selected) {
          lastCommittedTabRef.current = selected.key;
          onSelectTabRef.current(selected.key);
        }
        ensurePhysicsRunning();
      },

      onPanResponderTerminate: () => {
        phys.isPressed = false;
        phys.restTargetIdx = activeIdxRef.current;
        ensurePhysicsRunning();
      },
    })
  ).current;

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== capsuleWidth) {
      setCapsuleWidth(w);
    }
  };

  const singleBubbleTint = lensProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const rimOpacity = lensProgress.interpolate({
    inputRange: [0, 0.1, 1],
    outputRange: [0, 0.85, 1],
  });

  const unselectedIconColor = isDark
    ? 'rgba(255, 255, 255, 0.92)'
    : colors.inkPrimary;
  const unselectedLabelColor = isDark
    ? 'rgba(255, 255, 255, 0.82)'
    : colors.inkSecondary;

  return (
    <View style={styles.outerWrap} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.capsule,
          { transform: [{ translateX: barShiftX }] },
        ]}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <LiquidGlassSurface
          glassStyle="regular"
          capsule
          interactive
          isDark={isDark}
          showShadow={false}
        />

        {/* Unselected Tab Row */}
        <View style={styles.tabsRow} pointerEvents="none">
          {tabs.map((tab) => (
            <View key={tab.key} style={styles.tabSlot}>
              <View style={{ position: 'relative' }}>
                <Ionicons name={tab.icon} size={22} color={unselectedIconColor} />
                {tab.showBadgeDot && <View style={styles.badgeDot} />}
              </View>
              <Text numberOfLines={1} style={[styles.tabLabel, { color: unselectedLabelColor }]}>
                {tab.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Partial Color Reveal Mask inside Single Bubble */}
        {slotWidth > 0 && capsuleWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.partialMaskClip,
              {
                width: slotWidth,
                transform: [
                  { translateX: pillX },
                  { scaleX: bubbleScaleX },
                  { scaleY: bubbleScaleY },
                ],
              },
            ]}
          >
            <Animated.View
              style={[
                styles.counterRow,
                {
                  width: capsuleWidth - PILL_INSET * 2,
                  transform: [{ translateX: negPillX }],
                },
              ]}
            >
              {tabs.map((tab) => (
                <View key={tab.key} style={styles.tabSlot}>
                  <View style={{ position: 'relative' }}>
                    <Ionicons name={tab.activeIcon} size={22} color={colors.brand} />
                    {tab.showBadgeDot && <View style={styles.badgeDot} />}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.tabLabel, styles.tabLabelActive, { color: colors.brand }]}
                  >
                    {tab.label}
                  </Text>
                </View>
              ))}
            </Animated.View>
          </Animated.View>
        )}

        {/* Single Liquid Glass Bubble */}
        {slotWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.singleBubble,
              {
                width: slotWidth,
                transform: [
                  { translateX: pillX },
                  { scaleX: bubbleScaleX },
                  { scaleY: bubbleScaleY },
                ],
              },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                styles.restingFill,
                { opacity: singleBubbleTint },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { opacity: rimOpacity }]}
            >
              <LiquidGlassSurface
                glassStyle="clear"
                capsule
                interactive
                isDark={isDark}
                showShadow={false}
                rimHighlight
                shimmerOffset={shimmerX}
              />
            </Animated.View>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ThemePalette, isDark: boolean) =>
  StyleSheet.create({
    outerWrap: {
      paddingHorizontal: 24,
      paddingBottom: 4,
      alignItems: 'center',
      overflow: 'visible',
    },
    capsule: {
      width: '100%',
      maxWidth: 366,
      height: CAPSULE_HEIGHT,
      borderRadius: CAPSULE_HEIGHT / 2,
      position: 'relative',
      overflow: 'visible',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: isDark ? 0.52 : 0.15,
      shadowRadius: 24,
      elevation: 12,
    },
    tabsRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: PILL_INSET,
      zIndex: 2,
    },
    tabSlot: {
      flex: 1,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2.5,
    },
    tabLabel: {
      fontSize: 10.5,
      fontWeight: '600',
      letterSpacing: -0.1,
    },
    tabLabelActive: {
      fontWeight: '700',
    },
    badgeDot: {
      position: 'absolute',
      top: -1,
      right: -3.5,
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.brand,
      borderWidth: 1.5,
      borderColor: isDark ? 'rgba(20, 22, 27, 0.9)' : '#FFFFFF',
    },
    partialMaskClip: {
      position: 'absolute',
      top: PILL_INSET,
      bottom: PILL_INSET,
      left: PILL_INSET,
      height: REST_PILL_HEIGHT,
      borderRadius: REST_PILL_HEIGHT / 2,
      overflow: 'hidden',
      zIndex: 3,
    },
    counterRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      height: '100%',
    },
    singleBubble: {
      position: 'absolute',
      top: PILL_INSET,
      bottom: PILL_INSET,
      left: PILL_INSET,
      height: REST_PILL_HEIGHT,
      borderRadius: REST_PILL_HEIGHT / 2,
      zIndex: 4,
    },
    restingFill: {
      borderRadius: REST_PILL_HEIGHT / 2,
      backgroundColor: isDark
        ? 'rgba(255, 255, 255, 0.13)'
        : 'rgba(24, 29, 37, 0.08)',
      borderWidth: 0.75,
      borderColor: isDark
        ? 'rgba(255, 255, 255, 0.16)'
        : 'rgba(255, 255, 255, 0.70)',
    },
  });
