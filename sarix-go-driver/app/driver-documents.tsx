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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { Icon, IconText, type IconName } from '../src/components/Icon';
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
const isValidPhone = (text: string) => localDigits(text).length === 9;

// Local mirrors of the backend's document limits (app/services/image_check.py), kept only so
// an unusable photo is refused before it costs an upload. The backend stays authoritative —
// these numbers must never be stricter than its own.
const MIN_DOC_SIDE_PX = 400;
const MAX_DOC_ASPECT = 4.0;

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

    // Explain, then ask. Resolved through the dialog so the OS prompt only ever follows a
    // deliberate "continue".
    const proceed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        t('docs.permTitle'),
        source === 'camera' ? t('docs.permCameraBody') : t('docs.permGalleryBody'),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('common.next'), onPress: () => resolve(true) },
        ],
        { onDismiss: () => resolve(false) }
      );
    });
    if (!proceed) return false;

    const requested =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!requested.granted) {
      Alert.alert(t('docs.permTitle'), t('docs.permDeniedBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('docs.openSettings'), onPress: () => Linking.openSettings() },
      ]);
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

  const allUploaded = uploaded.licenseFront && uploaded.licenseBack && uploaded.techFront && uploaded.techBack;
  const allDone =
    !!firstName.trim() && isValidPhone(displayNumber) && !!carModel.trim() &&
    !!carYear.trim() && !!carNumber.trim() && allUploaded;

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
      if (!allUploaded) {
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
          car_year: carYear.trim(),
          car_number: carNumber.trim().toUpperCase(),
        });
        const res = await submitDocuments();
        if (res?.driver) setDriver(res.driver);
        Alert.alert(
          t('docs.doneTitle'),
          t('docs.doneBody'),
          [{ text: t('common.next'), onPress: () => router.replace('/(main)/orders') }],
          // This dialog's onPress is the ONLY way out of onboarding: _layout.tsx has no
          // redirect gate on documents_submitted, so an Android dismissal left the driver
          // sitting on the form after a SUCCESSFUL submission, inviting a resubmit.
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
                <Icon name={doc.icon} size={44} color={colors.textMuted} />
                <View style={styles.docLines}>
                  <View style={[styles.docLine, { width: '70%' }]} />
                  <View style={[styles.docLine, { width: '45%' }]} />
                </View>
              </View>
              <IconText
                name="camera"
                size={13}
                color={colors.primary}
                textStyle={styles.frameHint}
                style={styles.frameHintRow}
              >
                {t('docs.takePhoto')}
              </IconText>
            </>
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
        <Text style={styles.slotSide}>{t(doc.sideKey)}</Text>
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
        <View style={styles.headerIconCircle}>
          <Icon name="document" size={40} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('docs.title')}</Text>
        <Text style={styles.subtitle}>
          {t('docs.subtitle')}
        </Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* How-to banner */}
        <View style={styles.tipCard}>
          <Icon name="idea" size={18} color="#B45309" />
          <Text style={styles.tipText}>{t('docs.photoTip')}</Text>
        </View>

        {/* Personal info */}
        <View style={styles.card}>
          <IconText name="profile" size={15} color={colors.text} textStyle={styles.sectionTitle}>
            {t('docs.personal')}
          </IconText>

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

          <Text style={styles.label}>
            {t('docs.lastName')} <Text style={styles.optional}>{t('docs.optional')}</Text>
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

          {/* Contact number shown to passengers on orders. Defaults to the
              registered number; the driver confirms or changes it here. */}
          <View style={styles.contactCard}>
            <View style={styles.contactTop}>
              <View style={styles.phoneBadge}><Icon name="phone" size={14} color={colors.textSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactLabel}>{t('docs.contactPhone')}</Text>
                <Text style={styles.contactNumber}>{displayNumber ? formatPhone(displayNumber) : '—'}</Text>
              </View>
            </View>
            {phoneEditing ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.label}>{t('docs.newPhone')}</Text>
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
                  title={t('common.save')}
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
                <Text style={styles.contactQuestion}>{t('docs.contactQuestion')}</Text>
                <TouchableOpacity style={styles.changeBtn} onPress={startEditingPhone} activeOpacity={0.85}>
                  <Text style={styles.changeBtnText}>{t('docs.changePhone')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Car info */}
        <View style={styles.card}>
          <IconText name="car" size={15} color={colors.text} textStyle={styles.sectionTitle}>
            {t('docs.carInfo')}
          </IconText>

          <Text style={styles.label}>{t('docs.carModel')}</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => { setSearch(''); setPickerOpen(true); }}
            activeOpacity={0.8}
          >
            <Text style={carModel ? styles.inputValue : styles.inputPlaceholder}>
              {carModel || t('docs.selectModel')}
            </Text>
          </TouchableOpacity>

          <Text style={styles.label}>{t('docs.carYear')}</Text>
          <TextInput
            style={styles.input}
            value={carYear}
            onChangeText={setCarYear}
            placeholder="2018"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={4}
          />

          <Text style={styles.label}>{t('docs.carNumber')}</Text>
          <TextInput
            style={styles.input}
            value={carNumber}
            // `text`, not `t` — the old name shadowed the i18n function inside this callback.
            onChangeText={(text) => setCarNumber(text.toUpperCase())}
            placeholder="01A123BC"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={10}
          />
        </View>

        {/* License */}
        <View style={styles.card}>
          <IconText name="idCard" size={15} color={colors.text} textStyle={styles.sectionTitle}>
            {t('docs.license')}
          </IconText>
          <Text style={styles.sectionHint}>{t('docs.bothSides')}</Text>
          <View style={styles.slotRow}>
            {renderSlot(DOCS[0])}
            {renderSlot(DOCS[1])}
          </View>
        </View>

        {/* Tech passport */}
        <View style={styles.card}>
          <IconText name="document" size={15} color={colors.text} textStyle={styles.sectionTitle}>
            {t('docs.techPassport')}
          </IconText>
          <Text style={styles.sectionHint}>{t('docs.bothSides')}</Text>
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
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIllustration: { alignItems: 'center', justifyContent: 'center' },
  docLines: { width: 64, gap: 4, alignItems: 'center' },
  docLine: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  frameHintRow: { marginTop: 8, justifyContent: 'center' },
  frameHint: { ...typography.small, color: colors.primary, fontWeight: '600' },
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
