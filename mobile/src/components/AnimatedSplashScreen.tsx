import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  onFinish: () => void;
}

export const AnimatedSplashScreen: React.FC<Props> = ({ onFinish }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const logoScale = useRef(new Animated.Value(0.68)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textTranslate = useRef(new Animated.Value(16)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const barAnims = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.8),
    new Animated.Value(1),
    new Animated.Value(0.55),
    new Animated.Value(0.4),
  ]).current;

  useEffect(() => {
    // Logo entrance spring
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 6,
        tension: 65,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 520,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 550,
        delay: 260,
        useNativeDriver: true,
      }),
      Animated.timing(textTranslate, {
        toValue: 0,
        duration: 550,
        delay: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Concentric acoustic wave ripples
    const createRipple = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 1650,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );

    const r1 = createRipple(ring1, 100);
    const r2 = createRipple(ring2, 650);
    r1.start();
    r2.start();

    // Equalizer bar loops
    const barLoops = barAnims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 380 + i * 70,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: 380 + i * 70,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      )
    );
    barLoops.forEach((l) => l.start());

    const finishTimer = setTimeout(() => {
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 420,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start(() => onFinish());
    }, 2250);

    return () => {
      clearTimeout(finishTimer);
      r1.stop();
      r2.stop();
      barLoops.forEach((l) => l.stop());
    };
  }, [barAnims, logoOpacity, logoScale, onFinish, ring1, ring2, screenOpacity, textOpacity, textTranslate]);

  return (
    <Animated.View style={[styles.overlay, { opacity: screenOpacity }]}>
      <View style={styles.centerStage}>
        <View style={styles.logoAnchor}>
          <Animated.View
            style={[
              styles.rippleRing,
              {
                borderColor: colors.brand,
                opacity: ring1.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                transform: [{ scale: ring1.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.55] }) }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.rippleRing,
              {
                borderColor: colors.moodNeutral,
                opacity: ring2.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                transform: [{ scale: ring2.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.55] }) }],
              },
            ]}
          />

          <Animated.View
            style={[
              styles.logoFrame,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <Image source={require('../../assets/logo.png')} style={styles.logoImage} />
          </Animated.View>
        </View>

        <Animated.View style={[styles.eqRow, { opacity: textOpacity }]}>
          {barAnims.map((anim, idx) => (
            <Animated.View
              key={idx}
              style={[
                styles.eqBar,
                {
                  backgroundColor:
                    idx === 1 ? colors.moodPositive : idx === 3 ? colors.moodNeutral : colors.brand,
                  transform: [{ scaleY: anim }],
                },
              ]}
            />
          ))}
        </Animated.View>

        <Animated.View
          style={{
            alignItems: 'center',
            opacity: textOpacity,
            transform: [{ translateY: textTranslate }],
          }}
        >
          <Text style={styles.brandTitle}>MoodSync</Text>
          <Text style={styles.brandTagline}>İfadeni Yakala · Ritmini Keşfet</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 999,
      backgroundColor: colors.canvas,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerStage: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoAnchor: {
      width: 144,
      height: 144,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rippleRing: {
      position: 'absolute',
      width: 132,
      height: 132,
      borderRadius: 36,
      borderWidth: 2,
    },
    logoFrame: {
      width: 122,
      height: 122,
      borderRadius: 30,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: 6,
      shadowColor: colors.brand,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: colors.isDark ? 0.25 : 0.14,
      shadowRadius: 26,
      elevation: 10,
    },
    logoImage: {
      width: '100%',
      height: '100%',
      borderRadius: 24,
    },
    eqRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 24,
      marginTop: 20,
      marginBottom: 12,
    },
    eqBar: {
      width: 4.5,
      height: 22,
      borderRadius: 3,
    },
    brandTitle: {
      fontSize: 30,
      fontWeight: '800',
      letterSpacing: -0.9,
      color: colors.inkPrimary,
    },
    brandTagline: {
      marginTop: 5,
      fontSize: 13.5,
      fontWeight: '500',
      color: colors.inkSecondary,
      letterSpacing: 0.2,
    },
  });
