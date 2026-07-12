import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useThemeStore } from '../src/store/theme';
import { typography, spacing } from '../src/theme';

// Full "Foydalanish shartlari va maxfiylik siyosati" (Terms & Privacy) content.
// Each section is rendered with a bold heading and one or more paragraphs.
const SECTIONS: { heading: string; paragraphs: string[] }[] = [
  {
    heading: '1. Umumiy qoidalar va xizmat turi',
    paragraphs: [
      "„Sarix Go\" — bu ro'yxatdan o'tgan Yo'lovchilar (buyurtma beruvchilar) va ro'yxatdan o'tgan mustaqil Haydovchilar (xizmat ko'rsatuvchilar) o'rtasida buyurtmalarni onlayn muvofiqlashtiruvchi axborot-texnologiya platformasi hisoblanadi.",
      "Ilova mustaqil ravishda taksi xizmatini ko'rsatmaydi, shaxsiy avtotransport parkiga ega emas va haydovchilar bilan mehnat munosabatlariga kirmaydi.",
    ],
  },
  {
    heading: '2. Ro\'yxatdan o\'tish va hisob-kitoblar (Komissiya)',
    paragraphs: [
      "Yo'lovchilar uchun: Ilovadan foydalanish va buyurtma (zakas) berish uchun yo'lovchilar telefon raqami orqali ro'yxatdan o'tishlari shart.",
      "Haydovchilar uchun: Haydovchilar ilovada ishlash va buyurtmalarni qabul qilish uchun tegishli hujjatlarni taqdim etgan holda ro'yxatdan o'tadilar.",
      "Xizmat haqi (Komissiya): „Sarix Go\" ilovasi haydovchilarga buyurtma topib berish va platformadan foydalanish imkoniyatini taqdim etgani uchun, har bir muvaffaqiyatli yakunlangan safardan belgilangan foiz (%) miqdorida xizmat haqi (komissiya) oladi. Komissiya miqdori va uni undirish tartibi ilova tariflarida ko'rsatiladi.",
    ],
  },
  {
    heading: '3. Mas\'uliyatni cheklash (Baxtsiz hodisalar va zararlar)',
    paragraphs: [
      "Yo'l-transport hodisalari: „Sarix Go\" yo'lovchi va haydovchini bog'lovchi vositachi platforma bo'lgani sababli, safar davomida yo'llarda sodir bo'lishi mumkin bo'lgan har qanday baxtsiz hodisalar (avariya), yo'lovchilar yoki uchinchi shaxslarning sog'lig'iga yetkazilgan jismoniy zarar, jarohatlar yoki o'lim holatlari uchun mutlaqo javobgarlikni o'z zimmasiga olmaydi.",
      "Safar vaqtida xavfsizlik, yo'l harakati qoidalariga rioya qilish va yo'lovchining sog'lig'i uchun barcha javobgarlik transport vositasini boshqarayotgan mustaqil haydovchi zimmasidadir.",
      "Moliyaviy va moddiy zarar: Safar davomida yo'qolgan, unutilgan yoki shikastlangan buyumlar uchun ilova ma'muriyati javobgar emas. Foydalanuvchilar o'zaro kelishmovchiliklarni amaldagi qonunchilik doirasida, mustaqil ravishda hal qiladilar.",
    ],
  },
  {
    heading: '4. Tomonlarning huquq va majburiyatlari',
    paragraphs: [
      "Haydovchi: Yo'l harakati qoidalariga amal qilishi, avtomobilining texnik sozligini ta'minlashi va yo'lovchiga xavfsiz xizmat ko'rsatishi shart. Shuningdek, ilova komissiyasini o'z vaqtida to'lab borishi lozim.",
      "Yo'lovchi: Buyurtma berishda manzil va qo'shimcha shartlarni to'g'ri ko'rsatishi, safar haqini haydovchiga kelishilgan miqdorda to'lashi shart.",
      "Ilova ma'muriyati: Ilovaning uzluksiz ishlashini ta'minlaydi. Qoidalarni buzgan, soxta buyurtma bergan yoki komissiya to'lamagan foydalanuvchi/haydovchilarni ogohlantirishsiz bloklash huquqiga ega.",
    ],
  },
  {
    heading: '5. Maxfiylik siyosati (Ma\'lumotlar himoyasi)',
    paragraphs: [
      "Geolokatsiya: Ilova buyurtmalarni to'g'ri shakllantirish va haydovchi hamda yo'lovchining xaritadagi joylashuvini aniqlash uchun geolokatsiya ma'lumotlaridan (fonda va faol holatda) foydalanadi.",
      "Shaxsiy ma'lumotlar: Ro'yxatdan o'tish paytida olingan telefon raqamlari, ism-shariflar va haydovchilik hujjatlari uchinchi shaxslarga tarqatilmaydi va faqat ilova xavfsizligi hamda xizmat sifatini oshirish uchun ishlatiladi.",
    ],
  },
  {
    heading: '6. Shartlarga o\'zgartirish kiritish',
    paragraphs: [
      "„Sarix Go\" ma'muriyati ushbu shartlarni va komissiya foizlarini istalgan vaqtda bir tomonlama o'zgartirish huquqini saqlab qoladi. Yangilangan shartlar ilovada e'lon qilingan paytdan boshlab kuchga kiradi.",
    ],
  },
];

export default function TermsScreen() {
  const colors = useThemeStore((s) => s.colors);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Foydalanish shartlari</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
        <Text style={[styles.docTitle, { color: colors.primary }]}>
          „Sarix Go" ilovasidan foydalanish shartlari va maxfiylik siyosati
        </Text>
        <Text style={[styles.updated, { color: colors.textSecondary }]}>
          Oxirgi yangilanish sanasi: 13.06.2026
        </Text>

        <Text style={[styles.intro, { color: colors.text }]}>
          „Sarix Go" mobil ilovasidan (keyingi o'rinlarda — „Ilova") foydalanishni
          boshlashingizdan oldin ushbu shartlar bilan diqqat bilan tanishib chiqing.
          Ilovada ro'yxatdan o'tish orqali siz ushbu shartlarga to'liq rozilik bildirgan
          hisoblanasiz.
        </Text>

        {SECTIONS.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={[styles.sectionHeading, { color: colors.primary }]}>
              {section.heading}
            </Text>
            {section.paragraphs.map((p, j) => (
              <Text key={j} style={[styles.paragraph, { color: colors.text }]}>
                {p}
              </Text>
            ))}
          </View>
        ))}
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
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  docTitle: { ...typography.h3, marginBottom: spacing.xs },
  updated: { ...typography.small, marginBottom: spacing.md },
  intro: { ...typography.body, lineHeight: 22, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionHeading: { ...typography.bodyBold, fontWeight: '700', marginBottom: spacing.sm },
  paragraph: { ...typography.body, lineHeight: 22, marginBottom: spacing.sm },
});
