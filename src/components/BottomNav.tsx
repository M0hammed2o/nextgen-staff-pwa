import { NavLink, useLocation } from "react-router-dom";
import { usePOSSettings } from "@/lib/pos-settings";
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
    to: "/stocktake",
    label: "Stocktake",
    enabled: (s) => !!s?.staff_stocktake_tab_enabled,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
        <rect x="9" y="2" width="6" height="4" rx="1" />
        <path d="m8 13 2 2 5-5" />
      </svg>
    ),
  },
  {
    to: "/wastage",
    label: "Wastage",
    // Hiding this tab does NOT disable wastage: the /wastage route, its API
    // and the manager's wastage reporting all keep working. It only frees a
    // slot on a five-slot phone bar for something this tenant uses more.
    enabled: (s) => s?.staff_wastage_tab_enabled ?? true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M10 11v6M14 11v6" />
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

  // Hide on login and order detail
  if (location.pathname === "/login" || location.pathname.startsWith("/orders/")) {
    return null;
  }

  const tabs = TABS.filter((t) => !t.enabled || t.enabled(settings));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card safe-bottom">
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
