import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AnimatedSegmentedControl,
  SpringPressable,
  StaggeredEntry,
} from '../components/MotionPrimitives';
import { loginUser, registerUser, UserRecord } from '../database/iosDatabase';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  onAuthenticated: (user: UserRecord) => void;
}

export const LoginScreen: React.FC<Props> = ({ onAuthenticated }) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(20)).current;
  const logoScale = useRef(new Animated.Value(0.75)).current;
  const errorShake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(cardY, {
        toValue: 0,
        damping: 18,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        damping: 12,
        stiffness: 160,
        delay: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardOpacity, cardY, logoScale]);

  useEffect(() => {
    if (!errorMsg) return;
    errorShake.setValue(0);
    Animated.sequence([
      Animated.timing(errorShake, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: -6, duration: 55, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 5, duration: 55, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [errorMsg, errorShake]);

  const handleSubmit = async () => {
    setErrorMsg(null);
    if (!username.trim() || !password) {
      setErrorMsg('Lütfen kullanıcı adı ve şifre alanlarını doldurun.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const user = await loginUser(username, password);
        if (!user) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          setErrorMsg('Kullanıcı adı veya şifre hatalı.');
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onAuthenticated(user);
      } else {
        const user = await registerUser(displayName, username, password);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onAuthenticated(user);
      }
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setErrorMsg(err?.message || 'İşlem sırasında bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={[
              styles.card,
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardY }],
              },
            ]}
          >
            <View style={styles.brandHeader}>
              <Animated.Image
                source={
                  isDark ? require('../../assets/logo-dark.png') : require('../../assets/logo.png')
                }
                style={[styles.logo, { transform: [{ scale: logoScale }] }]}
              />
              <Text style={styles.title}>MoodSync</Text>
              <Text style={styles.subtitle}>
                Geçmiş taramalarınıza ve kişisel şarkı önerilerinize ulaşmak için giriş yapın.
              </Text>
            </View>

            <AnimatedSegmentedControl<'login' | 'register'>
              value={mode}
              onChange={(next) => {
                setMode(next);
                setErrorMsg(null);
              }}
              options={[
                { key: 'login', label: 'Giriş Yap' },
                { key: 'register', label: 'Kayıt Ol' },
              ]}
              style={{ marginBottom: 20 }}
            />

            {mode === 'register' && (
              <StaggeredEntry index={0} direction="down" style={styles.fieldGroup}>
                <Text style={styles.label}>Ad Soyad</Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Örn: Haluk Albayrak"
                  placeholderTextColor={colors.inkMuted}
                  style={styles.input}
                  autoCapitalize="words"
                />
              </StaggeredEntry>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Kullanıcı Adı</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Kullanıcı adınızı girin"
                placeholderTextColor={colors.inkMuted}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Şifre</Text>
              <View style={styles.pwWrap}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === 'register' ? 'En az 4 karakter' : 'Şifrenizi girin'}
                  placeholderTextColor={colors.inkMuted}
                  secureTextEntry={!showPassword}
                  style={[styles.input, { paddingRight: 48 }]}
                  autoCapitalize="none"
                />
                <Pressable
                  onPress={() => setShowPassword((prev) => !prev)}
                  style={styles.eyeBtn}
                  hitSlop={8}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.inkSecondary}
                  />
                </Pressable>
              </View>
            </View>

            {errorMsg && (
              <Animated.View
                style={[styles.errorBox, { transform: [{ translateX: errorShake }] }]}
              >
                <Ionicons name="alert-circle" size={17} color={colors.danger} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </Animated.View>
            )}

            <SpringPressable
              haptic
              scaleTo={0.97}
              onPress={handleSubmit}
              disabled={loading}
              style={[styles.primaryBtn, loading && { opacity: 0.65 }]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur ve Başla'}
                </Text>
              )}
            </SpringPressable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 26,
      paddingHorizontal: 24,
      paddingVertical: 30,
      borderWidth: 1,
      borderColor: colors.hairline,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: colors.isDark ? 0.5 : 0.08,
      shadowRadius: 28,
      elevation: 6,
    },
    brandHeader: {
      alignItems: 'center',
      marginBottom: 24,
    },
    logo: {
      width: 68,
      height: 68,
      borderRadius: 18,
      marginBottom: 12,
    },
    title: {
      fontSize: 25,
      fontWeight: '800',
      letterSpacing: -0.7,
      color: colors.inkPrimary,
    },
    subtitle: {
      marginTop: 6,
      fontSize: 13.5,
      color: colors.inkSecondary,
      textAlign: 'center',
      lineHeight: 19,
    },
    segmented: {
      flexDirection: 'row',
      backgroundColor: colors.subtle,
      borderRadius: 12,
      padding: 4,
      marginBottom: 20,
    },
    segTab: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 9,
      alignItems: 'center',
    },
    segTabActive: {
      backgroundColor: colors.surface,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: colors.isDark ? 0.35 : 0.06,
      shadowRadius: 4,
    },
    segText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
    segTextActive: {
      color: colors.inkPrimary,
      fontWeight: '700',
    },
    fieldGroup: {
      marginBottom: 15,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.inkPrimary,
      marginBottom: 6,
    },
    input: {
      height: 48,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      backgroundColor: colors.elevated,
      paddingHorizontal: 14,
      fontSize: 15,
      color: colors.inkPrimary,
    },
    pwWrap: {
      position: 'relative',
      justifyContent: 'center',
    },
    eyeBtn: {
      position: 'absolute',
      right: 13,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.dangerSoft,
      padding: 11,
      borderRadius: 11,
      marginBottom: 14,
    },
    errorText: {
      flex: 1,
      fontSize: 13,
      color: colors.danger,
      fontWeight: '600',
    },
    primaryBtn: {
      height: 50,
      borderRadius: 14,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    primaryBtnText: {
      color: '#FFFFFF',
      fontSize: 15.5,
      fontWeight: '700',
    },
  });
