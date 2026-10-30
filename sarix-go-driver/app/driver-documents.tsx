import React, { useEffect, useRef, useState, useMemo } from 'react';
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
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import {
  uploadLicenseImage,
  uploadLicenseBack,
  uploadTechPassport,
  uploadTechPassportBack,
  updateDriverInfo,
  submitDocuments,
  getCarModels,
  DEFAULT_CAR_MODELS,
} from '../src/api/driver';
import { describeApiError } from '../src/api/errors';
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
const isValidPhone = (text: string) => !text.startsWith('google:') && localDigits(text).length === 9;

// Local mirrors of the backend's document limits (app/services/image_check.py), kept only so
// an unusable photo is refused before it costs an upload. The backend stays authoritative —
// these numbers must never be stricter than its own.
const MIN_DOC_SIDE_PX = 400;
const MAX_DOC_ASPECT = 4.0;

const POPULAR_CAR_COLORS: { label: string; hex: string; border?: string }[] = [
  { label: 'Oq', hex: '#FFFFFF', border: '#CBD5E1' },
  { label: 'Qora', hex: '#111827' },
  { label: 'Kulrang', hex: '#6B7280' },
  { label: 'Kumushrang', hex: '#CBD5E1' },
  { label: "Ko'k", hex: '#2563EB' },
  { label: 'Qizil', hex: '#DC2626' },
];

const QUICK_CAR_MODELS = [
  'Chevrolet Cobalt',
  'Chevrolet Gentra / Lacetti',
  'Chevrolet Onix',
  'Chevrolet Tracker 2',
  'Chevrolet Monza',
  'BYD Song Plus DM-i / Champion',
  'Chevrolet Damas',
];

type DocKey = 'licenseFront' | 'licenseBack' | 'techFront' | 'techBack';

interface DocSpec {
  key: DocKey;
  sideKey: string;
  icon: IconName;
  guideKey: string;
}

const DOCS: DocSpec[] = [
  { key: 'licenseFront', sideKey: 'docs.sideFront', icon: 'idCard', guideKey: 'docs.guideLicenseFront' },
  { key: 'licenseBack', sideKey: 'docs.sideBack', icon: 'idCard', guideKey: 'docs.guideLicenseBack' },
  { key: 'techFront', sideKey: 'docs.sideFront', icon: 'document', guideKey: 'docs.guideTechFront' },
  { key: 'techBack', sideKey: 'docs.sideBack', icon: 'document', guideKey: 'docs.guideTechBack' },
];

const uploaders: Record<DocKey, (uri: string) => Promise<{ url: string }>> = {
  licenseFront: uploadLicenseImage,
  licenseBack: uploadLicenseBack,
  techFront: uploadTechPassport,
  techBack: uploadTechPassportBack,
};

export default function DriverDocumentsScreen() {
  const { t } = useTranslation();
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Personal info — first name is required, surname is optional.
  const [firstName, setFirstName] = useState(driver?.first_name || '');
  const [lastName, setLastName] = useState(driver?.last_name || '');

  // Contact number shown to passengers. Defaults to the registered (login) number;
  // the driver confirms it or changes it here (variant A). When signed in via Google,
  // `driver.phone` is a `google:...` placeholder, so open the phone editor directly.
  const initialPhone = driver?.contact_phone || driver?.phone || '';
  const hasInitialValidPhone = isValidPhone(initialPhone);
  const [displayNumber, setDisplayNumber] = useState(
    hasInitialValidPhone ? initialPhone : ''
  );
  const [phoneEditing, setPhoneEditing] = useState(!hasInitialValidPhone);
  const [newPhone, setNewPhone] = useState('+998 ');

  const [carModel, setCarModel] = useState(driver?.car_model || '');
  const [carColor, setCarColor] = useState(driver?.car_color || '');
  const [carYear, setCarYear] = useState(driver?.car_year || '');
  const [carNumber, setCarNumber] = useState(driver?.car_number || '');

  const [uris, setUris] = useState<Record<DocKey, string | null>>({
    licenseFront: null,
    licenseBack: null,
    techFront: null,
    techBack: null,
  });
  const [uploaded, setUploaded] = useState<Record<DocKey, boolean>>({
    licenseFront: !!driver?.license_photo_url,
    licenseBack: !!driver?.license_back_url,
    techFront: !!driver?.tech_passport_url,
    techBack: !!driver?.tech_passport_back_url,
  });
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [models, setModels] = useState<string[]>(DEFAULT_CAR_MODELS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // `uploading` / `submitting` are state, so they only disable the controls on the NEXT
  // render; two taps dispatched in the same frame both got through. That matters twice
  // here: a second picker launch usually rejects with "Different native picker already in
  // progress", and the shared catch below would then clear the slot the FIRST tap was
  // legitimately filling; and a double submit fired two router.replace calls.
  // Dimensions+size of the image accepted for each slot, used to catch the same picture
  // being chosen for a second slot. A ref, not state: it is never rendered, and it must be
  // readable synchronously inside the pick handler.
  const fingerprints = useRef<Partial<Record<DocKey, string>>>({});
  const pickInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    getCarModels()
      .then((r) => { if (aliveRef.current) setModels(r.models); })
      .catch(() => {});
  }, []);

  /**
   * Ask for the permission a source needs, explaining why BEFORE the OS dialog appears.
   *
   * The screen used to call `launchImageLibraryAsync` cold. Two problems with that: the
   * driver met a bare system prompt with no idea why an app about taxi orders wanted their
   * photos, and a previously-denied permission produced an unexplained rejected promise that
   * surfaced as a generic error. Now the rationale comes first, and a permanent denial ends
   * in the one place that can actually fix it — system settings.
   *
   * Returns true only when the picker may be opened.
   */
  const ensurePermission = async (source: 'camera' | 'gallery'): Promise<boolean> => {
    // On Android, launchImageLibraryAsync uses the system Photo Picker which requires no
    // runtime permission on Android 13+ (API 33+).
    if (source === 'gallery' && Platform.OS === 'android') {
      return true;
    }

    const current =
      source === 'camera'
        ? await ImagePicker.getCameraPermissionsAsync()
        : await ImagePicker.getMediaLibraryPermissionsAsync();

    if (current.granted) return true;

    // Already refused for good: another request is a no-op, so send them to Settings.
    if (!current.canAskAgain) {
      Alert.alert(t('docs.permTitle'), t('docs.permDeniedBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('docs.openSettings'), onPress: () => Linking.openSettings() },
      ]);
      return false;
    }

    const requested =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!requested.granted) {
      if (!requested.canAskAgain) {
        Alert.alert(t('docs.permTitle'), t('docs.permDeniedBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('docs.openSettings'), onPress: () => Linking.openSettings() },
        ]);
      }
      return false;
    }
    return true;
  };

  /**
   * Cheap local identity for a picked image: dimensions plus byte size.
   *
   * Not a hash — the app cannot read the file's bytes without pulling in another native
   * dependency. It exists to catch the obvious case instantly (the very same gallery entry
   * chosen for two slots) so the driver is told at the moment of choosing rather than after
   * an upload round-trip. The backend's sha256 + perceptual hash remain the real check; this
   * only makes the common mistake fail fast.
   */
  const assetFingerprint = (asset: ImagePicker.ImagePickerAsset): string =>
    `${asset.width}x${asset.height}:${asset.fileSize ?? 'na'}`;

  const pickAndUpload = async (key: DocKey) => {
    if (pickInFlightRef.current || uploading) return;
    pickInFlightRef.current = true;
    try {
      // The slot says "Suratga olish", so the camera is offered first — and a photo taken
      // now is far harder to fake than a file chosen from the gallery, which is how one
      // screenshot ended up in all four slots. The gallery stays available because a driver
      // may legitimately have photographed the document earlier.
      const source = await new Promise<'camera' | 'gallery' | null>((resolve) => {
        Alert.alert(
          t('docs.chooseSourceTitle'),
          t('docs.chooseSourceBody'),
          [
            { text: t('docs.takePhoto'), onPress: () => resolve('camera') },
            { text: t('docs.pickFromGallery'), onPress: () => resolve('gallery') },
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
          ],
          { onDismiss: () => resolve(null) }
        );
      });
      if (!source) return;

      if (!(await ensurePermission(source))) return;

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });

      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      const uri = asset.uri;

      // Local sanity checks, so an unusable photo is refused before it costs an upload on a
      // mobile connection. Guarded on the dimensions actually being reported: some providers
      // omit them, and an absent width must not be read as "too small".
      if (asset.width && asset.height) {
        if (Math.min(asset.width, asset.height) < MIN_DOC_SIDE_PX) {
          Alert.alert(t('common.error'), t('docs.errTooSmall'));
          return;
        }
        const aspect = Math.max(asset.width, asset.height) / Math.min(asset.width, asset.height);
        if (aspect > MAX_DOC_ASPECT) {
          Alert.alert(t('common.error'), t('docs.errBadShape'));
          return;
        }
      }

      // Same picture already sitting in another slot? Refuse immediately.
      const fingerprint = assetFingerprint(asset);
      const clash = (Object.keys(fingerprints.current) as DocKey[]).find(
        (other) => other !== key && fingerprints.current[other] === fingerprint
      );
      if (clash) {
        Alert.alert(t('common.error'), t('docs.errDuplicateDoc'));
        return;
      }

      setUris((p) => ({ ...p, [key]: uri }));
      setUploaded((p) => ({ ...p, [key]: false }));
      setUploading(key);
      await uploaders[key](uri);
      if (!aliveRef.current) return;
      fingerprints.current[key] = fingerprint;
      setUploaded((p) => ({ ...p, [key]: true }));
    } catch (e: any) {
      if (!aliveRef.current) return;
      // Drop the local preview: keeping it made all four slots look filled while
      // `uploaded[key]` stayed false, so the driver saw "Avval barcha maydonlarni
      // to'ldiring" with no way to tell which upload had actually failed. This screen
      // gates access to the app, so a silent failure strands the driver here.
      setUris((p) => ({ ...p, [key]: null }));
      setUploaded((p) => ({ ...p, [key]: false }));
      // Forget the fingerprint too: the slot is empty again, so keeping it would make a
      // later, legitimate retry with the same photo look like a duplicate of nothing.
      delete fingerprints.current[key];
      // describeApiError separates a 413 (four photos at quality 0.7 easily exceed the 5MB
      // cap) from a timeout and from a real server error, and now also renders the document
      // rejections (blurry / blank / duplicate) in the driver's own language. On the one
      // screen that gates access to the whole app, a misdiagnosed error traps the driver in
      // onboarding.
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      pickInFlightRef.current = false;
      if (aliveRef.current) setUploading(null);
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

  const coreDocsUploaded =
    uploaded.licenseFront &&
    uploaded.licenseBack &&
    uploaded.techFront &&
    uploaded.techBack;
  const uploadedCount = (Object.keys(uploaded) as DocKey[]).filter((k) => uploaded[k]).length;
  const totalSlots = DOCS.length;
  const allDone =
    !!firstName.trim() &&
    isValidPhone(displayNumber) &&
    !!carModel.trim() &&
    !!carYear.trim() &&
    !!carNumber.trim() &&
    coreDocsUploaded;

  const handleSkipToApp = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/orders');
    }
  };

  const handleSubmit = async () => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try {
      if (!firstName.trim()) {
        Alert.alert(t('common.attention'), t('docs.errName'));
        return;
      }
      if (!isValidPhone(displayNumber)) {
        Alert.alert(t('common.attention'), t('docs.errPhone'));
        return;
      }
      if (!carModel.trim() || !carYear.trim() || !carNumber.trim()) {
        Alert.alert(t('common.attention'), t('docs.errCar'));
        return;
      }
      if (!coreDocsUploaded) {
        Alert.alert(t('common.attention'), t('docs.errDocs'));
        return;
      }
      setSubmitting(true);
      try {
        await updateDriverInfo({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          contact_phone: '+998' + localDigits(displayNumber),
          car_model: carModel.trim(),
          ...(carColor.trim() ? { car_color: carColor.trim() } : {}),
          car_year: carYear.trim(),
          car_number: carNumber.trim().toUpperCase(),
        });
        const res = await submitDocuments();
        if (res?.driver) setDriver(res.driver);
        Alert.alert(
          t('docs.doneTitle'),
          t('docs.doneBody'),
          [{ text: t('common.next'), onPress: () => router.replace('/(main)/orders') }],
          { cancelable: false }
        );
      } catch (e: any) {
        if (!aliveRef.current) return;
        Alert.alert(t('common.error'), describeApiError(e, t));
      } finally {
        if (aliveRef.current) setSubmitting(false);
      }
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const filteredModels = search
    ? models.filter((m) => m.toLowerCase().includes(search.toLowerCase()))
    : models;

  const section1Done =
    !!firstName.trim() &&
    isValidPhone(displayNumber) &&
    !!carModel.trim() &&
    !!carYear.trim() &&
    !!carNumber.trim();

  const renderSlot = (doc: DocSpec) => {
    const uri = uris[doc.key];
    const isUp = uploaded[doc.key];
    const busy = uploading === doc.key;
    const isLicense = doc.key === 'licenseFront' || doc.key === 'licenseBack';
    return (
      <TouchableOpacity
        key={doc.key}
        style={styles.slot}
        onPress={() => pickAndUpload(doc.key)}
        activeOpacity={0.85}
        disabled={!!uploading}
      >
        <View style={[styles.frame, isUp && styles.frameDone]}>
          {/* Scanner viewfinder corner brackets */}
          <View style={[styles.corner, styles.cornerTL, isUp && styles.cornerDone]} />
          <View style={[styles.corner, styles.cornerTR, isUp && styles.cornerDone]} />
          <View style={[styles.corner, styles.cornerBL, isUp && styles.cornerDone]} />
          <View style={[styles.corner, styles.cornerBR, isUp && styles.cornerDone]} />

          {uri ? (
            <Image source={{ uri }} style={styles.framePreview} />
          ) : (
            <View style={styles.docCardMock}>
              <View style={styles.docCardTop}>
                <View style={[styles.docChip, isLicense ? styles.docChipGold : styles.docChipBlue]} />
                <View style={styles.docHeaderLines}>
                  <View style={[styles.docLine, { width: '75%', backgroundColor: isUp ? colors.success : colors.primary }]} />
                  <View style={[styles.docLine, { width: '50%' }]} />
                </View>
              </View>
              <View style={styles.docCardBody}>
                <Icon
                  name={doc.icon}
                  size={28}
                  color={isUp ? colors.success : colors.primary}
                />
                <View style={styles.docLines}>
                  <View style={[styles.docLine, { width: '90%' }]} />
                  <View style={[styles.docLine, { width: '65%' }]} />
                </View>
              </View>
              <View style={[styles.scanActionPill, isUp && styles.scanActionPillDone]}>
                <Icon
                  name={isUp ? 'check' : 'camera'}
                  size={12}
                  color={isUp ? colors.textOnPrimary : colors.primary}
                />
                <Text style={[styles.frameHint, isUp && styles.frameHintDone]}>
                  {isUp ? t('common.confirm') : t('docs.takePhoto')}
                </Text>
              </View>
            </View>
          )}
          {busy && (
            <View style={styles.frameOverlay}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
          {isUp && !busy && (
            <View style={styles.doneBadge}>
              <Icon name="check" size={14} color={colors.textOnPrimary} />
            </View>
          )}
        </View>
        <View style={styles.slotMetaRow}>
          <Text style={styles.slotSide}>{t(doc.sideKey)}</Text>
          {isUp && <View style={styles.slotReadyDot} />}
        </View>
        <Text style={styles.slotGuide}>{t(doc.guideKey)}</Text>
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
        <TouchableOpacity
          onPress={handleSkipToApp}
          style={styles.headerBackBtn}
          activeOpacity={0.8}
        >
          <Icon name="back" size={24} color={colors.textOnPrimary} />
        </TouchableOpacity>
        <View style={styles.headerIconCircle}>
          <Icon name="document" size={36} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('docs.title')}</Text>
        <Text style={styles.subtitle}>
          {t('docs.subtitle')}
        </Text>
        <View style={styles.progressWrap}>
          <Text style={styles.progressLabel}>
            {t('docs.stepProgress', { done: uploadedCount, total: totalSlots })}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round((uploadedCount / totalSlots) * 100)}%` },
              ]}
            />
          </View>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 1-BO'LIM: Shaxsiy va mashina ma'lumotlari (zamonaviy bitta ixcham bo'limda) */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.stepBadge, section1Done && styles.stepBadgeDone]}>
              <Text style={styles.stepBadgeText}>01</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>
                {t('docs.personal')} & {t('docs.carInfo')}
              </Text>
            </View>
            {section1Done && (
              <View style={styles.stepStatusDone}>
                <Icon name="check" size={12} color={colors.success} />
              </View>
            )}
          </View>

          <View style={styles.twoColRow}>
            <View style={styles.colItem}>
              <Text style={styles.label}>
                {t('docs.firstName')} <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder={t('docs.firstNamePlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                maxLength={50}
              />
            </View>
            <View style={styles.colItem}>
              <Text style={styles.label}>
                {t('docs.lastName')}
              </Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder={t('docs.lastNamePlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                maxLength={50}
              />
            </View>
          </View>

          <Text style={styles.label}>
            {t('docs.carModel')} <Text style={styles.required}>*</Text>
          </Text>
          <TouchableOpacity
            style={styles.modelSelectorBtn}
            onPress={() => { setSearch(''); setPickerOpen(true); }}
            activeOpacity={0.8}
          >
            <View style={styles.modelSelectorIcon}>
              <Icon name="car" size={18} color={colors.primary} />
            </View>
            <Text style={[carModel ? styles.inputValue : styles.inputPlaceholder, { flex: 1 }]} numberOfLines={1}>
              {carModel || t('docs.selectModel')}
            </Text>
            <Icon name="chevronRight" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* 1-tap quick model chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickModelsRow}
          >
            {QUICK_CAR_MODELS.map((m) => {
              const active = carModel.trim().toLowerCase() === m.toLowerCase();
              const shortName = m.replace(/^Chevrolet\s+/i, '').replace(/\s+DM-i\s*\/\s*Champion/i, '');
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.quickModelChip, active && styles.quickModelChipActive]}
                  onPress={() => setCarModel(m)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.quickModelText, active && styles.quickModelTextActive]}>
                    {shortName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.twoColRow}>
            <View style={[styles.colItem, { flex: 1.55 }]}>
              <Text style={styles.label}>
                {t('docs.carNumber')} <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.plateInputWrap}>
                <View style={styles.plateUzBadge}>
                  <Text style={styles.plateUzText}>UZ</Text>
                  <View style={styles.plateFlagBar} />
                </View>
                <TextInput
                  style={styles.plateTextInput}
                  value={carNumber}
                  onChangeText={(text) => setCarNumber(text.toUpperCase())}
                  placeholder="75 A 777 AA"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                />
              </View>
            </View>
            <View style={[styles.colItem, { flex: 0.95 }]}>
              <Text style={styles.label}>
                {t('docs.carYear')} <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[styles.input, styles.yearInput]}
                value={carYear}
                onChangeText={setCarYear}
                placeholder="2023"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          </View>

          <Text style={styles.label}>
            {t('docs.carColor')} <Text style={styles.optional}>{t('docs.optional')}</Text>
          </Text>
          <View style={styles.colorChipsRow}>
            {POPULAR_CAR_COLORS.map((col) => {
              const selected = carColor.trim().toLowerCase() === col.label.toLowerCase();
              return (
                <TouchableOpacity
                  key={col.label}
                  style={[styles.colorChip, selected && styles.colorChipActive]}
                  onPress={() => setCarColor(col.label)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: col.hex },
                      col.border ? { borderWidth: 1, borderColor: col.border } : null,
                    ]}
                  />
                  <Text style={[styles.colorChipText, selected && styles.colorChipTextActive]}>
                    {col.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Contact number shown to passengers on orders */}
          <View style={styles.contactCard}>
            <View style={styles.contactTop}>
              <View style={styles.phoneBadge}><Icon name="phone" size={15} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactLabel}>{t('docs.contactPhone')}</Text>
                <Text style={styles.contactNumber}>{displayNumber ? formatPhone(displayNumber) : '—'}</Text>
              </View>
              {!phoneEditing && (
                <TouchableOpacity style={styles.changeBtnCompact} onPress={startEditingPhone} activeOpacity={0.85}>
                  <Text style={styles.changeBtnText}>{t('docs.changePhone')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {phoneEditing && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.label}>{t('docs.newPhone')}</Text>
                <TextInput
                  style={styles.input}
                  value={newPhone}
                  onChangeText={(v) => setNewPhone(formatPhone(v))}
                  keyboardType="phone-pad"
                  placeholder="+998 90 123 45 67"
                  placeholderTextColor={colors.textMuted}
                />
                <Button
                  title={t('common.save')}
                  onPress={saveNewNumber}
                  disabled={!isValidPhone(newPhone)}
                  variant="accent"
                  style={{ marginTop: spacing.sm, opacity: isValidPhone(newPhone) ? 1 : 0.5 }}
                />
                {hasInitialValidPhone && (
                  <TouchableOpacity style={styles.phoneCancel} onPress={() => setPhoneEditing(false)} activeOpacity={0.7}>
                    <Text style={styles.phoneCancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>

        {/* 2-BO'LIM: Hujjat rasmlari (Prava va Texpasport) */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.stepBadge, coreDocsUploaded && styles.stepBadgeDone]}>
              <Text style={styles.stepBadgeText}>02</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>
                {t('docs.license')} & {t('docs.techPassport')}
              </Text>
            </View>
            <Text style={styles.stepCounterBadge}>{uploadedCount}/{totalSlots}</Text>
          </View>
          <Text style={styles.sectionHint}>{t('docs.photoTip')}</Text>

          <View style={styles.docGroupHeader}>
            <Icon name="idCard" size={16} color={colors.primary} />
            <Text style={styles.docSubheading}>{t('docs.license')} ({t('docs.bothSides')})</Text>
          </View>
          <View style={styles.slotRow}>
            {renderSlot(DOCS[0])}
            {renderSlot(DOCS[1])}
          </View>

          <View style={styles.docDivider} />

          <View style={styles.docGroupHeader}>
            <Icon name="document" size={16} color={colors.primary} />
            <Text style={styles.docSubheading}>{t('docs.techPassport')} ({t('docs.bothSides')})</Text>
          </View>
          <View style={styles.slotRow}>
            {renderSlot(DOCS[2])}
            {renderSlot(DOCS[3])}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={allDone ? t('common.confirm') : t('docs.fillAllFirst')}
          onPress={handleSubmit}
          loading={submitting}
          variant={allDone ? 'success' : 'outline'}
        />
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleSkipToApp}
          activeOpacity={0.75}
        >
          <Text style={styles.skipBtnText}>{t('docs.skipForNow')}</Text>
        </TouchableOpacity>
      </View>

      {/* Car model picker */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.backBtn}>
              <Icon name="back" size={26} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>{t('docs.selectModel')}</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ padding: spacing.md }}>
            <TextInput
              style={styles.input}
              value={search}
              onChangeText={setSearch}
              placeholder={t('docs.search')}
              placeholderTextColor={colors.textMuted}
            />
          </View>
          {search.trim().length > 1 &&
            !filteredModels.some((m) => m.toLowerCase() === search.trim().toLowerCase()) && (
              <TouchableOpacity
                style={[styles.modelRow, { backgroundColor: colors.primaryLight }]}
                onPress={() => {
                  setCarModel(search.trim());
                  setPickerOpen(false);
                }}
              >
                <Text style={[styles.modelText, { fontWeight: '700', color: colors.textOnPrimary }]}>
                  + «{search.trim()}»
                </Text>
              </TouchableOpacity>
            )}
          {models.length === 0 ? (
            <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary} />
          ) : (
            <FlatList
              data={filteredModels}
              keyExtractor={(item, i) => item + i}
              keyboardShouldPersistTaps="handled"
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
  headerBackBtn: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
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
  title: { ...typography.h2, color: colors.textOnPrimary },
  subtitle: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  progressWrap: {
    width: '100%',
    marginTop: spacing.md,
  },
  progressLabel: {
    ...typography.small,
    color: colors.textOnPrimary,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  colorChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  colorChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  colorSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  colorChipText: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  colorChipTextActive: {
    color: colors.textOnPrimary,
    fontWeight: '700',
  },

  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },

  // Card section wrapper
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: '#0E1730',
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeDone: {
    backgroundColor: colors.success,
  },
  stepBadgeText: {
    ...typography.small,
    color: colors.textOnPrimary,
    fontWeight: '800',
    fontSize: 12,
  },
  stepStatusDone: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCounterBadge: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '800',
  },
  sectionTitle: { ...typography.bodyBold, color: colors.text, fontSize: 16 },
  sectionHint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 18 },
  twoColRow: { flexDirection: 'row', gap: spacing.sm },
  colItem: { flex: 1 },
  docGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  docSubheading: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  docDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },

  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 5, marginTop: spacing.sm, fontWeight: '600' },
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
  modelSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    minHeight: 50,
  },
  modelSelectorIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickModelsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 8,
    paddingBottom: 2,
  },
  quickModelChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  quickModelChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickModelText: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  quickModelTextActive: {
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  plateInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.text,
    minHeight: 48,
    overflow: 'hidden',
  },
  plateUzBadge: {
    width: 34,
    height: 46,
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateUzText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  plateFlagBar: {
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#10B981',
    marginTop: 2,
  },
  plateTextInput: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.text,
  },
  yearInput: {
    fontWeight: '700',
    textAlign: 'center',
  },
  inputValue: { fontSize: 16, color: colors.text, fontWeight: '700' },
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
  contactTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  phoneBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: { ...typography.caption, color: colors.textSecondary },
  contactNumber: { ...typography.bodyBold, color: colors.text, marginTop: 1, letterSpacing: 0.4 },
  changeBtnCompact: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  changeBtnText: { ...typography.small, color: colors.primary, fontWeight: '700' },
  phoneCancel: { alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  phoneCancelText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },

  // Document scanner slots
  slotRow: { flexDirection: 'row', gap: spacing.md },
  slot: { flex: 1 },
  frame: {
    aspectRatio: 1.48,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 10,
  },
  frameDone: {
    borderColor: colors.success,
    borderWidth: 2,
  },
  corner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: colors.primary,
  },
  cornerDone: {
    borderColor: colors.success,
  },
  cornerTL: { top: 6, left: 6, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 5 },
  cornerTR: { top: 6, right: 6, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 5 },
  cornerBL: { bottom: 6, left: 6, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 5 },
  cornerBR: { bottom: 6, right: 6, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 5 },
  framePreview: { width: '100%', height: '100%', borderRadius: radius.sm },
  frameOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docCardMock: {
    width: '100%',
    height: '100%',
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  docCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docChip: {
    width: 20,
    height: 14,
    borderRadius: 3,
  },
  docChipGold: {
    backgroundColor: '#F59E0B',
  },
  docChipBlue: {
    backgroundColor: '#3B82F6',
  },
  docHeaderLines: {
    flex: 1,
    gap: 3,
  },
  docCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  docLines: { flex: 1, gap: 4 },
  docLine: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  scanActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  scanActionPillDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  frameHint: { ...typography.small, color: colors.primary, fontWeight: '700', fontSize: 11 },
  frameHintDone: { color: colors.textOnPrimary },
  doneBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  slotReadyDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.success,
  },
  slotSide: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
  slotGuide: { ...typography.small, color: colors.textSecondary, marginTop: 1, fontSize: 11 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  skipBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  skipBtnText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
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
