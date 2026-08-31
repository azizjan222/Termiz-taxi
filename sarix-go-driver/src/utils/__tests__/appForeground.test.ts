/**
 * Foreground gate for recurring network polls.
 *
 * The driver app polls the order list every 15s and re-polls the active order continuously.
 * Neither was gated on app state, so a backgrounded app kept hitting the API for as long as
 * Android let the JS thread run — wasted battery and data for the driver, and wasted
 * capacity on a backend that runs its DB queries directly on the event loop.
 *
 * Tested because the failure mode is invisible: nothing breaks, it just costs money.
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
    // Polls must resume the moment the driver reopens the app, without remounting the
    // screen — so this must not be a value captured once at module load.
    setAppState('active');
    expect(isAppForeground()).toBe(true);
  });
});
