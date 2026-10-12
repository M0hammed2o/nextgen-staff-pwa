import { useEffect, useState } from "react";
import { isLandscapePOSLayout, POS_LANDSCAPE_MIN_HEIGHT_PX, POS_LANDSCAPE_MIN_WIDTH_PX } from "@/lib/pos-layout";

/**
 * True when the POS should show its persistent, landscape-tuned side-cart
 * panel (min-width AND landscape-ish) — false when it should fall back to
 * the mobile-style full-width cart dialog (any portrait viewport, whatever
 * its width — see src/lib/pos-layout.ts for the full reasoning and
 * KNOWN_BUGS.md for the bug this replaces a bare Tailwind `md:` breakpoint
 * for). Reacts to both a plain resize (dragging a browser window) and a
 * device orientation flip (some browsers fire `orientationchange` without
 * a matching `resize`), plus the two matchMedia queries themselves as a
 * belt-and-braces listener.
 */
export function useIsLandscapePOS(): boolean {
  const [isLandscapePOS, setIsLandscapePOS] = useState<boolean>(() =>
    typeof window === "undefined" ? true : isLandscapePOSLayout(window.innerWidth, window.innerHeight)
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const update = () => setIsLandscapePOS(isLandscapePOSLayout(window.innerWidth, window.innerHeight));
    update();

    const widthQuery = window.matchMedia(`(min-width: ${POS_LANDSCAPE_MIN_WIDTH_PX}px)`);
    const orientationQuery = window.matchMedia("(orientation: landscape)");
    const heightQuery = window.matchMedia(`(min-height: ${POS_LANDSCAPE_MIN_HEIGHT_PX}px)`);
    widthQuery.addEventListener("change", update);
    orientationQuery.addEventListener("change", update);
    heightQuery.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      widthQuery.removeEventListener("change", update);
      orientationQuery.removeEventListener("change", update);
      heightQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return isLandscapePOS;
}
