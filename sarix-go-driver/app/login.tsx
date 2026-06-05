import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Linking, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { telegramStart, telegramCheck } from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { BOT_USERNAME } from '../src/api/client';
import { colors, typography, spacing, radius } from '../src/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const setDriver = useDriverStore((s) => s.setDriver);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
            Alert.alert("📄 Hujjatlar kerak", r.message || "Ilovaga kirish uchun botda hujjatlaringizni yuboring (\"Haydovchi bo'lish\").", [
              { text: 'Bekor qilish', style: 'cancel' },
              { text: "Botga o'tish", onPress: openBot },
            ]);
          } else if (r.status === 'blocked') {
            stopPolling(); setTgWaiting(false); setError(r.message || 'Bloklangan');
          } else if (r.status === 'expired') {
            stopPolling(); setTgWaiting(false); setError('Muddati tugadi');
          }
        } catch {}
      }, 2500);
    } catch (e) {
      setError("Xatolik. Qayta urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={styles.logoBox}><Text style={styles.logoEmoji}>🚕</Text></View>
          <Text style={styles.title}>Sarix Go Driver</Text>
          <Text style={styles.subtitle}>Haydovchilar uchun ilova</Text>
        </View>

        <View style={styles.body}>
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
        </View>

        {!tgWaiting && (
          <View style={styles.footer}>
            <Button
              title="📲 Telegram orqali kirish"
              onPress={startTelegram}
              loading={loading}
              variant="accent"
            />
            <Text style={styles.note}>
              Avval botda "Haydovchi bo'lish" orqali ro'yxatdan o'ting
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Step: React.FC<{ n: string; text: string }> = ({ n, text }) => (
  <View style={styles.stepRow}>
    <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
    <Text style={styles.stepText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary, paddingHorizontal: spacing.lg },
  header: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg },
  logoBox: {
    width: 100, height: 100, borderRadius: radius.lg, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  logoEmoji: { fontSize: 56 },
  title: { ...typography.h1, color: colors.white },
  subtitle: { ...typography.body, color: colors.white, opacity: 0.8, marginTop: 4 },
  body: { flex: 1, justifyContent: 'center' },
  steps: { gap: spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: colors.primary, fontWeight: '800' },
  stepText: { flex: 1, ...typography.body, color: colors.white },
  errorText: { ...typography.caption, color: '#FCA5A5', textAlign: 'center', marginTop: spacing.md },
  waitingBox: { alignItems: 'center', gap: spacing.md },
  waitingText: { ...typography.h3, color: colors.white, textAlign: 'center' },
  waitingHint: { ...typography.body, color: colors.accent, textAlign: 'center' },
  linkText: { ...typography.body, color: colors.white, textDecorationLine: 'underline', marginTop: spacing.sm },
  footer: { paddingBottom: spacing.lg },
  note: { ...typography.small, color: colors.white, opacity: 0.7, textAlign: 'center', marginTop: spacing.md },
});
