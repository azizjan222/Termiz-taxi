import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { getSupportInfo } from '../src/api/ai';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// Static FAQ content (Uzbek) for passengers.
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Qanday qilib taksi buyurtma qilaman?',
    a: "Bosh sahifada \"Taksi chaqirish\"ni tanlang, qayerdan-qayergani belgilang, yo'lovchilar sonini kiriting va haydovchi qidirishni boshlang.",
  },
  {
    q: 'Manzilni qanday tanlayman?',
    a: "Taksi/Pochtani tanlaganingizda joylashuvingiz xaritada avtomatik aniqlanadi. \"Qayerga borasiz?\"ni bosib, manzilni qidiruvdan, saqlangan \"Uy\"/\"Ish\" manzillaringizdan yoki tumanlar ro'yxatidan tanlang.",
  },
  {
    q: 'Haydovchi qayerdaligini ko\'ra olamanmi?',
    a: "Ha. Haydovchi zakasni qabul qilgach, buyurtma sahifasida uning joylashuvi xaritada real vaqtda ko'rinadi.",
  },
  {
    q: 'To\'lov qanday amalga oshiriladi?',
    a: "To'lov haydovchi bilan to'g'ridan-to'g'ri (naqd) amalga oshiriladi. Narx buyurtma berishdan oldin ko'rsatiladi.",
  },
  {
    q: 'Buyurtmani qanday bekor qilaman?',
    a: "Qidiruv yoki buyurtma sahifasida \"Buyurtmani bekor qilish\" tugmasini bosing.",
  },
  {
    q: 'Do\'stimni qanday taklif qilaman?',
    a: "Profil → \"Do'stlarni taklif qiling\" bo'limidan kodingizni ulashing. Do'stingiz ham, siz ham bonus olasiz.",
  },
  {
    q: 'Haydovchini qanday baholayman?',
    a: "Sayohat yakunlangach, haydovchini 1-5 yulduz bilan baholash oynasi ochiladi. Izoh ham qoldirishingiz mumkin.",
  },
  {
    q: 'Tilni va mavzuni qanday o\'zgartiraman?',
    a: "Profil → Sozlamalar bo'limida tilni (O'zbek/Rus/Ingliz) va qorong'i/yorug' rejimni tanlashingiz mumkin.",
  },
];

export default function FaqScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [supportUrl, setSupportUrl] = useState('https://t.me/SarixGo_support_bot');
  const [supportUsername, setSupportUsername] = useState('SarixGo_support_bot');
  const [supportEmail, setSupportEmail] = useState('sarixgo.support@gmail.com');
  const [open, setOpen] = useState<number | null>(0);

  useEffect(() => {
    getSupportInfo()
      .then((info) => {
        if (info.telegram_url) setSupportUrl(info.telegram_url);
        if (info.telegram_username) setSupportUsername(info.telegram_username);
        if (info.email) setSupportEmail(info.email);
      })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('faq.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {FAQ.map((item, i) => {
          const expanded = open === i;
          return (
            <TouchableOpacity
              key={i}
              style={styles.card}
              onPress={() => setOpen(expanded ? null : i)}
              activeOpacity={0.8}
            >
              <View style={styles.qRow}>
                <Text style={styles.q}>{item.q}</Text>
                <Text style={styles.chev}>{expanded ? '−' : '+'}</Text>
              </View>
              {expanded && <Text style={styles.a}>{item.a}</Text>}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => Linking.openURL(supportUrl)}
          activeOpacity={0.85}
        >
          <Text style={styles.supportIcon}>💬</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>{t('faq.contactSupport')}</Text>
            <Text style={styles.supportSub}>@{supportUsername}</Text>
          </View>
          <Text style={styles.supportArrow}>›</Text>
        </TouchableOpacity>

        {/* Email — questions & suggestions */}
        <TouchableOpacity
          style={styles.emailBtn}
          onPress={() => Linking.openURL(`mailto:${supportEmail}`)}
          activeOpacity={0.85}
        >
          <Text style={styles.emailIcon}>📧</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.emailTitle}>{t('faq.emailSupport')}</Text>
            <Text style={styles.emailSub}>{supportEmail}</Text>
          </View>
          <Text style={styles.emailArrow}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  title: { ...typography.h3, color: colors.primary },
  scroll: { padding: spacing.lg },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  q: { ...typography.bodyBold, color: colors.text, flex: 1, paddingRight: spacing.sm },
  chev: { fontSize: 24, color: colors.textMuted, fontWeight: '300' },
  a: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 20 },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
  },
  supportIcon: { fontSize: 26, marginRight: spacing.md },
  supportTitle: { ...typography.bodyBold, color: colors.textOnPrimary },
  supportSub: { ...typography.small, color: colors.textOnPrimary, opacity: 0.8, marginTop: 2 },
  supportArrow: { fontSize: 24, color: colors.textOnPrimary },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  emailIcon: { fontSize: 24, marginRight: spacing.md },
  emailTitle: { ...typography.bodyBold, color: colors.primary },
  emailSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  emailArrow: { fontSize: 24, color: colors.primary },
});
