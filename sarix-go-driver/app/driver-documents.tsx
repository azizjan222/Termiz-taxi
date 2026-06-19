import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '../src/components/Button';
import {
  uploadLicenseImage,
  uploadTechPassport,
  uploadCarPhoto,
  submitDocuments,
} from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { colors, typography, spacing, radius } from '../src/theme';

type DocKey = 'license' | 'tech' | 'car';

const DOCS: { key: DocKey; title: string; hint: string; icon: string }[] = [
  { key: 'license', title: 'Haydovchilik guvohnomasi', hint: 'Guvohnoma rasmini yuklang', icon: '🪪' },
  { key: 'tech', title: 'Texnik pasport', hint: 'Mashina texpasporti rasmini yuklang', icon: '📋' },
  { key: 'car', title: 'Mashina rasmi', hint: 'Mashinangiz rasmini yuklang', icon: '🚗' },
];

const uploaders: Record<DocKey, (uri: string) => Promise<{ url: string }>> = {
  license: uploadLicenseImage,
  tech: uploadTechPassport,
  car: uploadCarPhoto,
};

export default function DriverDocumentsScreen() {
  const setDriver = useDriverStore((s) => s.setDriver);
  const [uris, setUris] = useState<Record<DocKey, string | null>>({ license: null, tech: null, car: null });
  const [uploaded, setUploaded] = useState<Record<DocKey, boolean>>({ license: false, tech: false, car: false });
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickAndUpload = async (key: DocKey) => {
    if (uploading) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Ruxsat kerak', 'Rasm tanlash uchun galereyaga ruxsat bering.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const uri = result.assets[0].uri;
      setUris((p) => ({ ...p, [key]: uri }));
      setUploaded((p) => ({ ...p, [key]: false }));
      setUploading(key);
      await uploaders[key](uri);
      setUploaded((p) => ({ ...p, [key]: true }));
    } catch (e: any) {
      Alert.alert('Xatolik', e?.response?.data?.error || "Rasm yuklanmadi. Qayta urinib ko'ring.");
    } finally {
      setUploading(null);
    }
  };

  const allDone = uploaded.license && uploaded.tech && uploaded.car;

  const handleSubmit = async () => {
    if (!allDone) {
      Alert.alert('Diqqat', 'Barcha hujjatlarni yuklang.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitDocuments();
      if (res?.driver) setDriver(res.driver);
      Alert.alert('Tayyor ✅', 'Hujjatlaringiz qabul qilindi.', [
        { text: 'Davom etish', onPress: () => router.replace('/(main)/orders') },
      ]);
    } catch (e: any) {
      Alert.alert('Xatolik', e?.response?.data?.error || "Hujjatlarni yuborib bo'lmadi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>📄</Text>
        <Text style={styles.title}>Hujjatlarni yuklang</Text>
        <Text style={styles.subtitle}>
          Ilovadan to'liq foydalanish uchun hujjatlaringizni shu yerda yuklang —
          bot kerak emas.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {DOCS.map((doc) => (
          <TouchableOpacity
            key={doc.key}
            style={styles.docCard}
            onPress={() => pickAndUpload(doc.key)}
            activeOpacity={0.85}
            disabled={!!uploading}
          >
            {uris[doc.key] ? (
              <Image source={{ uri: uris[doc.key] as string }} style={styles.preview} />
            ) : (
              <View style={styles.iconBox}>
                <Text style={styles.docIcon}>{doc.icon}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.docTitle}>{doc.title}</Text>
              <Text style={styles.docHint}>{doc.hint}</Text>
            </View>
            {uploading === doc.key ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : uploaded[doc.key] ? (
              <Text style={styles.check}>✅</Text>
            ) : (
              <Text style={styles.plus}>＋</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={allDone ? '✅ Tasdiqlash' : 'Avval barcha hujjatlarni yuklang'}
          onPress={handleSubmit}
          loading={submitting}
          variant={allDone ? 'success' : 'outline'}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, alignItems: 'center' },
  headerEmoji: { fontSize: 40, marginBottom: spacing.sm },
  title: { ...typography.h2, color: colors.text },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  scroll: { padding: spacing.lg, gap: spacing.md },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: spacing.md,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIcon: { fontSize: 28 },
  preview: { width: 56, height: 56, borderRadius: radius.sm },
  docTitle: { ...typography.bodyBold, color: colors.text },
  docHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  check: { fontSize: 22 },
  plus: { fontSize: 28, color: colors.primary, fontWeight: '700' },
  footer: { padding: spacing.lg },
});
