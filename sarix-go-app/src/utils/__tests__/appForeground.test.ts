/**
 * Foreground gate for recurring network polls.
 *
 * The search screen polled `getOrder` every 5s with no ceiling and no backoff, so a search
 * left open for ten minutes issued ~120 requests — and it kept going while backgrounded.
 * The order-detail screen polled every 10s on the same terms.
 *
 * Tested because the failure mode is invisible: nothing breaks, it just costs battery, data
 * and backend capacity.
 */
import { describe, expect, it } from '@jest/globals';
import { AppState } from 'react-native';

import { isAppForeground } from '../appForeground';

function setAppState(state: string) {
  // AppState.currentState is a plain readable property on the RN module.
  (AppState as unknown as { currentState: string }).currentState = state;
}

describe('isAppForeground', () => {
  it('is true only when the app is active', () => {
    setAppState('active');
    expect(isAppForeground()).toBe(true);
  });

  it('is false while backgrounded, so polls stop', () => {
    setAppState('background');
    expect(isAppForeground()).toBe(false);
  });

  it('is false while inactive (iOS app switcher, incoming call)', () => {
    setAppState('inactive');
    expect(isAppForeground()).toBe(false);
  });

  it('reads AppState on every call rather than caching it', () => {
    setAppState('background');
    expect(isAppForeground()).toBe(false);
    // Polling must resume as soon as the passenger reopens the app, without the screen
    // remounting — so this must not be a value captured once at module load.
    setAppState('active');
    expect(isAppForeground()).toBe(true);
  });
});
