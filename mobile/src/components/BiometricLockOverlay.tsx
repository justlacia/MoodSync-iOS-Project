import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isAdminUser, UserRecord } from '../database/iosDatabase';
import { ThemePalette } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { SpringPressable } from './MotionPrimitives';

interface Props {
  visible: boolean;
  user: UserRecord;
  biometricLabel: string;
  busy: boolean;
  errorText: string | null;
  onUnlock: () => void;
  onUsePassword: () => void;
}

export const BiometricLockOverlay: React.FC<Props> = ({
  visible,
  user,
  biometricLabel,
  busy,
  errorText,
  onUnlock,
  onUsePassword,
}) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!visible) return null;

  const isAdmin = isAdminUser(user);
  const logoSource = isDark
    ? require('../../assets/logo-dark.png')
    : require('../../assets/logo.png');

  return (
    <View style={styles.backdrop}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <Image source={logoSource} style={styles.logo} />

          <View style={styles.lockIconCircle}>
            <Ionicons name="scan-outline" size={30} color={colors.brand} />
          </View>

          <Text style={styles.title}>MoodSync Kilitli</Text>
          <Text style={styles.subtitle}>
            Devam etmek için yalnızca bu hesaba tanımlı {biometricLabel} doğrulamasını tamamlayın.
          </Text>

          <View style={styles.accountBadge}>
            <View style={[styles.avatarDot, isAdmin && { backgroundColor: colors.brand }]}>
              <Text style={[styles.avatarDotText, isAdmin && { color: '#FFFFFF' }]}>
                {user.displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.accountHandle}>@{user.username}</Text>
            {isAdmin && (
              <View style={styles.adminPill}>
                <Ionicons name="shield-checkmark" size={11} color={colors.brand} />
                <Text style={styles.adminPillText}>ADMIN</Text>
              </View>
            )}
          </View>

          {errorText ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          ) : null}

          <SpringPressable
            haptic
            disabled={busy}
            onPress={onUnlock}
            style={[styles.unlockBtn, busy && { opacity: 0.7 }]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="scan" size={19} color="#FFFFFF" />
                <Text style={styles.unlockBtnText}>{biometricLabel} ile Kilidi Aç</Text>
              </>
            )}
          </SpringPressable>

          <SpringPressable
            haptic
            disabled={busy}
            onPress={onUsePassword}
            style={styles.fallbackBtn}
          >
            <Text style={styles.fallbackBtnText}>Farklı Hesap veya Şifreyle Giriş Yap</Text>
          </SpringPressable>
        </View>
      </SafeAreaView>
    </View>
  );
};

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.canvas,
      zIndex: 900,
    },
    safe: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 28,
      paddingHorizontal: 24,
      paddingVertical: 30,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: colors.isDark ? 0.55 : 0.1,
      shadowRadius: 30,
      elevation: 10,
    },
    logo: {
      width: 54,
      height: 54,
      borderRadius: 15,
      marginBottom: 14,
    },
    lockIconCircle: {
      width: 60,
      height: 60,
      borderRadius: 20,
      backgroundColor: colors.brandSoft,
      borderWidth: 1,
      borderColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    title: {
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: -0.5,
      color: colors.inkPrimary,
    },
    subtitle: {
      marginTop: 7,
      fontSize: 13.5,
      color: colors.inkSecondary,
      textAlign: 'center',
      lineHeight: 19,
    },
    accountBadge: {
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 999,
    },
    avatarDot: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.subtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarDotText: {
      fontSize: 11.5,
      fontWeight: '800',
      color: colors.inkPrimary,
    },
    accountHandle: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.inkPrimary,
    },
    adminPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.brandSoft,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
    },
    adminPillText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.brand,
    },
    errorBox: {
      marginTop: 14,
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.dangerSoft,
      borderRadius: 12,
      padding: 11,
    },
    errorText: {
      flex: 1,
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.danger,
    },
    unlockBtn: {
      marginTop: 20,
      width: '100%',
      height: 52,
      borderRadius: 15,
      backgroundColor: colors.brand,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    unlockBtnText: {
      fontSize: 15.5,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    fallbackBtn: {
      marginTop: 14,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    fallbackBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.inkSecondary,
    },
  });
