/**
 * BrandSync — keeps the BrandProvider in step with who is actually signed in.
 *
 * Deliberately a separate component rather than logic inside BrandProvider:
 * `lib/brand-provider.tsx` is shared verbatim with the Manager dashboard, which
 * has a different auth shape. Keeping the app-specific wiring here lets that
 * file stay identical across repos.
 *
 * Two jobs:
 *  1. Give the brand a display name as soon as one is known. The staff app
 *     persists `SavedBusiness` so the till returns to the PIN screen rather
 *     than a full login, which means the restaurant's NAME is available before
 *     any authenticated request can run. Using it here is what makes the PIN
 *     screen say "NOOSH" instead of "NextGen Restaurant OS" on a cold start.
 *  2. Drop the branding the moment the till is pointed at a different
 *     restaurant, so one tenant's identity can never appear over another's
 *     session on a shared device.
 *
 * Colours and logo arrive from the API in Phase C; this component already
 * merges them correctly when they do, because it only ever fills in fields
 * that are missing and never overwrites a configured value.
 */
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand-provider";

export function BrandSync() {
  const { savedBusiness } = useAuth();
  const brand = useBrand();

  useEffect(() => {
    if (!savedBusiness) return;

    const tenantChanged = Boolean(brand.businessId) && brand.businessId !== savedBusiness.business_id;
    if (tenantChanged) {
      // A different restaurant: discard everything, including the cached logo
      // and colours. Never carry one tenant's identity into another's session.
      brand.setBrand({
        businessId: savedBusiness.business_id,
        displayName: savedBusiness.business_name,
      });
      return;
    }

    const needsId = brand.businessId !== savedBusiness.business_id;
    const needsName = !brand.displayName;
    if (needsId || needsName) {
      brand.setBrand({
        ...brand,
        businessId: savedBusiness.business_id,
        displayName: brand.displayName || savedBusiness.business_name,
      });
    }
    // Intentionally keyed on the saved business and the two fields this
    // reconciles -- including the whole `brand` object would re-run on every
    // token derivation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedBusiness?.business_id, savedBusiness?.business_name, brand.businessId, brand.displayName]);

  return null;
}
