/**
 * Tab-bar geometry.
 *
 * The bar is docked to the bottom edge and rendered by our own `tabBar` component (see
 * app/(tabs)/_layout.tsx), which centres its contents. So this only has to be comfortably
 * larger than the icon + label + underline stack — there is no framework padding to
 * account for.
 *
 * It sits in the normal layout flow, so the navigator reserves the room for it and screen
 * content can never end up hidden behind it. That is deliberate: while the bar floated
 * above the content, every tab screen had to inset its own scroll padding to compensate,
 * and a row of the profile menu still showed through the gap left under the card.
 */

/** Height of the bar's content row, excluding the safe-area inset below it. */
export const TAB_BAR_HEIGHT = 64;
