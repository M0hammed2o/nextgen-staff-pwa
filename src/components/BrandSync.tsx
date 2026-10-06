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
 *  3. Pull the live branding (logo, colours, trading name) from
 *     GET /v1/business/branding once a staff user is authenticated, and write
 *     it to the cache so the NEXT cold start is already branded.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand-provider";

/** GET /v1/business/branding — the narrow, till-readable identity projection. */
interface BrandingResponse {
  business_id: string;
  display_name: string;
  legal_name: string;
  logo_url: string | null;
  icon_url: string | null;
  primary_colour: string | null;
  accent_colour: string | null;
  theme: string;
}

export function BrandSync() {
  const { savedBusiness, user } = useAuth();
  const brand = useBrand();

  // Only once authenticated: /v1/business/branding is staff_or_above. Before
  // that the PIN screen runs entirely on the cached brand, which is the whole
  // reason the cache exists.
  const { data: live } = useQuery({
    queryKey: ["branding", savedBusiness?.business_id],
    queryFn: () => apiClient.get<BrandingResponse>("/v1/business/branding"),
    enabled: Boolean(user),
    // Branding changes about as often as a restaurant repaints. Re-fetching it
    // on every window focus would be pure noise on a till that is focused and
    // blurred hundreds of times a shift.
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (!live) return;
    brand.setBrand({
      businessId: live.business_id,
      displayName: live.display_name,
      branchName: null,
      logoUrl: live.logo_url,
      iconUrl: live.icon_url,
      primaryColour: live.primary_colour,
      accentColour: live.accent_colour,
    });
    // Keyed on the payload's own fields so an unchanged refetch does not
    // rewrite storage on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    live?.business_id,
    live?.display_name,
    live?.logo_url,
    live?.icon_url,
    live?.primary_colour,
    live?.accent_colour,
  ]);

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
