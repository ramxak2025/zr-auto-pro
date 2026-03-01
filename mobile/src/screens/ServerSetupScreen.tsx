import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

export default function ServerSetupScreen() {
  const { configureServer, serverUrl } = useAuth();
  const [url, setUrl] = useState(serverUrl || '');
  const [checking, setChecking] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleConnect = async () => {
    let input = url.trim();
    if (!input) {
      Alert.alert('Ошибка', 'Введите адрес сервера');
      return;
    }

    // Add http:// if no protocol
    if (!input.startsWith('http://') && !input.startsWith('https://')) {
      input = 'http://' + input;
    }

    // Remove trailing /api if user added it
    let baseUrl = input.replace(/\/api\/?$/, '').replace(/\/+$/, '');

    setChecking(true);
    try {
      // Try to ping the server health endpoint
      const res = await axios.get(`${baseUrl}/api/health`, { timeout: 10000 });
      if (res.status === 200) {
        await configureServer(baseUrl);
      } else {
        Alert.alert('Ошибка', 'Сервер ответил с ошибкой. Проверьте адрес.');
      }
    } catch (err: any) {
      // Even if health endpoint doesn't exist, try to save if server responds
      if (err.response) {
        // Server responded (even with error) — it's reachable
        await configureServer(baseUrl);
      } else {
        Alert.alert(
          'Сервер недоступен',
          `Не удалось подключиться к ${baseUrl}\n\nПроверьте:\n• Адрес введён правильно\n• Сервер запущен\n• Порт 3000 открыт\n• Телефон и сервер в одной сети`,
          [
            { text: 'Отмена', style: 'cancel' },
            {
              text: 'Сохранить всё равно',
              onPress: () => configureServer(baseUrl),
            },
          ]
        );
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            {/* Logo */}
            <View style={styles.logoWrap}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
                defaultSource={require('../../assets/logo.png')}
              />
            </View>
            <Text style={styles.subtitle}>Система управления автосервисом</Text>

            {/* Server icon */}
            <Animated.View style={[styles.iconWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <View style={styles.serverIcon}>
                <Ionicons name="server-outline" size={40} color={colors.primary[500]} />
              </View>
              <Text style={styles.title}>Подключение к серверу</Text>
              <Text style={styles.description}>
                Введите адрес сервера, на котором установлена система Autexa
              </Text>
            </Animated.View>

            {/* URL input */}
            <Animated.View style={[styles.fieldWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.label}>АДРЕС СЕРВЕРА</Text>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="192.168.1.100:3000"
                placeholderTextColor={colors.gray[400]}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Text style={styles.hint}>
                Например: 192.168.1.100:3000 или my-server.com:3000
              </Text>
            </Animated.View>

            {/* Connect button */}
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
              <TouchableOpacity
                style={[styles.submitBtn, checking && styles.submitBtnDisabled]}
                onPress={handleConnect}
                disabled={checking}
                activeOpacity={0.8}
              >
                {checking ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <View style={styles.btnContent}>
                    <Ionicons name="link-outline" size={20} color={colors.white} style={{ marginRight: 8 }} />
                    <Text style={styles.submitText}>Подключиться</Text>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>

            {/* Help */}
            <Animated.View style={[styles.helpSection, { opacity: fadeAnim }]}>
              <View style={styles.helpCard}>
                <Ionicons name="information-circle-outline" size={20} color={colors.blue[500]} />
                <Text style={styles.helpText}>
                  Сервер Autexa должен быть развёрнут на вашем компьютере или VPS.
                  Убедитесь, что порт 3000 доступен с вашего телефона.
                </Text>
              </View>
            </Animated.View>
          </View>

          <Text style={styles.footer}>Autexa v1.8 © 2026</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.white,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[12],
  },
  container: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  logoImage: {
    width: 240,
    height: 58,
  },
  subtitle: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.gray[400],
    marginBottom: spacing[6],
    letterSpacing: 1,
  },
  iconWrap: {
    alignItems: 'center',
    marginBottom: spacing[6],
  },
  serverIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    marginBottom: spacing[2],
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    textAlign: 'center',
    lineHeight: 20,
  },
  fieldWrap: {
    marginBottom: spacing[5],
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
    letterSpacing: 1.5,
    marginBottom: spacing[2],
  },
  input: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    fontSize: 15,
    color: colors.gray[900],
  },
  hint: {
    marginTop: spacing[1.5],
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },
  submitBtn: {
    backgroundColor: colors.primary[600],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
    shadowColor: colors.primary[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  submitText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: fontWeight.semibold,
  },
  helpSection: {
    marginTop: spacing[6],
  },
  helpCard: {
    flexDirection: 'row',
    backgroundColor: colors.blue[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    gap: spacing[3],
    alignItems: 'flex-start',
  },
  helpText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.blue[700],
    lineHeight: 18,
  },
  footer: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.gray[300],
    marginTop: spacing[8],
  },
});
