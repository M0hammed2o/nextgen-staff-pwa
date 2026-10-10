import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { usePOSSettings } from "@/lib/pos-settings";
import { useLoyaltyEnabled } from "@/lib/loyalty";
import { useTouchKeyboardContext } from "@/lib/touch-keyboard";
import type { POSSettings } from "@/types";
import { cn } from "@/lib/utils";

interface Tab {
  to: string;
  label: string;
  icon: JSX.Element;
  /**
   * Whether this tenant shows the tab. Undefined means "always" — Till,
   * Completed and Profile are not configurable, since a staff app with no
   * till and no way to sign out is not a staff app.
   */
  enabled?: (s: POSSettings | null) => boolean;
  /**
   * Loyalty's entitlement isn't on POSSettings (see lib/loyalty.ts's
   * useLoyaltyEnabled doc comment for why) -- a second, independent gate
   * checked alongside `enabled` so a non-POSSettings-backed tab can exist
   * without reshaping every other tab's signature.
   */
  requiresLoyalty?: boolean;
}

const TABS: Tab[] = [
  {
    to: "/",
    label: "Live Orders",
    // A till-only tenant has nothing to watch here: a POS sale is already paid
    // and completed the moment it is rung up. Defaults to shown, so a tenant
    // that has never been configured keeps exactly the tab set it had before.
    enabled: (s) => s?.staff_live_orders_tab_enabled ?? true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
  {
    to: "/pos",
    label: "Till",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 10h18" />
        <path d="M8 14h.01M12 14h4" />
      </svg>
    ),
  },
  {
    // UI V2.1: Wastage is no longer a separate bottom-nav destination -- it
    // is now a tab inside this same Stocktake page (Count / Wastage /
    // Previous Counts), reusing the existing Wastage component rather than
    // duplicating its API calls. See Stocktake.tsx.
    //
    // This tab's own gate is ALSO widened to require `inventory_enabled`,
    // not just `staff_stocktake_tab_enabled` -- both stocktake AND wastage
    // mutation routes require inventory_enabled server-side
    // (_require_inventory_enabled, routes_stocktake.py/routes_wastage.py),
    // so a non-inventory tenant must never be able to reach either workflow
    // via this bar at all, not just stocktake specifically.
    to: "/stocktake",
    label: "Stocktake",
    enabled: (s) => !!s?.staff_stocktake_tab_enabled && !!s?.inventory_enabled,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
        <rect x="9" y="2" width="6" height="4" rx="1" />
        <path d="m8 13 2 2 5-5" />
      </svg>
    ),
  },
  {
    // UI V2.1 (B3): read-only phone-number lookup of a customer's points
    // balance/tier and the current reward catalogue. Redemption itself is
    // unchanged -- it still only ever happens at Till checkout.
    to: "/loyalty",
    label: "Loyalty",
    requiresLoyalty: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect x="2" y="7" width="20" height="5" />
        <line x1="12" y1="22" x2="12" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
      </svg>
    ),
  },
  {
    to: "/completed",
    label: "Completed",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    to: "/profile",
    label: "Profile",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const location = useLocation();
  const { data: settings = null } = usePOSSettings();
  // Hidden (not just disabled) while the probe is loading/unknown -- same
  // "don't flash a tab on then off" posture every other entitlement-gated
  // tab here already uses via `enabled`. false/undefined both read as "not
  // entitled yet", which is the only safe default for an unresolved probe.
  const { data: loyaltyEnabled = false } = useLoyaltyEnabled();
  const { active: touchKeyboardActive } = useTouchKeyboardContext();
  const navRef = useRef<HTMLElement | null>(null);

  // Hide on login, order detail, and while the on-screen keyboard is up (the
  // two occupy the same screen real estate, and there is nothing useful to
  // tap in the nav bar while a field is being typed into).
  const isHidden =
    location.pathname === "/login" || location.pathname.startsWith("/orders/") || touchKeyboardActive;

  // Publish this bar's REAL rendered height as --bottom-nav-height so page
  // layouts (Pos.tsx etc.) can reserve exactly enough space above this
  // always-`fixed` bar for their own bottom-pinned content (e.g. the
  // Checkout button), instead of a guessed constant that can silently drift
  // from the real height (safe-area-inset-bottom, font scaling) and leave
  // only a few pixels of a button tappable. 0px whenever the bar isn't
  // actually on screen, so a page never reserves dead space for it.
  useEffect(() => {
    const root = document.documentElement;
    if (isHidden || !navRef.current) {
      root.style.setProperty("--bottom-nav-height", "0px");
      return;
    }
    const el = navRef.current;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) root.style.setProperty("--bottom-nav-height", `${Math.ceil(h)}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--bottom-nav-height", "0px");
    };
  }, [isHidden]);

  if (isHidden) return null;

  const tabs = TABS.filter((t) => {
    if (t.requiresLoyalty && !loyaltyEnabled) return false;
    return !t.enabled || t.enabled(settings);
  });

  return (
    <nav ref={navRef} className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card safe-bottom">
      <div className="mx-auto flex max-w-lg">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )
            }
          >
            {tab.icon}
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
