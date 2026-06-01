import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Linking, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { requestDriverOtp, telegramStart, telegramCheck } from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { BOT_USERNAME } from '../src/api/client';
import { colors, typography, spacing, radius } from '../src/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const setDriver = useDriverStore((s) => s.setDriver);

  const [phone, setPhone] = useState('+998');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPhone, setShowPhone] = useState(false);

  // Telegram flow state
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
            Alert.alert("⚠️ Ro'yxatdan o'tmagansiz", r.message || '', [
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

  const formatPhone = (text: string) => {
    let cleaned = text.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+998')) {
      if (cleaned.startsWith('998')) cleaned = '+' + cleaned;
      else if (!cleaned.startsWith('+')) cleaned = '+998' + cleaned.replace(/^\+/, '');
    }
    return cleaned.slice(0, 13);
  };

  const handleSendOtp = async () => {
    if (phone.length < 13) { setError("Telefon raqam noto'g'ri"); return; }
    setError('');
    setLoading(true);
    try {
      const res = await requestDriverOtp(phone);
      router.push({ pathname: '/login-otp', params: { phone, devCode: res.dev_code || '' } });
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Xatolik';
      const code = e?.response?.data?.code;
      if (code === 'not_registered') {
        Alert.alert("⚠️ Ro'yxatdan o'tmagansiz", msg, [
          { text: 'Bekor qilish', style: 'cancel' },
          { text: "Botga o'tish", onPress: openBot },
        ]);
      } else {
        Alert.alert(t('common.error'), msg);
      }
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
          ) : !showPhone ? (
            <View>
              <View style={styles.infoCard}>
                <Text style={styles.infoText}>
                  Telegram orqali tez va xavfsiz kiring. Raqamingizni ulashasiz, tamom!
                </Text>
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          ) : (
            <View>
              <Text style={styles.label}>Telefon raqamingiz</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={(t) => { setPhone(formatPhone(t)); setError(''); }}
                placeholder="+998 __ ___ __ __"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                autoFocus
              />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          )}
        </View>

        {!tgWaiting && (
          <View style={styles.footer}>
            {!showPhone ? (
              <>
                <Button title="📲 Telegram orqali kirish" onPress={startTelegram} loading={loading} variant="accent" />
                <TouchableOpacity style={styles.altBtn} onPress={() => setShowPhone(true)}>
                  <Text style={styles.altText}>SMS kod bilan kirish</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Button title="Kodni yuborish" onPress={handleSendOtp} loading={loading} disabled={phone.length < 13} variant="accent" />
                <TouchableOpacity style={styles.altBtn} onPress={() => { setShowPhone(false); setError(''); }}>
                  <Text style={styles.altText}>← Telegram orqali kirish</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
  infoCard: { backgroundColor: colors.primaryLight, padding: spacing.md, borderRadius: radius.md },
  infoText: { ...typography.body, color: colors.white, opacity: 0.9 },
  label: { ...typography.caption, color: colors.white, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.white, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: spacing.md, fontSize: 18, color: colors.primary, fontWeight: '600',
  },
  errorText: { ...typography.small, color: '#FCA5A5', marginTop: spacing.sm },
  waitingBox: { alignItems: 'center', gap: spacing.md },
  waitingText: { ...typography.h3, color: colors.white, textAlign: 'center' },
  waitingHint: { ...typography.body, color: colors.accent, textAlign: 'center' },
  linkText: { ...typography.body, color: colors.white, textDecorationLine: 'underline', marginTop: spacing.sm },
  footer: { paddingBottom: spacing.lg },
  altBtn: { alignItems: 'center', padding: spacing.md, marginTop: spacing.sm },
  altText: { ...typography.body, color: colors.white, opacity: 0.85 },
});
