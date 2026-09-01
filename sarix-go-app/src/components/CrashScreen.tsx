import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';

/**
 * What the passenger sees when a screen fails to render.
 *
 * Before this existed there was no error boundary anywhere in the app, so ANY exception
 * thrown during render unmounted the tree and left a completely blank screen — no message,
 * no way out, and nothing anybody could report beyond "it froze". That is exactly what a
 * parcel order looked like after pressing "Buyurtma berish".
 *
 * Two jobs, in this order:
 *   1. Give the passenger a way to continue (retry, or back to the home screen) instead of a
 *      dead app they have to force-quit.
 *   2. Show the actual error text, so a screenshot is enough to diagnose the next one.
 *
 * Deliberately built from nothing but React Native primitives and hardcoded strings: no
 * theme store, no i18n, no icon set, no API client. An error screen that depends on the
 * app's own infrastructure cannot be trusted to render when that infrastructure is what
 * broke — an i18n failure here would blank the screen a second time.
 */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const [showDetails, setShowDetails] = React.useState(false);

  const message = String(error?.message || error || 'Noma\u02bblum xatolik');
  const stack = String(error?.stack || '').split('\n').slice(0, 12).join('\n');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.emoji}>{'\u26A0\uFE0F'}</Text>
        <Text style={styles.title}>Nimadir xato ketdi</Text>
        <Text style={styles.body}>
          Bu ekranni ko&apos;rsatib bo&apos;lmadi. Qayta urinib ko&apos;ring yoki bosh
          sahifaga qaytib, amalni takrorlang.
        </Text>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => retry()} activeOpacity={0.85}>
          <Text style={styles.primaryText}>Qayta urinish</Text>
        </TouchableOpacity>

        {/* `retry` remounts the failing segment. When the crash is in the screen the app
            opened INTO, retrying lands on it again — so there is a second way out that does
            not depend on this screen working. */}
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            // Imported lazily so a broken router module cannot stop this screen rendering.
            try {
              const { router } = require('expo-router');
              router.replace('/(tabs)/home');
            } catch {
              retry();
            }
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryText}>Bosh sahifa</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowDetails((v) => !v)} activeOpacity={0.7}>
          <Text style={styles.detailsToggle}>
            {showDetails ? 'Tafsilotni yashirish' : 'Xato tafsiloti'}
          </Text>
        </TouchableOpacity>

        {showDetails && (
          <View style={styles.detailsBox}>
            {/* selectable so the text can be copied out of a real device */}
            <Text style={styles.detailsText} selectable>
              {message}
            </Text>
            {!!stack && (
              <Text style={[styles.detailsText, styles.stackText]} selectable>
                {stack}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed light colours rather than theme tokens: see the note above.
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  emoji: { fontSize: 44, textAlign: 'center', marginBottom: 12 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1D26',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: '#656B78',
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: '#5B4CF5',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5B4CF5',
  },
  secondaryText: { color: '#5B4CF5', fontSize: 16, fontWeight: '600' },
  detailsToggle: {
    marginTop: 20,
    fontSize: 13,
    color: '#656B78',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  detailsBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F4F5F9',
  },
  detailsText: { fontSize: 12, color: '#1A1D26' },
  stackText: {
    marginTop: 8,
    color: '#656B78',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
