import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Alert, Animated, Easing,
  KeyboardAvoidingView, Platform, Linking, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';


import { Button } from '../src/components/Button';
import { telegramStart, telegramCheck } from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { BOT_USERNAME } from '../src/api/client';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// Driver entry palette — vivid BLUE ("ko'k").
const BLUE_GRADIENT: [string, string, string] = ['#2E8BFF', '#1565E0', '#0B3FA8'];

export default function LoginScreen() {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setDriver = useDriverStore((s) => s.setDriver);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entrance animation for the content.
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(30)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    // fade/slide are stable Animated.Value refs; run the entrance once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => () => stopPolling(), []);

  const openBot = () => Linking.openURL(`https://t.me/${BOT_USERNAME}`);

  const startTelegram = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await telegramStart();
      setTgToken(res.token);
      await Linking.openURL(res.deep_link);
      setTgWaiting(true);
      let elapsed = 0;
      stopPolling();
      pollRef.current = setInterval(async () => {
        elapsed += 1;
        if (elapsed > 120) { stopPolling(); setTgWaiting(false); setError('Vaqt tugadi'); return; }
        try {
          const r = await telegramCheck(res.token);
          if (r.status === 'verified' && r.driver) {
            stopPolling();
            setDriver(r.driver);
            router.replace('/(main)/orders');
          } else if (r.status === 'not_registered') {
            stopPolling(); setTgWaiting(false);
            Alert.alert("⚠️ Ro'yxatdan o'tmagansiz", r.message || "Botda \"Haydovchi bo'lish\"ni bosing", [
              { text: 'Bekor qilish', style: 'cancel' },
              { text: "Botga o'tish", onPress: openBot },
            ]);
          } else if (r.status === 'documents_required') {
            stopPolling(); setTgWaiting(false);
            // Authenticated, but documents still needed -> collect them IN THE APP.
            if (r.driver) setDriver(r.driver);
            router.replace('/driver-documents');
          } else if (r.status === 'blocked') {
            stopPolling(); setTgWaiting(false); setError(r.message || 'Bloklangan');
          } else if (r.status === 'expired') {
            stopPolling(); setTgWaiting(false); setError('Muddati tugadi');
          }
        } catch {}
      }, 2500);
    } catch {
      setError("Xatolik. Qayta urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={BLUE_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={[styles.header, { opacity: fade, transform: [{ translateY: slide }] }]}>
            <View style={styles.logoBox}><Text style={styles.logoEmoji}>🚕</Text></View>
            <Text style={styles.title}>Sarix Go Driver</Text>
            <Text style={styles.subtitle}>Haydovchilar uchun ilova</Text>
          </Animated.View>

          <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateY: slide }] }]}>
            {tgWaiting ? (
              <View style={styles.waitingBox}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.waitingText}>Telegram tasdiqlanishini kutmoqda...</Text>
                <Text style={styles.waitingHint}>Telegram'da raqamingizni ulashing</Text>
                <TouchableOpacity onPress={() => tgToken && Linking.openURL(`https://t.me/${BOT_USERNAME}?start=auth_${tgToken}`)}>
                  <Text style={styles.linkText}>Telegram'ni qayta ochish</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.steps}>
                <Step n="1" text="Pastdagi tugmani bosing" />
                <Step n="2" text='Telegram bot ochiladi — "Boshlash"ni bosing' />
                <Step n="3" text="Raqamingizni ulashing — avtomatik kirasiz" />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
            )}
          </Animated.View>

          {!tgWaiting && (
            <Animated.View style={[styles.footer, { opacity: fade }]}>
              <Button
                title="📲 Telegram orqali kirish"
                onPress={startTelegram}
                loading={loading}
                variant="accent"
                accessibilityLabel="Telegram orqali kirish"
                accessibilityHint="Telegram botda telefon raqamingizni tasdiqlashni boshlaydi"
              />
              <Text style={styles.note}>
                Telegram orqali kirasiz, hujjatlaringizni ilovada yuklaysiz
              </Text>
            </Animated.View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const Step: React.FC<{ n: string; text: string }> = ({ n, text }) => {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
  header: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg },
  logoBox: {
    width: 100, height: 100, borderRadius: radius.lg, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  logoEmoji: { fontSize: 56 },
  title: { ...typography.h1, color: colors.textOnPrimary },
  subtitle: { ...typography.body, color: colors.textOnPrimary, opacity: 0.8, marginTop: 4 },
  body: { flex: 1, justifyContent: 'center' },
  steps: { gap: spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: colors.primary, fontWeight: '800' },
  stepText: { flex: 1, ...typography.body, color: colors.textOnPrimary },
  errorText: { ...typography.caption, color: '#FCA5A5', textAlign: 'center', marginTop: spacing.md },
  waitingBox: { alignItems: 'center', gap: spacing.md },
  waitingText: { ...typography.h3, color: colors.textOnPrimary, textAlign: 'center' },
  waitingHint: { ...typography.body, color: colors.accent, textAlign: 'center' },
  linkText: { ...typography.body, color: colors.textOnPrimary, textDecorationLine: 'underline', marginTop: spacing.sm },
  footer: { paddingBottom: spacing.lg },
  note: { ...typography.small, color: colors.textOnPrimary, opacity: 0.7, textAlign: 'center', marginTop: spacing.md },
});
