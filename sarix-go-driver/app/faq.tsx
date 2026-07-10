import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { getSupportInfo, type SupportInfo } from '../src/api/ai';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';

// Static FAQ content (Uzbek) for drivers.
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Ilovaga qanday kiraman?',
    a: "\"Telegram orqali kirish\" tugmasini bosing, botda raqamingizni ulashing — avtomatik kirasiz. So'ng ilovaning o'zida hujjatlaringizni (guvohnoma va texpasportning ikkala tomoni) yuklaysiz.",
  },
  {
    q: 'Birinchi oy haqiqatan ham bepulmi?',
    a: "Ha. Birinchi haydovchilar uchun 1 oy mutlaqo bepul — bu davrda komissiya olinmaydi va minimal balans talab qilinmaydi.",
  },
  {
    q: 'Komissiya qancha?',
    a: "Bepul davr tugagach, har bir qabul qilingan zakas uchun narxning 10% komissiya balansingizdan olinadi.",
  },
  {
    q: 'Nega yangi zakaslar kelmayapti?',
    a: "Balansingizda mablag' yetarli bo'lmasa (kamida 20 000 so'm) yangi zakaslar ko'rsatilmaydi. Balansni to'ldiring va \"Onlayn\" rejimini yoqing.",
  },
  {
    q: "Balansni qanday to'ldiraman?",
    a: "Profil → Balansni to'ldirish bo'limidan karta, Click yoki Payme orqali to'ldirasiz. To'lov cheki admin tomonidan tasdiqlanadi.",
  },
  {
    q: 'Zakasni qabul qilgach nima qilaman?',
    a: "Yo'lovchining telefon raqami ochiladi — 15 daqiqa ichida bog'laning. \"Yo'l ko'rsatish\" tugmasi orqali xaritada yo'lovchi oldiga yo'lni ochishingiz mumkin.",
  },
  {
    q: 'Onlayn vaqt qanday hisoblanadi?',
    a: "\"Onlayn\" rejimini yoqsangiz, bugungi onlayn vaqtingiz hisoblanadi va Statistika bo'limida ko'rinadi.",
  },
];

export default function FaqScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [open, setOpen] = useState<number | null>(0);

  useEffect(() => {
    getSupportInfo().then(setSupport).catch(() => {});
  }, []);

  const openSupport = () => {
    Linking.openURL(support?.telegram_url || 'https://t.me/SarixGo_support_bot');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('faq.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {FAQ.map((item, i) => {
          const expanded = open === i;
          return (
            <TouchableOpacity
              key={i}
              style={[styles.card, { backgroundColor: colors.background, borderColor: colors.divider }]}
              onPress={() => setOpen(expanded ? null : i)}
              activeOpacity={0.8}
            >
              <View style={styles.qRow}>
                <Text style={[styles.q, { color: colors.text }]}>{item.q}</Text>
                <Text style={[styles.chev, { color: colors.textMuted }]}>{expanded ? '−' : '+'}</Text>
              </View>
              {expanded && <Text style={[styles.a, { color: colors.textSecondary }]}>{item.a}</Text>}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.supportBtn, { backgroundColor: colors.primary }]}
          onPress={openSupport}
          activeOpacity={0.85}
        >
          <Text style={styles.supportIcon}>💬</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>{t('faq.contactSupport')}</Text>
            <Text style={styles.supportSub}>
              {support ? `@${support.telegram_username}` : t('faq.contactHint')}
            </Text>
          </View>
          <Text style={styles.supportArrow}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28 },
  title: { ...typography.h3 },
  scroll: { padding: spacing.lg },
  card: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1 },
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  q: { ...typography.bodyBold, flex: 1, paddingRight: spacing.sm },
  chev: { fontSize: 24, fontWeight: '300' },
  a: { ...typography.caption, marginTop: spacing.sm, lineHeight: 20 },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  supportIcon: { fontSize: 26, marginRight: spacing.md },
  supportTitle: { ...typography.bodyBold, color: '#FFFFFF' },
  supportSub: { ...typography.small, color: '#FFFFFF', opacity: 0.8, marginTop: 2 },
  supportArrow: { fontSize: 24, color: '#FFFFFF' },
});
