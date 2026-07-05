import React, { useEffect, useState, useMemo } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
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
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius, gradients } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// Pretty +998 formatter: fixed "+998 " prefix + grouped 9 local digits.
const formatPhone = (text: string): string => {
  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  digits = digits.slice(0, 9);
  let out = '+998';
  if (digits.length > 0) out += ' ' + digits.slice(0, 2);
  if (digits.length > 2) out += ' ' + digits.slice(2, 5);
  if (digits.length > 5) out += ' ' + digits.slice(5, 7);
  if (digits.length > 7) out += ' ' + digits.slice(7, 9);
  return out;
};
const localDigits = (text: string) => text.replace(/\D/g, '').replace(/^998/, '');
const isValidPhone = (text: string) => localDigits(text).length === 9;

type DocKey = 'licenseFront' | 'licenseBack' | 'techFront' | 'techBack';

interface DocSpec {
  key: DocKey;
  title: string;
  side: string;
  emoji: string;
  guide: string;
}

const DOCS: DocSpec[] = [
  { key: 'licenseFront', title: 'Haydovchilik guvohnomasi', side: 'Old tomoni', emoji: '🪪', guide: 'Rasm va familiya ko\'rinsin' },
  { key: 'licenseBack', title: 'Haydovchilik guvohnomasi', side: 'Orqa tomoni', emoji: '🪪', guide: 'Toifalar (B, C...) ko\'rinsin' },
  { key: 'techFront', title: 'Texnik pasport', side: 'Old tomoni', emoji: '📋', guide: 'Davlat raqami ko\'rinsin' },
  { key: 'techBack', title: 'Texnik pasport', side: 'Orqa tomoni', emoji: '📋', guide: 'Egasi ma\'lumoti ko\'rinsin' },
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
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Personal info — first name is required, surname is optional.
  const [firstName, setFirstName] = useState(driver?.first_name || '');
  const [lastName, setLastName] = useState(driver?.last_name || '');

  // Contact number shown to passengers. Defaults to the registered (login) number;
  // the driver confirms it or changes it here (variant A).
  const [displayNumber, setDisplayNumber] = useState(driver?.contact_phone || driver?.phone || '');
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [newPhone, setNewPhone] = useState('+998 ');

  const [carModel, setCarModel] = useState(driver?.car_model || '');
  const [carYear, setCarYear] = useState(driver?.car_year || '');
  const [carNumber, setCarNumber] = useState(driver?.car_number || '');

  const [uris, setUris] = useState<Record<DocKey, string | null>>({
    licenseFront: null, licenseBack: null, techFront: null, techBack: null,
  });
  const [uploaded, setUploaded] = useState<Record<DocKey, boolean>>({
    licenseFront: false, licenseBack: false, techFront: false, techBack: false,
  });
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const saveNewNumber = () => {
    if (!isValidPhone(newPhone)) return;
    setDisplayNumber('+998' + localDigits(newPhone));
    setPhoneEditing(false);
  };
  const startEditingPhone = () => {
    setNewPhone(displayNumber && displayNumber.startsWith('+998') ? formatPhone(displayNumber) : '+998 ');
    setPhoneEditing(true);
  };

  const allUploaded = uploaded.licenseFront && uploaded.licenseBack && uploaded.techFront && uploaded.techBack;
  const allDone =
    !!firstName.trim() && isValidPhone(displayNumber) && !!carModel.trim() &&
    !!carYear.trim() && !!carNumber.trim() && allUploaded;

  const handleSubmit = async () => {
    if (!firstName.trim()) {
      Alert.alert('Diqqat', 'Ismingizni kiriting.');
      return;
    }
    if (!isValidPhone(displayNumber)) {
      Alert.alert('Diqqat', "Bog'lanish uchun to'g'ri telefon raqamini kiriting.");
      return;
    }
    if (!carModel.trim() || !carYear.trim() || !carNumber.trim()) {
      Alert.alert('Diqqat', 'Mashina markasi, yili va davlat raqamini kiriting.');
      return;
    }
    if (!allUploaded) {
      Alert.alert('Diqqat', 'Barcha hujjatlarning ikkala tomonini yuklang.');
      return;
    }
    setSubmitting(true);
    try {
      await updateDriverInfo({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        contact_phone: '+998' + localDigits(displayNumber),
        car_model: carModel.trim(),
        car_year: carYear.trim(),
        car_number: carNumber.trim().toUpperCase(),
      });
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
        <View style={[styles.frame, isUp && styles.frameDone]}>
          {uri ? (
            <Image source={{ uri }} style={styles.framePreview} />
          ) : (
            <>
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
      {/* Gradient header */}
      <LinearGradient
        colors={gradients.purple}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerIconCircle}>
          <Text style={styles.headerEmoji}>📄</Text>
        </View>
        <Text style={styles.title}>Hujjatlarni yuklang</Text>
        <Text style={styles.subtitle}>
          Ilovadan to'liq foydalanish uchun ma'lumot va hujjatlaringizni kiriting
        </Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* How-to banner */}
        <View style={styles.tipCard}>
          <Text style={styles.tipIcon}>💡</Text>
          <Text style={styles.tipText}>
            Hujjatni tekis yuzaga qo'ying, yaxshi yorug'likda, barcha ma'lumotlar aniq
            o'qiladigan holatda suratga oling. Soya yoki yorqin aks tushmasin.
          </Text>
        </View>

        {/* Personal info */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>👤 Shaxsiy ma'lumotlar</Text>

          <Text style={styles.label}>
            Ism <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Ismingiz"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            maxLength={50}
          />

          <Text style={styles.label}>
            Familiya <Text style={styles.optional}>(ixtiyoriy)</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Familiyangiz"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            maxLength={50}
          />

          {/* Contact number shown to passengers on orders. Defaults to the
              registered number; the driver confirms or changes it here. */}
          <View style={styles.contactCard}>
            <View style={styles.contactTop}>
              <View style={styles.phoneBadge}><Text style={styles.phoneBadgeIcon}>📞</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactLabel}>Bog'lanish uchun raqam</Text>
                <Text style={styles.contactNumber}>{displayNumber ? formatPhone(displayNumber) : '—'}</Text>
              </View>
            </View>
            {phoneEditing ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.label}>Yangi raqam</Text>
                <TextInput
                  style={styles.input}
                  value={newPhone}
                  onChangeText={(v) => setNewPhone(formatPhone(v))}
                  keyboardType="phone-pad"
                  placeholder="+998 90 123 45 67"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
                <Button
                  title="Saqlash"
                  onPress={saveNewNumber}
                  disabled={!isValidPhone(newPhone)}
                  variant="accent"
                  style={{ marginTop: spacing.sm, opacity: isValidPhone(newPhone) ? 1 : 0.5 }}
                />
                <TouchableOpacity style={styles.phoneCancel} onPress={() => setPhoneEditing(false)} activeOpacity={0.7}>
                  <Text style={styles.phoneCancelText}>Bekor qilish</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.contactQuestion}>
                  Yo'lovchilar shu raqam orqali bog'lanadi. To'g'ri bo'lsa davom eting, aks holda o'zgartiring.
                </Text>
                <TouchableOpacity style={styles.changeBtn} onPress={startEditingPhone} activeOpacity={0.85}>
                  <Text style={styles.changeBtnText}>Raqamni o'zgartirish</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Car info */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🚗 Mashina ma'lumotlari</Text>

          <Text style={styles.label}>Markasi (modeli)</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => { setSearch(''); setPickerOpen(true); }}
            activeOpacity={0.8}
          >
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

          <Text style={styles.label}>Davlat raqami</Text>
          <TextInput
            style={styles.input}
            value={carNumber}
            onChangeText={(t) => setCarNumber(t.toUpperCase())}
            placeholder="01A123BC"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={10}
          />
        </View>

        {/* License */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🪪 Haydovchilik guvohnomasi</Text>
          <Text style={styles.sectionHint}>Ikkala tomonini ham suratga oling</Text>
          <View style={styles.slotRow}>
            {renderSlot(DOCS[0])}
            {renderSlot(DOCS[1])}
          </View>
        </View>

        {/* Tech passport */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>📋 Texnik pasport</Text>
          <Text style={styles.sectionHint}>Ikkala tomonini ham suratga oling</Text>
          <View style={styles.slotRow}>
            {renderSlot(DOCS[2])}
            {renderSlot(DOCS[3])}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={allDone ? '✅ Tasdiqlash' : "Avval barcha maydonlarni to'ldiring"}
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },

  // Gradient header
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  headerIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  headerEmoji: { fontSize: 32 },
  title: { ...typography.h2, color: colors.textOnPrimary },
  subtitle: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },

  tipCard: {
    flexDirection: 'row',
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.accentLight,
  },
  tipIcon: { fontSize: 20 },
  tipText: { flex: 1, ...typography.caption, color: colors.accentDark, lineHeight: 18 },

  // Card section wrapper
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: '#0E1730',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionTitle: { ...typography.bodyBold, color: colors.text, fontSize: 16, marginBottom: spacing.sm },
  sectionHint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },

  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 4, marginTop: spacing.sm },
  required: { color: colors.error, fontWeight: '800' },
  optional: { color: colors.textMuted },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    minHeight: 48,
    justifyContent: 'center',
  },
  inputValue: { fontSize: 16, color: colors.text },
  inputPlaceholder: { fontSize: 16, color: colors.textMuted },

  // Contact-number card
  contactCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  contactTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  phoneBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneBadgeIcon: { fontSize: 20 },
  contactLabel: { ...typography.caption, color: colors.textSecondary },
  contactNumber: { ...typography.h3, color: colors.text, marginTop: 2, letterSpacing: 0.5 },
  contactQuestion: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, lineHeight: 19 },
  changeBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  changeBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  phoneCancel: { alignSelf: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  phoneCancelText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },

  // Document slots
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
  doneBadgeText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  slotSide: { ...typography.bodyBold, color: colors.text, marginTop: spacing.sm, fontSize: 14 },
  slotGuide: { ...typography.small, color: colors.textSecondary, marginTop: 1 },

  footer: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },

  // Picker modal
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  pickerTitle: { ...typography.h3, color: colors.primary },
  modelRow: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.background,
  },
  modelText: { ...typography.body, color: colors.text },
});
