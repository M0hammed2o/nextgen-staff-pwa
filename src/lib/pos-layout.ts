/**
 * Decides whether the POS should render its persistent, landscape-tuned
 * side-cart panel (built for terminals like 1366x768 / 1024x768) or fall
 * back to the mobile-style full-width cart dialog.
 *
 * A bare `min-width: 768px` breakpoint (Tailwind's `md:`) cannot tell a
 * landscape 1024x768 terminal apart from a portrait 768x1024 tablet — they
 * share a width, but the portrait one has far less width left over once a
 * ~380px side cart is carved out of it, which is what truncated product
 * names in QA at exactly 768px wide in portrait. The real distinguishing
 * signal is orientation/aspect ratio, not raw width alone.
 *
 * `width >= height` (not strictly greater) so an exact square viewport
 * still gets the more space-efficient side panel rather than being forced
 * into the narrower dialog pattern reserved for genuinely narrow/portrait
 * screens.
 */
export const POS_LANDSCAPE_MIN_WIDTH_PX = 768;

/**
 * A phone turned sideways (844x390, 915x412, 932x430) clears the width
 * floor and is landscape, but it is not a terminal: with the fixed-height
 * side-cart layout its ~180px header and the ~67px bottom nav left roughly
 * 70px of menu and ZERO visible cart lines (only Total/Checkout) -- found by
 * the Playwright viewport suite (e2e-tests/tests/staff-mobile-viewport.spec.ts).
 * Below this height the normally-scrolling mobile layout (floating cart bar
 * + cart dialog) is used instead. Every real terminal/tablet target
 * (1024x768, 1366x768, 1280x800, 1024x600) is well above it; landscape
 * phones top out around 430px.
 */
export const POS_LANDSCAPE_MIN_HEIGHT_PX = 500;

export function isLandscapePOSLayout(width: number, height: number): boolean {
  return width >= POS_LANDSCAPE_MIN_WIDTH_PX && height >= POS_LANDSCAPE_MIN_HEIGHT_PX && width >= height;
}
