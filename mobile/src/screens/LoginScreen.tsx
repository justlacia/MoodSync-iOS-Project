import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { loginUser, registerUser, UserRecord } from '../database/iosDatabase';
import { Colors } from '../theme/colors';

interface Props {
  onAuthenticated: (user: UserRecord) => void;
}

export const LoginScreen: React.FC<Props> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const fillDemoCredentials = () => {
    Haptics.selectionAsync().catch(() => {});
    setMode('login');
    setUsername('demo');
    setPassword('moodsync123');
    setErrorMsg(null);
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
          <View style={styles.card}>
            <View style={styles.brandHeader}>
              <Image source={require('../../assets/logo.png')} style={styles.logo} />
              <Text style={styles.title}>MoodSync</Text>
              <Text style={styles.subtitle}>
                Geçmiş taramalarınıza ve kişisel şarkı önerilerinize ulaşmak için giriş yapın.
              </Text>
            </View>

            <View style={styles.segmented}>
              <Pressable
                onPress={() => {
                  setMode('login');
                  setErrorMsg(null);
                }}
                style={[styles.segTab, mode === 'login' && styles.segTabActive]}
              >
                <Text style={[styles.segText, mode === 'login' && styles.segTextActive]}>
                  Giriş Yap
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMode('register');
                  setErrorMsg(null);
                }}
                style={[styles.segTab, mode === 'register' && styles.segTabActive]}
              >
                <Text style={[styles.segText, mode === 'register' && styles.segTextActive]}>
                  Kayıt Ol
                </Text>
              </Pressable>
            </View>

            {mode === 'register' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Ad Soyad</Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Örn: Mert Yılmaz"
                  placeholderTextColor={Colors.inkMuted}
                  style={styles.input}
                  autoCapitalize="words"
                />
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Kullanıcı Adı</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Kullanıcı adınızı girin"
                placeholderTextColor={Colors.inkMuted}
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
                  placeholder={mode === 'register' ? 'En az 6 karakter' : 'Şifrenizi girin'}
                  placeholderTextColor={Colors.inkMuted}
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
                    color={Colors.inkSecondary}
                  />
                </Pressable>
              </View>
            </View>

            {errorMsg && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={17} color={Colors.danger} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            <Pressable
              onPress={handleSubmit}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                loading && { opacity: 0.65 },
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur ve Başla'}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={fillDemoCredentials} style={styles.demoChip}>
              <Text style={styles.demoChipText}>
                Hızlı Test Hesabı: <Text style={{ fontWeight: '800' }}>demo</Text> /{' '}
                <Text style={{ fontWeight: '800' }}>moodsync123</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 26,
    paddingHorizontal: 24,
    paddingVertical: 30,
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: '#181D25',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
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
    color: Colors.inkPrimary,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13.5,
    color: Colors.inkSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.subtle,
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
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  segText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.inkSecondary,
  },
  segTextActive: {
    color: Colors.inkPrimary,
    fontWeight: '700',
  },
  fieldGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.inkPrimary,
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.hairlineStrong,
    backgroundColor: Colors.elevated,
    paddingHorizontal: 14,
    fontSize: 15,
    color: Colors.inkPrimary,
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
    backgroundColor: Colors.dangerSoft,
    padding: 11,
    borderRadius: 11,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '600',
  },
  primaryBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '700',
  },
  demoChip: {
    marginTop: 16,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.subtle,
  },
  demoChipText: {
    fontSize: 12.5,
    color: Colors.inkSecondary,
  },
});
