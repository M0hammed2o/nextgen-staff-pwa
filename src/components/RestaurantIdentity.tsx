/**
 * RestaurantIdentity — the restaurant's logo/monogram, name and branch.
 *
 * The single place the product says "this is YOUR restaurant's system". Used on
 * the PIN screen, the POS header and anywhere else the tenant should be named.
 *
 * Degrading well is the whole point. A restaurant may have no logo, a broken
 * logo URL, a logo that fails to load on a flaky restaurant Wi-Fi, or no
 * branding at all. In every one of those cases this must still look deliberate:
 * it falls back to a monogram tile in the brand colour, and finally to "NextGen
 * Restaurant OS". A cashier should never see a broken-image glyph on the till.
 */
import { useState } from "react";

import { useBrand } from "@/lib/brand-provider";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const BOX: Record<Size, string> = {
  sm: "h-8 w-8 rounded-md text-xs",
  md: "h-10 w-10 rounded-lg text-sm",
  lg: "h-14 w-14 rounded-xl text-lg",
  xl: "h-20 w-20 rounded-2xl text-2xl",
};

const NAME: Record<Size, string> = {
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
  lg: "text-xl font-semibold",
  xl: "text-2xl font-semibold",
};

export function RestaurantMark({ size = "md", className }: { size?: Size; className?: string }) {
  const { logoUrl, monogram, displayName } = useBrand();
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(logoUrl) && !failed;

  if (showLogo) {
    return (
      <img
        src={logoUrl as string}
        alt={displayName ? `${displayName} logo` : "Restaurant logo"}
        // object-contain, never cover: a logo cropped to fill a square is how a
        // restaurant's identity ends up looking wrong in their own product.
        className={cn(BOX[size], "shrink-0 bg-white object-contain ring-1 ring-border", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        BOX[size],
        "grid shrink-0 place-items-center font-semibold tracking-tight",
        "bg-brand text-brand-foreground",
        className
      )}
    >
      {monogram}
    </div>
  );
}

export function RestaurantIdentity({
  size = "md",
  showBranch = true,
  className,
  nameClassName,
}: {
  size?: Size;
  showBranch?: boolean;
  className?: string;
  nameClassName?: string;
}) {
  const { displayName, branchName } = useBrand();
  const name = displayName?.trim() || "NextGen Restaurant OS";

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <RestaurantMark size={size} />
      <div className="min-w-0">
        <div className={cn(NAME[size], "truncate leading-tight text-foreground", nameClassName)}>
          {name}
        </div>
        {showBranch && branchName ? (
          <div className="truncate text-xs leading-tight text-muted-foreground">{branchName}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The NextGen attribution. Deliberately quiet: the restaurant is the brand on
 * screen, NextGen is the technology underneath.
 */
export function PoweredByNextGen({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-xs text-muted-foreground", className)}>
      Powered by <span className="font-medium text-foreground/70">NextGen</span>
    </p>
  );
}
