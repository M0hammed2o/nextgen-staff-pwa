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

export function isLandscapePOSLayout(width: number, height: number): boolean {
  return width >= POS_LANDSCAPE_MIN_WIDTH_PX && width >= height;
}
