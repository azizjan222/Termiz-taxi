/**
 * Floating tab-bar geometry.
 *
 * The tab bar is positioned absolutely so the screen background shows through the gaps
 * around it. That takes it out of the layout flow, so React Navigation can no longer
 * reserve room for it and every tab screen has to inset its own scroll content — without
 * this, the last order in the history list and the last row of the profile menu sit
 * underneath the bar and cannot be reached.
 *
 * Shared from here (rather than read off `useBottomTabBarHeight`) because the height is
 * ours to decide: we set an explicit `height` on `tabBarStyle`, which opts out of the
 * measured value anyway.
 */

/**
 * Height of the bar's own card, excluding the safe-area inset below it.
 *
 * Sized to hold the icon, the label AND the active-tab underline. At 68 it did not: the
 * inner height left after the bar's padding was a couple of pixels short of the stack, so
 * the labels spilled out over the top edge of the card.
 */
export const TAB_BAR_HEIGHT = 78;

/** Gap between the bar's card and the screen edges. */
export const TAB_BAR_MARGIN = 16;

/**
 * Bottom padding a tab screen's scroll content needs, on top of the safe-area inset.
 * Covers the card, the gap under it and a little breathing room above it.
 */
export const TAB_BAR_CONTENT_INSET = TAB_BAR_HEIGHT + TAB_BAR_MARGIN * 2;
