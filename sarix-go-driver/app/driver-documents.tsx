import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '../src/components/Button';
import {
  uploadLicenseImage,
  uploadLicenseBack,
  uploadTechPassport,
  uploadTechPassportBack,
  updateDriverInfo,
  submitDocuments,
  getCarModels,
} from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { colors, typography, spacing, radius } from '../src/theme';

type DocKey = 'licenseFront' | 'licenseBack' | 'techFront' | 'techBack';

interface DocSpec {
  key: DocKey;
  title: string;
  side: string; // "Old tomoni" / "Orqa tomoni"
  emoji: string;
  // Short instruction on what must be visible / how to hold the document.
  guide: string;
}

const DOCS: DocSpec[] = [
  {
    key: 'licenseFront',
    title: 'Haydovchilik guvohnomasi',
    side: 'Old tomoni',
    emoji: '🪪',
    guide: 'Rasm va familiya ko\'rinsin',
  },
  {
    key: 'licenseBack',
    title: 'Haydovchilik guvohnomasi',
    side: 'Orqa tomoni',
    emoji: '🪪',
    guide: 'Toifalar (B, C...) ko\'rinsin',
  },
  {
    key: 'techFront',
    title: 'Texnik pasport',
    side: 'Old tomoni',
    emoji: '📋',
    guide: 'Davlat raqami ko\'rinsin',
  },
  {
    key: 'techBack',
    title: 'Texnik pasport',
    side: 'Orqa tomoni',
    emoji: '📋',
    guide: 'Egasi ma\'lumoti ko\'rinsin',
  },
];

const uploaders: Record<DocKey, (uri: string) => Promise<{ url: string }>> = {
  licenseFront: uploadLicenseImage,
  licenseBack: uploadLicenseBack,
  techFront: uploadTechPassport,
  techBack: uploadTechPassportBack,
};

export default function DriverDocumentsScreen() {
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);

  const [carModel, setCarModel] = useState(driver?.car_model || '');
  const [carYear, setCarYear] = useState(driver?.car_year || '');

  const [uris, setUris] = useState<Record<DocKey, string | null>>({
    licenseFront: null, licenseBack: null, techFront: null, techBack: null,
  });
  const [uploaded, setUploaded] = useState<Record<DocKey, boolean>>({
    licenseFront: false, licenseBack: false, techFront: false, techBack: false,
  });
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Car model picker
  const [models, setModels] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    getCarModels().then((r) => setModels(r.models)).catch(() => {});
  }, []);

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

  const allUploaded = uploaded.licenseFront && uploaded.licenseBack && uploaded.techFront && uploaded.techBack;
  const allDone = !!carModel.trim() && !!carYear.trim() && allUploaded;

  const handleSubmit = async () => {
    if (!carModel.trim() || !carYear.trim()) {
      Alert.alert('Diqqat', 'Mashina markasi va yilini kiriting.');
      return;
    }
    if (!allUploaded) {
      Alert.alert('Diqqat', 'Barcha hujjatlarning ikkala tomonini yuklang.');
      return;
    }
    setSubmitting(true);
    try {
      // 1) Save car info first (the submit endpoint requires model + year).
      await updateDriverInfo({ car_model: carModel.trim(), car_year: carYear.trim() });
      // 2) Finalize — unlocks app access.
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

  const filteredModels = search
    ? models.filter((m) => m.toLowerCase().includes(search.toLowerCase()))
    : models;

  const renderSlot = (doc: DocSpec) => {
    const uri = uris[doc.key];
    const isUp = uploaded[doc.key];
    const busy = uploading === doc.key;
    return (
      <TouchableOpacity
        key={doc.key}
        style={styles.slot}
        onPress={() => pickAndUpload(doc.key)}
        activeOpacity={0.85}
        disabled={!!uploading}
      >
        {/* Photo frame / preview */}
        <View style={[styles.frame, isUp && styles.frameDone]}>
          {uri ? (
            <Image source={{ uri }} style={styles.framePreview} />
          ) : (
            <>
              {/* Document orientation illustration (how to lay it) */}
              <View style={styles.docIllustration}>
                <Text style={styles.docIllustrationEmoji}>{doc.emoji}</Text>
                <View style={styles.docLines}>
                  <View style={[styles.docLine, { width: '70%' }]} />
                  <View style={[styles.docLine, { width: '45%' }]} />
                </View>
              </View>
              <Text style={styles.frameHint}>📷 Suratga olish</Text>
            </>
          )}
          {busy && (
            <View style={styles.frameOverlay}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
          {isUp && !busy && (
            <View style={styles.doneBadge}>
              <Text style={styles.doneBadgeText}>✓</Text>
            </View>
          )}
        </View>
        <Text style={styles.slotSide}>{doc.side}</Text>
        <Text style={styles.slotGuide}>{doc.guide}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>📄</Text>
        <Text style={styles.title}>Hujjatlarni yuklang</Text>
        <Text style={styles.subtitle}>
          Ilovadan to'liq foydalanish uchun hujjatlaringizni yuklang.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* How-to banner */}
        <View style={styles.tipCard}>
          <Text style={styles.tipIcon}>💡</Text>
          <Text style={styles.tipText}>
            Hujjatni tekis yuzaga qo'ying, yaxshi yorug'likda, barcha ma'lumotlar
            aniq o'qiladigan holatda suratga oling. Soya yoki yorqin aks tushmasin.
          </Text>
        </View>

        {/* Car info */}
        <Text style={styles.sectionTitle}>🚗 Mashina ma'lumotlari</Text>
        <Text style={styles.label}>Markasi (modeli)</Text>
        <TouchableOpacity style={styles.input} onPress={() => { setSearch(''); setPickerOpen(true); }} activeOpacity={0.8}>
          <Text style={carModel ? styles.inputValue : styles.inputPlaceholder}>
            {carModel || 'Modelni tanlang'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Ishlab chiqarilgan yili</Text>
        <TextInput
          style={styles.input}
          value={carYear}
          onChangeText={setCarYear}
          placeholder="2018"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={4}
        />

        {/* License */}
        <Text style={styles.sectionTitle}>🪪 Haydovchilik guvohnomasi</Text>
        <Text style={styles.sectionHint}>Ikkala tomonini ham suratga oling</Text>
        <View style={styles.slotRow}>
          {renderSlot(DOCS[0])}
          {renderSlot(DOCS[1])}
        </View>

        {/* Tech passport */}
        <Text style={styles.sectionTitle}>📋 Texnik pasport</Text>
        <Text style={styles.sectionHint}>Ikkala tomonini ham suratga oling</Text>
        <View style={styles.slotRow}>
          {renderSlot(DOCS[2])}
          {renderSlot(DOCS[3])}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={allDone ? '✅ Tasdiqlash' : 'Avval barcha maydonlarni to\'ldiring'}
          onPress={handleSubmit}
          loading={submitting}
          variant={allDone ? 'success' : 'outline'}
        />
      </View>

      {/* Car model picker */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.backBtn}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>Modelni tanlang</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ padding: spacing.md }}>
            <TextInput
              style={styles.input}
              value={search}
              onChangeText={setSearch}
              placeholder="Qidirish..."
              placeholderTextColor={colors.textMuted}
            />
          </View>
          {models.length === 0 ? (
            <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary} />
          ) : (
            <FlatList
              data={filteredModels}
              keyExtractor={(item, i) => item + i}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modelRow}
                  onPress={() => { setCarModel(item); setPickerOpen(false); }}
                >
                  <Text style={styles.modelText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, alignItems: 'center' },
  headerEmoji: { fontSize: 36, marginBottom: spacing.xs },
  title: { ...typography.h2, color: colors.text },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  tipCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF8E1',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  tipIcon: { fontSize: 20 },
  tipText: { flex: 1, ...typography.caption, color: '#8D6E00', lineHeight: 18 },

  sectionTitle: { ...typography.bodyBold, color: colors.text, fontSize: 16, marginTop: spacing.md },
  sectionHint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },

  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 4, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    minHeight: 46,
    justifyContent: 'center',
  },
  inputValue: { fontSize: 16, color: colors.text },
  inputPlaceholder: { fontSize: 16, color: colors.textMuted },

  // Document slots (two side by side)
  slotRow: { flexDirection: 'row', gap: spacing.md },
  slot: { flex: 1 },
  frame: {
    aspectRatio: 1.4,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  frameDone: { borderColor: colors.success, borderStyle: 'solid' },
  framePreview: { width: '100%', height: '100%' },
  frameOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIllustration: { alignItems: 'center', justifyContent: 'center' },
  docIllustrationEmoji: { fontSize: 30, marginBottom: 6 },
  docLines: { width: 64, gap: 4, alignItems: 'center' },
  docLine: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  frameHint: { ...typography.small, color: colors.primary, marginTop: 8, fontWeight: '600' },
  doneBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBadgeText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  slotSide: { ...typography.bodyBold, color: colors.text, marginTop: spacing.sm, fontSize: 14 },
  slotGuide: { ...typography.small, color: colors.textSecondary, marginTop: 1 },

  footer: { padding: spacing.lg },

  // Picker modal
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  pickerTitle: { ...typography.h3, color: colors.primary },
  modelRow: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.white,
  },
  modelText: { ...typography.body, color: colors.text },
});
