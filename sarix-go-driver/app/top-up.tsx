import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Clipboard,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { Icon, IconText, type IconName } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import {
  listMethods,
  createClickPayment,
  createPaymePayment,
  submitTopupScreenshot,
  type PaymentMethod,
} from '../src/api/payments';
import { describeApiError, formatAmount } from '../src/api/errors';
import { useDriverStore } from '../src/store/driver';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const PRESET_AMOUNTS = [10000, 20000, 50000, 100000];
// Mirrors config.TOPUP_MIN_AMOUNT / config.TOPUP_MAX_AMOUNT on the backend. Checking here
// too means an out-of-range amount is caught before the driver waits out a multi-megabyte
// screenshot upload only to get a 400. The server stays authoritative: if an operator
// changes the env vars, its rejection (code `amount_out_of_range`, which carries the real
// bounds) is what the driver ends up seeing.
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 5_000_000;

const METHOD_ICONS: Record<PaymentMethod['id'], IconName> = {
  card: 'card',
  click: 'wallet',
  payme: 'wallet',
};

// Click and Payme get the same wallet shape, so the brand colour is what tells them
// apart — exactly the job the old 💙 / 💚 glyphs were doing.
const METHOD_COLORS: Record<PaymentMethod['id'], string> = {
  card: '#B88700',
  click: '#0F86FF',
  payme: '#00CFC1',
};


export default function TopUpScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const driver = useDriverStore((s) => s.driver);
  const loadDriver = useDriverStore((s) => s.loadDriver);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodsError, setMethodsError] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<string>('card');
  const [amount, setAmount] = useState<number>(50000);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Two different questions, so two different refs.
  //
  // `aliveRef` — is the component still mounted? Guards state setters.
  // `focusedRef` — is this screen the one the driver is actually looking at? Guards the
  //   Alert and router.back(). Mount is not enough: expo-router keeps a stack screen
  //   mounted when you navigate FORWARD from it, so an upload that finished after the
  //   driver moved on would pop a native dialog over an unrelated screen, and its button
  //   would call router.back() and drop them out of wherever they were.
  const aliveRef = useRef(true);
  const focusedRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      focusedRef.current = false;
    };
  }, []);

  // Synchronous double-tap guard, matching acceptInFlightRef in (main)/orders.tsx. The
  // `submitting`/`loading` state also disables the Button, but only after a re-render, so
  // two taps dispatched in the same batch both got through. On the provider path that
  // meant two Payment rows and two openURL calls — two payable invoices.
  const inFlightRef = useRef(false);

  const fetchMethods = useCallback(async () => {
    setMethodsLoading(true);
    try {
      const list = await listMethods();
      if (!aliveRef.current) return;
      setMethods(list);
      setMethodsError(false);
    } catch {
      if (!aliveRef.current) return;
      // This used to silently setMethods([]). The card flow renders on the DEFAULT
      // selection, so the driver was shown a top-up screen with an empty method list and
      // "—" where the card number belongs, with the Send button still enabled. Anyone who
      // paid from memory sent money that could not be reconciled. Surface it instead.
      setMethods([]);
      setMethodsError(true);
    } finally {
      if (aliveRef.current) setMethodsLoading(false);
    }
  }, []);

  // Runs on first focus too, so it replaces the old mount-only fetch rather than adding to
  // it. The provider (Click/Payme) flow leaves the app entirely and a manual request only
  // moves the balance once an admin approves it, so refetching on focus is what makes the
  // balance the driver sees on return actually current — otherwise they saw the stale
  // number and were liable to pay a second time.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      loadDriver();
      fetchMethods();
      return () => {
        focusedRef.current = false;
      };
    }, [fetchMethods, loadDriver])
  );

  const cardMethod = methods.find((m) => m.id === 'card');
  const cardReady = Boolean(cardMethod?.card_number);

  const formatPrice = formatAmount;

  const getActualAmount = (): number => {
    if (customAmount) {
      const n = parseInt(customAmount.replace(/\s/g, ''), 10);
      return isNaN(n) ? 0 : n;
    }
    return amount;
  };

  const copyCard = async () => {
    if (!cardMethod?.card_number) {
      // Silently doing nothing here let the driver believe the number was copied.
      Alert.alert(t('topUp.noCardTitle'), t('topUp.noCardBody'));
      return;
    }
    Clipboard.setString(cardMethod.card_number);
    Alert.alert(t('topUp.copied'));
  };

  const pickScreenshot = async () => {
    try {
      // Android's system photo picker grants access to the selected image itself;
      // requesting broad media-library permission first is unnecessary and can throw
      // when that permission is not present in an already-installed native build.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setScreenshot(result.assets[0].uri);
      }
    } catch (e: any) {
      // Surface the underlying reason instead of a generic message so gallery/native
      // failures are actually diagnosable in the field.
      const reason = e?.message || String(e);
      Alert.alert(t('topUp.errImagePick'), reason);
    }
  };

  const submitCardTopup = async () => {
    const amt = getActualAmount();
    if (amt < MIN_AMOUNT) {
      Alert.alert(t('common.error'), t('topUp.errMinAmount', { amount: formatPrice(MIN_AMOUNT) }));
      return;
    }
    if (amt > MAX_AMOUNT) {
      Alert.alert(t('common.error'), t('topUp.errMaxAmount', { amount: formatPrice(MAX_AMOUNT) }));
      return;
    }
    if (!cardReady) {
      Alert.alert(t('topUp.noCardTitle'), t('topUp.noCardBody'));
      return;
    }
    if (!screenshot) {
      Alert.alert(t('topUp.needScreenshot'), t('topUp.needScreenshotBody'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitTopupScreenshot(amt, screenshot);
      // Refresh the balance. A manual request stays `pending` until an admin approves it,
      // so this will not move yet — which is exactly why the message below has to say so.
      await loadDriver();
      if (aliveRef.current) setScreenshot(null);
      // The request DID succeed; if the driver has already moved on, stay silent rather
      // than hijacking their current screen.
      if (!focusedRef.current) return;
      Alert.alert(
        t('topUp.sentTitle'),
        res.message || t('topUp.pendingNotice'),
        [{ text: t('common.close'), onPress: () => router.back() }],
        // Android dialogs are dismissible by default, and a dismissal never fires
        // onPress. The driver was then left on this screen with the preview cleared and
        // no record of the request, whose natural next move is to submit it again.
        { cancelable: false }
      );
    } catch (e: any) {
      // Keep the screenshot so a retry does not mean re-picking it from the gallery.
      if (!focusedRef.current) return;
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  };

  const handleTopUp = async () => {
    // Set before any await, so a second tap in the same frame cannot get through.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const amt = getActualAmount();
      if (amt < MIN_AMOUNT) {
        Alert.alert(
          t('common.error'),
          t('topUp.errMinAmount', { amount: formatPrice(MIN_AMOUNT) })
        );
        return;
      }
      if (amt > MAX_AMOUNT) {
        Alert.alert(
          t('common.error'),
          t('topUp.errMaxAmount', { amount: formatPrice(MAX_AMOUNT) })
        );
        return;
      }

      if (selectedMethod === 'card') {
        // In-app manual flow: require a screenshot, then submit for admin approval.
        await submitCardTopup();
        return;
      }

      setLoading(true);
      try {
        let result;
        if (selectedMethod === 'click') {
          result = await createClickPayment(amt);
        } else if (selectedMethod === 'payme') {
          result = await createPaymePayment(amt);
        } else {
          return;
        }

        // Open payment URL in browser
        const supported = await Linking.canOpenURL(result.url);
        if (supported) {
          await Linking.openURL(result.url);
          // Backgrounding the app for the provider page does NOT blur the screen in
          // navigation terms, so this dialog still greets the driver when they return —
          // which is the point of it. The guard only matters if they left this screen
          // entirely while the request was in flight.
          if (!focusedRef.current) return;
          Alert.alert(t('topUp.providerOpened'), t('topUp.providerOpenedBody'));
        } else {
          Alert.alert(t('common.error'), t('topUp.errBrowser'));
        }
      } catch (e: any) {
        if (!focusedRef.current) return;
        // Was `Alert.alert('❌', e?.response?.data?.error || errGeneric)`: an untitled
        // dialog that collapsed airplane mode, a 20s timeout and a rejected amount into
        // one indistinguishable message. describeUploadError already separates those.
        Alert.alert(t('common.error'), describeApiError(e, t));
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  // Chosen from `method.id`, not from the server's `icon` field.
  //
  // The backend sends a glyph there (💳 / 💙 / 💚), which cannot be sized or coloured
  // from here and renders differently per device. `id` is already a typed union, so the
  // client can pick its own icon without the backend having to know about our icon set —
  // and older app versions keep working, because the `icon` field is left untouched.
  const renderMethod = (method: PaymentMethod) => {
    const isSelected = selectedMethod === method.id;
    return (
      <TouchableOpacity
        key={method.id}
        style={[
          styles.methodCard,
          isSelected && styles.methodCardSelected,
          method.disabled && styles.methodCardDisabled,
        ]}
        onPress={() => !method.disabled && setSelectedMethod(method.id)}
        activeOpacity={0.85}
        disabled={method.disabled}
        accessibilityRole="button"
        accessibilityLabel={method.name}
        accessibilityHint={method.description}
        accessibilityState={{ selected: isSelected, disabled: Boolean(method.disabled) }}
      >
        <View style={styles.methodIcon}>
          <Icon
            name={METHOD_ICONS[method.id] ?? 'card'}
            size={22}
            color={METHOD_COLORS[method.id] ?? colors.textSecondary}
          />
        </View>
        <View style={styles.methodInfo}>
          <Text style={styles.methodName}>
            {method.name}
            {method.disabled && ` ${t('topUp.comingSoon')}`}
          </Text>
          <Text style={styles.methodDesc}>{method.description}</Text>
          {method.card_number && (
            <Text style={styles.methodCard1}>{method.card_number}</Text>
          )}
        </View>
        <View style={[styles.radio, isSelected && styles.radioSelected]}>
          {isSelected && <View style={styles.radioInner} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          // Leaving mid-upload orphaned a 60s request whose result landed on another screen.
          disabled={submitting || loading}
        >
          <Icon
            name="back"
            size={26}
            color={submitting || loading ? colors.textMuted : colors.primary}
          />
        </TouchableOpacity>
        <Text style={styles.title}>{t('topUp.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Current balance */}
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>{t('topUp.currentBalance')}</Text>
            <Text style={styles.balanceValue}>
              {formatPrice(driver?.balance || 0)} {t('more.currency')}
            </Text>
            {(driver?.balance || 0) < 20000 && (
              <Text style={styles.balanceWarning}>
                {t('topUp.minBalanceHint')}
              </Text>
            )}
          </View>

          {/* Bonus banner */}
          <View style={styles.bonusBanner}>
            {/* Matches bonusText: the banner sits on accentLight, where the green
                success colour reads as a different message than the label it labels. */}
            <Icon name="gift" size={26} color={colors.primary} />
            <Text style={styles.bonusText}>
              {t('topUp.firstTopUp')} <Text style={styles.bonusBold}>{t('topUp.bonusBadge')}</Text>
            </Text>
          </View>

          {/* Amount selection */}
          <Text style={styles.sectionTitle}>{t('topUp.amount')}</Text>
          <View style={styles.amounts}>
            {PRESET_AMOUNTS.map((a) => (
              <TouchableOpacity
                key={a}
                style={[
                  styles.amountChip,
                  amount === a && !customAmount && styles.amountChipSelected,
                ]}
                onPress={() => {
                  setAmount(a);
                  setCustomAmount('');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${formatPrice(a)} ${t('more.currency')}`}
                accessibilityHint={t('topUp.a11ySelectAmount')}
                accessibilityState={{ selected: amount === a && !customAmount }}
              >
                <Text
                  style={[
                    styles.amountChipText,
                    amount === a && !customAmount && styles.amountChipTextSelected,
                  ]}
                >
                  {formatPrice(a)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.customAmountInput}
            placeholder={t('topUp.amountPlaceholder')}
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            value={customAmount}
            // `text`, not `t` — the old parameter name shadowed the translation function,
            // so any t() added inside this callback would have been a runtime error.
            maxLength={String(MAX_AMOUNT).length}
            onChangeText={(text) => setCustomAmount(text.replace(/[^\d]/g, ''))}
            accessibilityLabel={t('topUp.otherAmount')}
            accessibilityHint={t('topUp.a11yEnterAmount')}
          />

          {/* Payment methods */}
          <Text style={styles.sectionTitle}>{t('topUp.paymentType')}</Text>
          {methodsLoading && methods.length === 0 ? (
            <Text style={styles.methodsNotice}>{t('topUp.loadingMethods')}</Text>
          ) : methodsError ? (
            <View style={styles.methodsErrorBox}>
              <Text style={styles.methodsErrorText}>{t('topUp.errMethodsLoad')}</Text>
              <TouchableOpacity
                onPress={fetchMethods}
                disabled={methodsLoading}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
              >
                <Text style={styles.methodsRetry}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.methods}>
              {methods.map(renderMethod)}
            </View>
          )}

          {/* Card manual flow: show card number + screenshot upload */}
          {selectedMethod === 'card' && (
            <View style={styles.cardFlow}>
              <Text style={styles.sectionTitle}>{t('topUp.step1')}</Text>
              <TouchableOpacity style={styles.cardNumberBox} onPress={copyCard} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardNumberLabel}>{t('topUp.cardNumber')}</Text>
                  <Text style={styles.cardNumberValue}>
                    {cardMethod?.card_number || '—'}
                  </Text>
                  {!!cardMethod?.card_holder && (
                    <Text style={styles.cardHolder}>{cardMethod.card_holder}</Text>
                  )}
                </View>
                <IconText
                  name="document"
                  size={13}
                  color={colors.primary}
                  textStyle={styles.copyBtn}
                >
                  {t('topUp.copy')}
                </IconText>
              </TouchableOpacity>

              {!cardReady && !methodsLoading && (
                <View style={styles.noCardBox}>
                  <Text style={styles.noCardTitle}>{t('topUp.noCardTitle')}</Text>
                  <Text style={styles.noCardBody}>{t('topUp.noCardBody')}</Text>
                  <TouchableOpacity
                    onPress={fetchMethods}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.retry')}
                  >
                    <Text style={styles.methodsRetry}>{t('common.retry')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.sectionTitle}>{t('topUp.step2')}</Text>
              <Text style={styles.cardHint}>
                {t('topUp.cardHint')}
              </Text>

              {screenshot ? (
                <View style={styles.screenshotPreviewWrap}>
                  <Image source={{ uri: screenshot }} style={styles.screenshotPreview} />
                  <TouchableOpacity
                    style={styles.changeShotBtn}
                    onPress={pickScreenshot}
                    disabled={submitting}
                  >
                    <Text style={styles.changeShotText}>{t('topUp.pickAnotherImage')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.uploadBtn}
                  onPress={pickScreenshot}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  <Icon name="camera" size={28} color={colors.primary} style={styles.uploadIcon} />
                  <Text style={styles.uploadText}>{t('topUp.uploadScreenshot')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>{t('topUp.payable')}</Text>
            <Text style={styles.footerAmount}>
              {formatPrice(getActualAmount())} {t('more.currency')}
            </Text>
          </View>
          <Button
            title={
              selectedMethod === 'card'
                ? submitting
                  ? t('topUp.sending')
                  : t('common.send')
                : loading
                ? '...'
                : t('topUp.pay')
            }
            onPress={handleTopUp}
            loading={loading || submitting}
            disabled={
              getActualAmount() < MIN_AMOUNT ||
              getActualAmount() > MAX_AMOUNT ||
              submitting ||
              // Never invite a transfer when we cannot show the destination card.
              (selectedMethod === 'card' && (!screenshot || !cardReady))
            }
            variant="accent"
            fullWidth={false}
            style={{ flex: 1, marginLeft: spacing.md }}
            accessibilityLabel={t(selectedMethod === 'card' ? 'topUp.a11yConfirmSend' : 'topUp.a11yStartPayment')}
            accessibilityHint={
              selectedMethod === 'card'
                ? t('topUp.a11ySubmitScreenshot')
                : t('topUp.a11yOpenProvider')
            }
          />
        </View>
      </KeyboardAvoidingView>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.primary },
  scroll: { padding: spacing.lg },
  balanceCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  balanceLabel: { ...typography.caption, color: colors.textOnPrimary, opacity: 0.8 },
  balanceValue: { ...typography.h1, color: colors.accent, marginVertical: spacing.xs },
  balanceWarning: {
    ...typography.small,
    color: colors.accent,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  bonusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },

  bonusText: { flex: 1, ...typography.body, color: colors.primary },
  bonusBold: { fontWeight: '800' },
  sectionTitle: {
    ...typography.bodyBold,
    color: colors.primary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  amounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  amountChip: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
  },
  amountChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.white,
  },
  amountChipText: { ...typography.bodyBold, color: colors.text },
  amountChipTextSelected: { color: colors.primary },
  customAmountInput: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methods: { gap: spacing.sm },
  methodsNotice: {
    ...typography.small,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  methodsErrorBox: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.error,
    gap: spacing.xs,
  },
  methodsErrorText: {
    ...typography.small,
    color: colors.error,
  },
  methodsRetry: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '700',
    paddingVertical: spacing.xs,
  },
  noCardBox: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.error,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  noCardTitle: {
    ...typography.small,
    color: colors.error,
    fontWeight: '700',
  },
  noCardBody: {
    ...typography.small,
    color: colors.textSecondary,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.divider,
  },
  methodCardSelected: { borderColor: colors.accent },
  methodCardDisabled: { opacity: 0.5 },
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  methodInfo: { flex: 1 },
  methodName: { ...typography.bodyBold, color: colors.text },
  methodDesc: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  methodCard1: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.white,
  },
  footerInfo: { flex: 0 },
  footerLabel: { ...typography.caption, color: colors.textSecondary },
  footerAmount: { ...typography.h3, color: colors.primary },
  cardFlow: { marginTop: spacing.sm },
  cardNumberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
    marginBottom: spacing.sm,
  },
  cardNumberLabel: { ...typography.caption, color: colors.textSecondary },
  cardNumberValue: {
    ...typography.h3,
    color: colors.primary,
    letterSpacing: 1,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardHolder: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  copyBtn: { ...typography.bodyBold, color: colors.accent, marginLeft: spacing.sm },
  cardHint: {
    ...typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    gap: spacing.sm,
  },
  uploadIcon: { fontSize: 24 },
  uploadText: { ...typography.bodyBold, color: colors.primary },
  screenshotPreviewWrap: { alignItems: 'center', gap: spacing.sm },
  screenshotPreview: {
    width: '100%',
    height: 220,
    borderRadius: radius.md,
    resizeMode: 'contain',
    backgroundColor: colors.surface,
  },
  changeShotBtn: { paddingVertical: spacing.xs },
  changeShotText: { ...typography.body, color: colors.accent },
});
