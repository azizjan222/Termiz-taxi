import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert, ScrollView,
  TextInput, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { API_URL, getAuthToken } from '../src/api/client';
import { useDriverStore } from '../src/store/driver';
import {
  getMe, updateDriverInfo, uploadTechPassport, uploadLicenseImage, getCarModels,
} from '../src/api/driver';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
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

// In-app driver registration-completion form. Mirrors the bot's fields EXCEPT the car
// photo (mashinaning rasmi), which is intentionally not collected here.
export default function DriverInfoScreen() {
  const { t } = useTranslation();
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [pinfl, setPinfl] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [carModel, setCarModel] = useState('');
  const [carYear, setCarYear] = useState('');

  // Contact number shown to passengers on orders (defaults to the registered number).
  const [displayNumber, setDisplayNumber] = useState('');
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [newPhone, setNewPhone] = useState('+998 ');
  const [contactToSave, setContactToSave] = useState<string | null>(null);

  const [techUri, setTechUri] = useState<string | null>(null);
  const [licenseUri, setLicenseUri] = useState<string | null>(null);
  const [documentToken, setDocumentToken] = useState<string | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Pre-fill from cached driver first, then refresh from /api/driver/me.
    const fill = (d: any) => {
      if (!d) return;
      setFirstName(d.first_name || '');
      setLastName(d.last_name || '');
      setPinfl(d.pinfl || '');
      setCarNumber(d.car_number || '');
      setCarModel(d.car_model || '');
      setCarYear(d.car_year || '');
      setDisplayNumber(d.contact_phone || d.phone || '');
      if (d.tech_passport_url) {
        setTechUri(d.tech_passport_url.startsWith('http') ? d.tech_passport_url : `${API_URL}${d.tech_passport_url}`);
      }
      if (d.license_photo_url) {
        setLicenseUri(d.license_photo_url.startsWith('http') ? d.license_photo_url : `${API_URL}${d.license_photo_url}`);
      }
    };
    fill(driver);
    getAuthToken().then(setDocumentToken).catch(() => setDocumentToken(null));
    getMe().then((d) => { fill(d); setDriver(d); }).catch(() => {});
    getCarModels().then((r) => setModels(r.models)).catch(() => {});
    // Prefill from the current driver once on mount, then refresh from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickImage = async (setter: (uri: string) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('❌', 'Galereyaga ruxsat kerak');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) setter(result.assets[0].uri);
  };

  const save = async () => {
    if (!firstName.trim()) {
      Alert.alert('❌', 'Ismni kiriting');
      return;
    }
    if (pinfl && pinfl.replace(/\D/g, '').length !== 14) {
      Alert.alert('❌', 'JSHSHIR 14 ta raqamdan iborat bo\'lishi kerak');
      return;
    }
    setSaving(true);
    try {
      // 1) Save text fields.
      const { driver: updated } = await updateDriverInfo({
        first_name: firstName,
        last_name: lastName,
        ...(contactToSave ? { contact_phone: contactToSave } : {}),
        pinfl,
        car_number: carNumber,
        car_model: carModel,
        car_year: carYear,
      });
      // 2) Upload new local images (skip ones that are already remote http URLs).
      if (techUri && !techUri.startsWith('http')) {
        try { await uploadTechPassport(techUri); } catch {}
      }
      if (licenseUri && !licenseUri.startsWith('http')) {
        try { await uploadLicenseImage(licenseUri); } catch {}
      }
      // Refresh the store from the server so everything stays in sync.
      try { const fresh = await getMe(); setDriver(fresh); } catch { setDriver(updated); }
      Alert.alert('✅', 'Ma\'lumotlaringiz saqlandi', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('❌', e?.response?.data?.error || 'Saqlab bo\'lmadi');
    } finally {
      setSaving(false);
    }
  };

  const saveNewNumber = () => {
    if (!isValidPhone(newPhone)) return;
    setContactToSave('+998' + localDigits(newPhone));
    setDisplayNumber(formatPhone(newPhone));
    setPhoneEditing(false);
  };
  const startEditingPhone = () => {
    setNewPhone(displayNumber && displayNumber.startsWith('+998') ? formatPhone(displayNumber) : '+998 ');
    setPhoneEditing(true);
  };

  const filteredModels = search
    ? models.filter((m) => m.toLowerCase().includes(search.toLowerCase()))
    : models;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Ma'lumotlarim</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Botda ro'yxatdan o'tganingizdan so'ng ma'lumotlaringizni shu yerda
          to'ldiring/yangilang. Mashina rasmini bu yerda so'ramaymiz.
        </Text>

        <Text style={styles.label}>Ism</Text>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholder="Ism" />

        <Text style={styles.label}>Familiya</Text>
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} placeholder="Familiya" />

        {/* Contact-number card: shown to passengers on orders; confirm it works or change it. */}
        <View style={styles.contactCard}>
          <View style={styles.contactTop}>
            <View style={styles.phoneBadge}><Text style={styles.phoneBadgeIcon}>📞</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactLabel}>{t('contact.title')}</Text>
              <Text style={styles.contactNumber}>{displayNumber || '—'}</Text>
            </View>
          </View>
          {phoneEditing ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.label}>{t('contact.newLabel')}</Text>
              <TextInput
                style={styles.input}
                value={newPhone}
                onChangeText={(v) => setNewPhone(formatPhone(v))}
                keyboardType="phone-pad"
                placeholder="+998 90 123 45 67"
                autoFocus
              />
              <Button
                title={t('contact.save')}
                onPress={saveNewNumber}
                disabled={!isValidPhone(newPhone)}
                variant="accent"
                style={{ marginTop: spacing.sm, opacity: isValidPhone(newPhone) ? 1 : 0.5 }}
              />
              <TouchableOpacity style={styles.phoneCancel} onPress={() => setPhoneEditing(false)} activeOpacity={0.7}>
                <Text style={styles.phoneCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.contactQuestion}>{t('contact.question')}</Text>
              <TouchableOpacity style={styles.changeBtn} onPress={startEditingPhone} activeOpacity={0.85}>
                <Text style={styles.changeBtnText}>{t('contact.change')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.label}>JSHSHIR (14 raqam)</Text>
        <TextInput style={styles.input} value={pinfl} onChangeText={setPinfl} placeholder="JSHSHIR" keyboardType="number-pad" maxLength={14} />

        <Text style={styles.label}>Mashina raqami</Text>
        <TextInput style={styles.input} value={carNumber} onChangeText={setCarNumber} placeholder="90A123BC" autoCapitalize="characters" />

        <Text style={styles.label}>Modeli</Text>
        <TouchableOpacity style={styles.input} onPress={() => { setSearch(''); setPickerOpen(true); }}>
          <Text style={carModel ? styles.pickerValue : styles.pickerPlaceholder}>
            {carModel || 'Modelni tanlang'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Ishlab chiqarilgan yili</Text>
        <TextInput style={styles.input} value={carYear} onChangeText={setCarYear} placeholder="2018" keyboardType="number-pad" maxLength={4} />

        <Text style={styles.label}>Texnik pasport surati</Text>
        {techUri ? <Image source={{ uri: techUri, headers: documentToken ? { Authorization: `Bearer ${documentToken}` } : undefined }} style={styles.preview} /> : null}
        <Button title="📄 Texpasport surati" onPress={() => pickImage(setTechUri)} variant="outline" />

        <Text style={[styles.label, { marginTop: spacing.md }]}>Haydovchilik guvohnomasi surati</Text>
        {licenseUri ? <Image source={{ uri: licenseUri, headers: documentToken ? { Authorization: `Bearer ${documentToken}` } : undefined }} style={styles.preview} /> : null}
        <Button title="🪪 Guvohnoma surati" onPress={() => pickImage(setLicenseUri)} variant="outline" />

        <Button title="✅ Saqlash" onPress={save} loading={saving} variant="accent" style={{ marginTop: spacing.lg }} />
      </ScrollView>

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.backBtn}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Modelni tanlang</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ padding: spacing.md }}>
            <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Qidirish..." />
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
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
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
  pickerValue: { fontSize: 16, color: colors.text },
  pickerPlaceholder: { fontSize: 16, color: colors.textMuted },
  contactCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  contactTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  phoneBadge: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EDE7FF',
    alignItems: 'center', justifyContent: 'center',
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
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  modelRow: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.white,
  },
  modelText: { ...typography.body, color: colors.text },
});
