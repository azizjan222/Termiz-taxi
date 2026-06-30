import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert, ScrollView,
  TextInput, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '../src/components/Button';
import { API_URL } from '../src/api/client';
import { useDriverStore } from '../src/store/driver';
import {
  getMe, updateDriverInfo, uploadTechPassport, uploadLicenseImage, getCarModels,
} from '../src/api/driver';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// In-app driver registration-completion form. Mirrors the bot's fields EXCEPT the car
// photo (mashinaning rasmi), which is intentionally not collected here.
export default function DriverInfoScreen() {
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

  const [techUri, setTechUri] = useState<string | null>(null);
  const [licenseUri, setLicenseUri] = useState<string | null>(null);

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
      if (d.tech_passport_url) {
        setTechUri(d.tech_passport_url.startsWith('http') ? d.tech_passport_url : `${API_URL}${d.tech_passport_url}`);
      }
      if (d.license_photo_url) {
        setLicenseUri(d.license_photo_url.startsWith('http') ? d.license_photo_url : `${API_URL}${d.license_photo_url}`);
      }
    };
    fill(driver);
    getMe().then((d) => { fill(d); setDriver(d); }).catch(() => {});
    getCarModels().then((r) => setModels(r.models)).catch(() => {});
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
        {techUri ? <Image source={{ uri: techUri }} style={styles.preview} /> : null}
        <Button title="📄 Texpasport surati" onPress={() => pickImage(setTechUri)} variant="outline" />

        <Text style={[styles.label, { marginTop: spacing.md }]}>Haydovchilik guvohnomasi surati</Text>
        {licenseUri ? <Image source={{ uri: licenseUri }} style={styles.preview} /> : null}
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
