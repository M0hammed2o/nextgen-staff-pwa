import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import type {
  CartLine, LoyaltyRewardResponse, MenuCategoryEntry, MenuItemEntry, Order, PaymentIntent, POSCheckoutPaymentPayload,
  POSOrderCreateRequest, POSSettings, TillSession,
} from "@/types";
import type { ReceiptDocument } from "@/types/receipt";
import { fetchReceiptDocument } from "@/lib/receipts";
import { listUnconsumedPaidPaymentIntents, formatIntentReceivedAt } from "@/lib/payment-intents";
import { isPosNotEnabledError } from "@/lib/pos-settings";
import ItemOptionsDialog from "@/components/pos/ItemOptionsDialog";
import CartPanel, { lineTotalCents, type OrderMode } from "@/components/pos/CartPanel";
import { previewLoyaltyDiscountCents } from "@/components/pos/LoyaltyRewardPicker";
import PaymentDialog from "@/components/pos/PaymentDialog";
import CashupDialog from "@/components/pos/CashupDialog";
import CustomerReceipt, { printCustomerReceipt } from "@/components/CustomerReceipt";
import ReceiptSendDialog from "@/components/pos/ReceiptSendDialog";
import EmptyState from "@/components/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand-provider";
import { RestaurantMark } from "@/components/RestaurantIdentity";
import { ShoppingBag, Printer, Wallet, PartyPopper, Loader2, RefreshCw, MessageCircle, AlertTriangle } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { cachedGet } from "@/lib/offline/snapshot-cache";
import { resolveSaleCustomerPhone } from "@/lib/ready-notify";
import { useOffline } from "@/lib/offline/offline-context";
import { useTrainingMode } from "@/lib/offline/training";
import { useEventAccess } from "@/lib/offline/event-access";
import type { SnapshotLine } from "@/lib/offline/types";
import ConnectivityBadge from "@/components/offline/ConnectivityBadge";
import { TrainingBanner, EventAccessBanner, OfflineWarnings } from "@/components/offline/TillBanners";
import LocalSaleOverlay, { LocalSlip, type LocalSaleView } from "@/components/offline/LocalSaleOverlay";
import { loadPosDraft, savePosDraft, clearPosDraft, type PosDraftSubmission } from "@/lib/pos-draft";
import { useTouchField } from "@/hooks/useTouchField";
import { useTouchKeyboardContext, useTouchKeyboardSpacerStyle } from "@/lib/touch-keyboard";
import { useIsLandscapePOS } from "@/hooks/useIsLandscapePOS";
import VariantPicker from "@/components/pos/VariantPicker";
import ScanField, { useWedgeScanner } from "@/components/pos/ScanField";
import { fetchItemVariants, resolveScan, warmVariantCache, type ProductVariant } from "@/lib/variants";
import { addLineToCart, buildVariantLine, cartLineToSaleItem } from "@/lib/cart-variant";
import { parseExchangeParams } from "@/lib/returns";
import { friendlyPosError } from "@/lib/pos-errors";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Pos() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Restaurant identity for the header. Falls back to the saved business name
  // and finally to a neutral product name, so an unbranded tenant still gets a
  // deliberate header rather than an empty space.
  const { displayName, branchName } = useBrand();
  const brandName = displayName?.trim() || user?.business_name || "NextGen Restaurant OS";
  const { close: closeTouchKeyboard, active: touchKeyboardActive } = useTouchKeyboardContext();
  // Persistent side-cart (landscape POS terminals) vs mobile-style full-width
  // cart dialog (any portrait viewport, whatever its width) — see
  // src/lib/pos-layout.ts and KNOWN_BUGS.md for why this can't be a bare
  // Tailwind `md:` breakpoint (width alone can't distinguish a portrait
  // tablet from a landscape terminal at the same width).
  const isLandscapePOS = useIsLandscapePOS();
  const [activeCategory, setActiveCategory] = useState<string | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [optionsItem, setOptionsItem] = useState<MenuItemEntry | null>(null);
  // Variant flow: the item whose picker is open, its variants (null until
  // loaded), and a variant already chosen that still needs the options dialog.
  const [variantItem, setVariantItem] = useState<MenuItemEntry | null>(null);
  const [variantList, setVariantList] = useState<ProductVariant[] | null>(null);
  const variantTapToken = useRef(0);
  const [pendingVariant, setPendingVariant] = useState<ProductVariant | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  // Exchange: the refunded order this sale replaces (from /pos?exchange_of=..).
  const [searchParams, setSearchParams] = useSearchParams();
  const [exchange, setExchange] = useState<{ id: string; number: string } | null>(() =>
    parseExchangeParams(searchParams),
  );
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [cashupOpen, setCashupOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderMode, setOrderMode] = useState<OrderMode>("PICKUP");
  const [tableNumber, setTableNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // "Notify when ready (WhatsApp)" opt-in. Deliberately NOT persisted in the
  // draft (consent must be given afresh for each sale) and cleared per sale.
  const [notifyPhone, setNotifyPhone] = useState("");
  const [notifyConsent, setNotifyConsent] = useState(false);
  const [discountRand, setDiscountRand] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  // The cashier's current reward pick, if any — see LoyaltyRewardPicker.tsx
  // for the selection/filtering UI and DRAFT-PERSISTENCE DECISION below for
  // why this is never written to pos-draft.ts.
  const [loyaltyReward, setLoyaltyReward] = useState<LoyaltyRewardResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [receiptDocument, setReceiptDocument] = useState<ReceiptDocument | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [printFailed, setPrintFailed] = useState(false);
  // The post-sale "Print / WhatsApp / Both / No receipt" choice — see
  // ReceiptSendDialog for the actual WhatsApp send/status/retry flow this
  // opens. Tracked only to show a small "no receipt sent" confirmation and
  // to tell ReceiptSendDialog whether a print was ALSO requested (for its
  // "WhatsApp isn't available" copy) — never gates anything security-related.
  const [receiptChoice, setReceiptChoice] = useState<"PRINT" | "WHATSAPP" | "BOTH" | "NONE" | null>(null);
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);
  // A sale that never reached the server: either captured offline (queued) or
  // a training sale (never sent). Shown instead of the server-order overlay.
  const [localSale, setLocalSale] = useState<LocalSaleView | null>(null);
  const [showLocalSlip, setShowLocalSlip] = useState(false);

  // ── Draft persistence + checkout submission state machine ───────────────
  // See src/lib/pos-draft.ts for the full design rationale. Short version:
  // "idle" = cart is freely editable; "in_flight" = a checkout request was
  // sent and its outcome is unknown (reload/timeout/tab-close mid-request) —
  // the cart is frozen and the only allowed action is re-sending the exact
  // same payload under the exact same idempotency key.
  const [submissionState, setSubmissionState] = useState<PosDraftSubmission>({ status: "idle" });
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const didRestoreDraftRef = useRef(false);

  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ["pos-categories"],
    queryFn: () => cachedGet<MenuCategoryEntry[]>(user?.business_id, "categories", "/v1/business/menu/categories"),
    networkMode: "always", // offline must fall back to the cached menu, not pause forever
  });

  const { data: items = [], isLoading: loadingItems, error: itemsError } = useQuery({
    queryKey: ["pos-items"],
    queryFn: () => cachedGet<MenuItemEntry[]>(user?.business_id, "items", "/v1/business/menu/items"),
    networkMode: "always",
  });

  const { data: till, isFetched: tillFetched } = useQuery({
    queryKey: ["till-current"],
    queryFn: () => cachedGet<TillSession | null>(user?.business_id, "till", "/v1/business/pos/till/current"),
    networkMode: "always",
  });
  // Offline resilience, training and event gating (src/lib/offline/*).
  const offline = useOffline();
  const training = useTrainingMode();
  const eventAccess = useEventAccess();
  const online = offline.online;
  // Training runs a virtual till: no real till session is needed or touched.
  const tillOpen = !!till || training.active;

  // -- Paid-but-unconsumed Pay-by-Link recovery --------------------------
  // A Pay-by-Link intent that reached PAID but was never consumed into an
  // order (cashier backed out, refresh, browser crash) is real received
  // money with no order pointing at it. Checked on mount (so a refresh
  // re-shows it -- deliberately NOT gated on any in-memory state), whenever
  // a till is opened, and after every completed sale (see
  // finishSuccessfulSale). Never polled on an interval.
  const {
    data: unconsumedPaidIntents = [],
    isError: unconsumedPaidError,
    isFetching: unconsumedPaidFetching,
    refetch: refetchUnconsumedPaid,
  } = useQuery({
    queryKey: ["pos-unconsumed-paid-intents"],
    queryFn: listUnconsumedPaidPaymentIntents,
  });
  // The intent the cashier picked via "Resume Sale" -- offered to
  // PaymentDialog's Pay-by-Link sub-flow as "Use existing payment".
  // In-memory only: after a refresh the banner (re-fetched on mount) is the
  // way back to it.
  const [resumeIntent, setResumeIntent] = useState<PaymentIntent | null>(null);
  const lastTillIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!tillFetched) return;
    const currentId = till?.id ?? null;
    // Only on a real transition to a (new) open till -- the initial load is
    // already covered by the query's own on-mount fetch.
    if (lastTillIdRef.current !== undefined && currentId && currentId !== lastTillIdRef.current) {
      void refetchUnconsumedPaid();
    }
    lastTillIdRef.current = currentId;
  }, [till?.id, tillFetched, refetchUnconsumedPaid]);
  // Drop a resume selection once that intent is no longer unconsumed (used
  // by this sale, or resolved from another device).
  useEffect(() => {
    if (resumeIntent && !unconsumedPaidIntents.some((i) => i.id === resumeIntent.id)) {
      setResumeIntent(null);
    }
  }, [unconsumedPaidIntents, resumeIntent]);

  const { data: posSettings = null } = useQuery({
    queryKey: ["pos-settings"],
    queryFn: () => cachedGet<POSSettings>(user?.business_id, "settings", "/v1/business/pos/settings"),
    networkMode: "always",
  });

  // Entitlement only. A `true` here means the module is switched on for this
  // tenant -- it is NOT a claim that a Meta message template has been approved,
  // which only the send attempt can establish and which ReceiptSendDialog
  // reports honestly on its own.
  const whatsappReceiptsAvailable = posSettings?.digital_receipts_enabled === true;

  // Restore a persisted draft exactly once, after the menu has loaded (so we
  // can re-validate cart lines against it). Deliberately per-user (see
  // pos-draft.ts) — a different cashier logging into the same terminal never
  // silently inherits this draft, since loadPosDraft is keyed on user.id too.
  useEffect(() => {
    if (didRestoreDraftRef.current) return;
    if (loadingItems || loadingCategories) return;
    if (!user?.business_id || !user?.id) return;
    didRestoreDraftRef.current = true;

    const draft = loadPosDraft(user.business_id, user.id);
    if (!draft) return;

    const activeItemIds = new Set(items.filter((i) => i.is_active).map((i) => i.id));
    const validLines = draft.cart.filter((line) => activeItemIds.has(line.menuItemId));
    const droppedCount = draft.cart.length - validLines.length;

    setCart(validLines);
    setOrderMode(draft.orderMode);
    setTableNumber(draft.tableNumber);
    setCustomerName(draft.customerName);
    setCustomerPhone(draft.customerPhone);
    setDiscountRand(draft.discountRand);
    setDiscountReason(draft.discountReason);
    setIdempotencyKey(draft.idempotencyKey);
    setSubmissionState(draft.submission);
    // DRAFT-PERSISTENCE DECISION (loyalty reward selection): deliberately
    // NEVER restored — PosDraftV1/PosDraftFields (pos-draft.ts) carries no
    // loyaltyReward field at all, on purpose. A restored draft can be
    // hours old (see DRAFT_MAX_AGE_MS) and the "in progress" pick here is a
    // live UI convenience, not a committed fact about the sale the way the
    // cart/phone/discount are — restoring a stale reward selection risks
    // silently re-attaching a reward to a DIFFERENT set of cart lines (the
    // very hazard this feature's spec calls out), or one the customer's
    // balance can no longer actually afford by the time the till reloads.
    // Safety over convenience: always start unselected and make the
    // cashier re-pick, exactly like a resend from a frozen in-flight
    // payload is the ONLY thing allowed to carry an already-attached
    // reward through a reload (see submissionState.payload, which DOES
    // legitimately embed loyalty_reward_id once a checkout was actually
    // sent — that's a different, already-submitted request, not a live
    // pick).
    setLoyaltyReward(null);

    if (validLines.length > 0 || draft.submission.status === "in_flight") {
      setDraftNotice(
        droppedCount > 0
          ? `Your unfinished order was restored — ${droppedCount} item${droppedCount === 1 ? "" : "s"} removed (no longer on the menu).`
          : "Your unfinished order was restored."
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingItems, loadingCategories, items, user?.business_id, user?.id]);

  // Persist the draft on every relevant change, after restoration has run
  // (never save before restoring, or we'd immediately overwrite the very
  // draft we're about to read). An empty, idle cart has nothing worth
  // persisting, so it clears the draft instead of writing an empty one.
  useEffect(() => {
    if (!didRestoreDraftRef.current) return;
    if (!user?.business_id || !user?.id) return;
    if (cart.length === 0 && submissionState.status === "idle") {
      clearPosDraft(user.business_id, user.id);
      return;
    }
    savePosDraft(user.business_id, user.id, {
      cart, orderMode, tableNumber, customerName, customerPhone,
      discountRand, discountReason, idempotencyKey, submission: submissionState,
    });
  }, [
    cart, orderMode, tableNumber, customerName, customerPhone,
    discountRand, discountReason, idempotencyKey, submissionState,
    user?.business_id, user?.id,
  ]);

  // ── Loyalty reward selection safety — clear on anything that could make
  //    a stale pick apply to the wrong customer/cart/session. Each of these
  //    is one of the consequences this feature's spec explicitly calls
  //    out; "checkout succeeding" is covered by resetForNextSale() below,
  //    "cashier logging out" needs no handling here (this is in-memory
  //    React state that dies with the component on logout/navigation), and
  //    "cart restoration from pos-draft.ts" is covered above (never
  //    restored in the first place). ────────────────────────────────────
  //
  // Customer phone changed (including being cleared, or still mid-typing)
  // — a reward is tied to the specific customer it was checked against;
  // ANY change invalidates that, not just a change to a "different" number.
  useEffect(() => {
    setLoyaltyReward(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone]);

  // Cart emptied (every line removed, or resetForNextSale, which also
  // clears it directly) — a reward must never silently carry over onto
  // whatever gets rung up next.
  useEffect(() => {
    if (cart.length === 0) setLoyaltyReward(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.length]);

  // Till session changed (closed and a new one opened) — a reward checked
  // against one till session's context must not silently ride into another.
  useEffect(() => {
    setLoyaltyReward(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [till?.id]);

  const visibleItems = useMemo(() => {
    let active = items.filter((i) => i.is_active);
    if (activeCategory !== "ALL") active = active.filter((i) => i.category_id === activeCategory);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      active = active.filter((i) => i.name.toLowerCase().includes(q));
    }
    return active;
  }, [items, activeCategory, search]);

  function itemHasChoices(item: MenuItemEntry): boolean {
    // A group with no explicit `is_enabled` key is enabled by default -- this
    // must match the backend's own default (backend/app/pos/pricing.py's
    // `group.get("is_enabled", True)`), or a menu item whose option groups
    // were seeded/persisted without that key (e.g. Barn Owl's Cappuccino)
    // silently skips its own required-size prompt here while the backend
    // still rejects the order for missing it.
    const hasGroups = (item.options_json?.option_groups ?? []).some((g) => g.is_enabled !== false);
    const hasAddOns = item.add_ons.some((a) => a.is_active);
    const hasRemovable = (item.options_json?.removable_ingredients ?? []).length > 0;
    return hasGroups || hasAddOns || hasRemovable;
  }

  function addSimpleItem(item: MenuItemEntry) {
    setCart((prev) => {
      const existing = prev.find((l) => l.key === item.id);
      if (existing) {
        return prev.map((l) => (l.key === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const newLine: CartLine = {
        key: item.id,
        menuItemId: item.id,
        name: item.name,
        basePriceCents: item.price_cents,
        quantity: 1,
        requiresPreparation: item.requires_preparation,
        selectedOptionIds: {},
        selectedOptionsDisplay: [],
        addOnSelections: [],
        removedIngredientIds: [],
        removedIngredientsDisplay: [],
        specialInstructions: null,
      };
      return [...prev, newLine];
    });
  }

  // The menu list says which items have active variants (`has_variants`); a
  // tap on one of those asks for them (cached after the first time, so instant
  // offline and on repeat taps). An item with `has_variants: false` makes no
  // request (fetchItemVariants answers [] locally) and behaves exactly as
  // before; an older backend that omits the field is still asked.
  // The picker dialog only opens once variants are known to exist, so a plain
  // menu item never flashes it. If the lookup fails (older backend, 5xx) the
  // item is treated as a plain item: the server still refuses a variant item
  // sold without one (VARIANT_REQUIRED, mapped to a clear message), so a
  // failed lookup can never sell the wrong thing, and it never blocks a
  // restaurant sale.
  async function loadVariantsFor(item: MenuItemEntry) {
    const token = ++variantTapToken.current;
    let list: ProductVariant[] = [];
    try {
      list = await fetchItemVariants(user?.business_id, item);
    } catch {
      list = [];
    }
    if (token !== variantTapToken.current) return; // a newer tap superseded this one
    if (list.length === 0) {
      if (itemHasChoices(item)) setOptionsItem(item);
      else addSimpleItem(item);
      return;
    }
    setVariantList(list);
    setVariantItem(item);
  }

  function handleTileTap(item: MenuItemEntry) {
    void loadVariantsFor(item);
  }

  function addVariantToCart(item: MenuItemEntry, variant: ProductVariant) {
    if (itemHasChoices(item)) {
      setPendingVariant(variant);
      setOptionsItem(item);
      return;
    }
    setCart((prev) => addLineToCart(prev, buildVariantLine(item, variant)));
    if (!isLandscapePOS) setMobileCartOpen(true);
  }

  function handlePickVariant(variant: ProductVariant) {
    const item = variantItem;
    if (!item) return;
    setVariantItem(null);
    setVariantList(null);
    addVariantToCart(item, variant);
  }

  async function handleScan(code: string) {
    if (!tillOpen) {
      setScanMessage({ kind: "error", text: "Open the till before scanning." });
      return;
    }
    setScanBusy(true);
    setScanMessage(null);
    try {
      const res = await resolveScan(user?.business_id, code, online);
      if (res.kind === "not_found") {
        setScanMessage({
          kind: "error",
          text: `"${code}" was not found${online ? "" : " on this device (offline: only products already loaded can be scanned)"}.`,
        });
        return;
      }
      if (res.kind === "error") {
        setScanMessage({ kind: "error", text: res.message });
        return;
      }
      const { result } = res;
      const item =
        items.find((i) => i.id === result.menu_item_id) ??
        ({
          id: result.menu_item_id, category_id: null, name: result.menu_item_name, description: null,
          price_cents: result.base_price_cents, currency: "ZAR", options_json: null, add_ons: [], is_active: true,
          sort_order: 0, image_url: null, requires_preparation: false,
        } as MenuItemEntry);
      setScanMessage({ kind: "info", text: `Added ${item.name} (${result.variant.label})` });
      addVariantToCart(item, result.variant);
    } finally {
      setScanBusy(false);
    }
  }

  // Scan without tapping the box first (keyboard-wedge scanners).
  useWedgeScanner((code) => void handleScan(code), !paymentOpen && !optionsItem && !variantItem && !cashupOpen);

  // Make offline barcode/SKU entry work: remember every item's variants while
  // online (throttled; skips anything fetched recently).
  useEffect(() => {
    if (!online || training.active || items.length === 0) return;
    let cancelled = false;
    void warmVariantCache(user?.business_id, items.filter((i) => i.is_active), { isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, items, user?.business_id]);

  function clearExchange() {
    setExchange(null);
    if (searchParams.has("exchange_of") || searchParams.has("exchange_no")) {
      const next = new URLSearchParams(searchParams);
      next.delete("exchange_of");
      next.delete("exchange_no");
      setSearchParams(next, { replace: true });
    }
  }

  function handleAddFromDialog(result: {
    selectedOptionIds: Record<string, string>;
    selectedOptionsDisplay: { groupName: string; optionName: string; priceDeltaCents: number }[];
    addOnSelections: { addOnId: string; name: string; priceCents: number; quantity: number }[];
    removedIngredientIds: string[];
    removedIngredientsDisplay: { id: string; name: string }[];
    specialInstructions: string | null;
  }) {
    if (!optionsItem) return;
    const newLine: CartLine = pendingVariant
      ? buildVariantLine(optionsItem, pendingVariant, result)
      : {
          key: `${optionsItem.id}::${Date.now()}`,
          menuItemId: optionsItem.id,
          name: optionsItem.name,
          basePriceCents: optionsItem.price_cents,
          quantity: 1,
          requiresPreparation: optionsItem.requires_preparation,
          ...result,
        };
    setCart((prev) => [...prev, newLine]);
    setOptionsItem(null);
    setPendingVariant(null);
    // The mobile cart dialog only renders when the persistent side-cart
    // panel isn't shown (see isLandscapePOS above) — opening it while the
    // side panel IS shown rendered a full-screen dialog overlay with
    // nothing visible inside it, and the very next tap anywhere just
    // dismissed that blank overlay instead of reaching whatever the
    // cashier meant to tap.
    if (!isLandscapePOS) setMobileCartOpen(true);
  }

  function updateQty(key: string, quantity: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function resetForNextSale() {
    setCart([]);
    setOrderMode("PICKUP");
    setTableNumber("");
    setCustomerName("");
    setCustomerPhone("");
    setNotifyPhone("");
    setNotifyConsent(false);
    setDiscountRand("");
    setDiscountReason("");
    setLoyaltyReward(null);
    clearExchange();
    setIdempotencyKey(newIdempotencyKey());
    setErrorMessage(null);
    setSubmissionState({ status: "idle" });
    setDraftNotice(null);
    setRecoveryError(null);
    if (user?.business_id && user?.id) clearPosDraft(user.business_id, user.id);
  }

  const subtotalCents = cart.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discountCents = Math.round((parseFloat(discountRand || "0") || 0) * 100);
  // PREVIEW ONLY — see LoyaltyRewardPicker.tsx's docstring. Computed with
  // the exact same clamp formula the backend uses, purely so the cashier
  // isn't flying blind before Pay; the committed order's own
  // loyalty_discount_cents (from the backend response) is the only real
  // figure this app ever prints on a receipt or "Sale complete" screen.
  const loyaltyDiscountPreviewCents = previewLoyaltyDiscountCents(loyaltyReward, subtotalCents, discountCents);
  const deliveryFeeCents = orderMode === "DELIVERY" ? (posSettings?.delivery_fee_cents ?? 0) : 0;
  const estimatedTotalCents = Math.max(0, subtotalCents - discountCents - loyaltyDiscountPreviewCents) + deliveryFeeCents;

  // Fetches the backend's authoritative receipt document for a just-placed
  // order and prints THAT — never a locally-rebuilt slip (see BUG-0045).
  // The sale itself is already safely saved by the time this runs (it is
  // only ever called from finishSuccessfulSale, strictly after the order
  // was created and the draft/idempotency state was cleared) — a failure
  // here can NEVER cause a second POST to /pos/orders, only a "receipt
  // didn't print" banner with a retry that re-fetches, never re-submits.
  async function printReceiptForOrder(orderId: string) {
    try {
      const doc = await fetchReceiptDocument(orderId);
      setReceiptDocument(doc);
      setPrintFailed(false);
      setShowReceipt(true);
      // One frame for the hidden receipt to mount before window.print().
      setTimeout(() => {
        try {
          printCustomerReceipt();
        } catch {
          setPrintFailed(true);
        } finally {
          setShowReceipt(false);
        }
      }, 100);
    } catch {
      setPrintFailed(true);
    }
  }

  // Shared by both a normal checkout success and the recovery flow (a
  // same-key resend after an "outcome unknown" submission) — one place that
  // decides what "the sale is definitely done" means, so the two call sites
  // can never drift apart on print/reset behaviour.
  function finishSuccessfulSale(order: Order) {
    setPaymentOpen(false);
    setMobileCartOpen(false);
    setLastOrder(order);
    setReceiptChoice(null);
    setWhatsappDialogOpen(false);
    resetForNextSale();
    // Don't wait for PaymentDialog's close animation to unmount the cash
    // field (that's what used to leave the keyboard open, covering the
    // "Sale complete" overlay's "New sale" button for the duration of the
    // transition) — close it the instant the sale is known to have
    // succeeded.
    closeTouchKeyboard();
    queryClient.invalidateQueries({ queryKey: ["live-orders"] });
    // A completed sale may have consumed a resumed paid intent (or another
    // device may have resolved one) -- re-check rather than trust the banner.
    queryClient.invalidateQueries({ queryKey: ["pos-unconsumed-paid-intents"] });

    // Print AFTER the sale is safely saved, and never inside the try that
    // guards the sale itself. Payment and printing are separate concerns:
    // an offline printer (or a receipt fetch that times out) must not make
    // a paid order look like it failed, or the cashier will ring it up a
    // second time.
    if (posSettings?.receipt_auto_print !== false) {
      void printReceiptForOrder(order.id);
    }
  }

  // `allowNotify` is false for anything captured offline: WhatsApp needs
  // internet, so an offline sale must never carry the notify number.
  function buildSaleBody(payload: POSCheckoutPaymentPayload, key: string, allowNotify = false): POSOrderCreateRequest {
    const salePhone = resolveSaleCustomerPhone({
      loyaltyPhone: customerPhone,
      notifyPhone,
      consent: notifyConsent,
      available: allowNotify && online && !training.active && eventAccess.readyNotifyAvailable,
      rewardApplied: !!loyaltyReward,
    });
    return {
      order_mode: orderMode,
      table_number: orderMode === "DINE_IN" ? (tableNumber.trim() || null) : null,
      customer_name: customerName.trim() || null,
      customer_phone: salePhone,
      discount_cents: discountCents > 0 ? discountCents : undefined,
      discount_reason: discountCents > 0 ? (discountReason.trim() || null) : null,
      // The backend requires customer_phone whenever this is set
      // (routes_pos.py::POSOrderCreateRequest.validate_loyalty_redemption)
      // - loyaltyReward is already cleared the instant customerPhone
      // changes (see the effects above), but this guard is cheap insurance
      // against ever sending a redemption with no phone attached.
      loyalty_reward_id: loyaltyReward && salePhone ? loyaltyReward.id : undefined,
      items: cart.map(cartLineToSaleItem),
      ...(exchange ? { exchange_of_order_id: exchange.id } : {}),
      // Exactly one of the two checkout payment shapes - see
      // PaymentDialog.tsx's "Split payment" entry point and
      // POSCheckoutPaymentPayload's docstring in src/types/index.ts.
      ...("payments" in payload
        ? { payments: payload.payments }
        : {
            payment_method: payload.payment_method,
            cash_tendered_cents: payload.cash_tendered_cents,
            payment_reference: payload.payment_reference,
          }),
      idempotency_key: key,
    };
  }

  // What the cashier saw, for the queue screen / provisional slip. DISPLAY
  // ONLY: the server re-prices every line on sync.
  function snapshotLines(): SnapshotLine[] {
    return cart.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      detail:
        [
          ...(l.variantLabel ? [l.variantLabel] : []),
          ...l.selectedOptionsDisplay.map((o) => o.optionName),
          ...l.addOnSelections.map((a) => `+ ${a.name}`),
          ...l.removedIngredientsDisplay.map((r) => `no ${r.name}`),
        ].join(", ") || null,
      line_total_cents: lineTotalCents(l),
    }));
  }

  function cashFigures(payload: POSCheckoutPaymentPayload) {
    const tendered = "payment_method" in payload ? (payload.cash_tendered_cents ?? null) : null;
    return { tendered, change: tendered != null ? Math.max(0, tendered - estimatedTotalCents) : null };
  }

  function showLocalSaleAndReset(view: LocalSaleView) {
    setPaymentOpen(false);
    setMobileCartOpen(false);
    closeTouchKeyboard();
    resetForNextSale();
    setLocalSale(view);
  }

  // Training: the sale stays in memory. No apiClient call happens here.
  function completeTrainingSale(payload: POSCheckoutPaymentPayload) {
    const { tendered, change } = cashFigures(payload);
    const sale = training.addSale({
      total_cents: estimatedTotalCents,
      cash_tendered_cents: tendered,
      change_due_cents: change,
      lines: snapshotLines(),
    });
    showLocalSaleAndReset({ kind: "training", ...sale });
  }

  // Durable offline capture of a CASH sale under `key` (the idempotency key
  // the server will see, identical on every retry). Returns false if it could
  // not be captured, in which case nothing has been recorded.
  async function captureCashSaleOffline(payload: POSCheckoutPaymentPayload, key: string): Promise<boolean> {
    if (!eventAccess.canTrade) {
      setErrorMessage("Trading is not open for this event vendor, so this sale cannot be saved.");
      return false;
    }
    if (loyaltyReward) {
      setErrorMessage("Loyalty rewards need internet. Remove the reward to take this sale offline.");
      return false;
    }
    const { tendered, change } = cashFigures(payload);
    const lines = snapshotLines();
    try {
      const entry = await offline.enqueueSale({
        request: buildSaleBody(payload, key),
        snapshot: { lines, total_cents: estimatedTotalCents, cash_tendered_cents: tendered, change_due_cents: change },
      });
      showLocalSaleAndReset({
        kind: "offline",
        ref: entry.local_ref,
        created_at: entry.created_at,
        total_cents: estimatedTotalCents,
        cash_tendered_cents: tendered,
        change_due_cents: change,
        lines,
      });
      return true;
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not save the sale on this device.");
      return false;
    }
  }

  function handlePrintLocalSlip() {
    setPrintFailed(false);
    setShowLocalSlip(true);
    setTimeout(() => {
      try {
        window.print();
      } catch {
        setPrintFailed(true);
      } finally {
        setShowLocalSlip(false);
      }
    }, 100);
  }

  async function handleConfirmPayment(payload: POSCheckoutPaymentPayload) {
    const isCash = "payment_method" in payload && payload.payment_method === "CASH";
    if (training.active) {
      completeTrainingSale(payload);
      return;
    }
    if (!online) {
      setErrorMessage(null);
      if (!isCash) {
        setErrorMessage("Card, payment links and other payments need internet. Take this sale as cash.");
        return;
      }
      setIsSubmitting(true);
      try {
        await captureCashSaleOffline(payload, idempotencyKey);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const body = buildSaleBody(payload, idempotencyKey, true);
    // Freeze this exact payload + key as "in flight" BEFORE sending. If the
    // response never comes back (timeout, reload, tab close) this is what
    // lets a later reload recover safely — resending the SAME payload under
    // the SAME key, never a fresh one, since the backend returns the
    // original order for a repeated key.
    setSubmissionState({ status: "in_flight", payload: body, idempotencyKey, startedAt: Date.now() });
    try {
      const order = await apiClient.post<Order>("/v1/business/pos/orders", body);
      finishSuccessfulSale(order);
    } catch (err) {
      const apiErr = err as ApiFetchError;
      if (apiErr?.noResponse) {
        // A CASH sale that got no HTTP response is captured to the durable
        // offline queue under the SAME idempotency key it was just sent with:
        // if the server did receive it, the replay returns the original order
        // instead of a duplicate. Only if that capture is impossible do we
        // fall back to the blocking "outcome unknown" recovery card.
        if (isCash && offline.available && (await captureCashSaleOffline(payload, idempotencyKey))) {
          return;
        }
        // Outcome unknown — do NOT clear the in-flight state (it's already
        // persisted). Close the payment dialog and let the blocking recovery
        // card (rendered below, driven by submissionState) take over instead
        // of showing a normal "failed" error — we do not yet know that.
        setPaymentOpen(false);
      } else {
        if (apiErr?.code === "EVENT_TRADING_NOT_ALLOWED") eventAccess.refresh();
        // A real HTTP response came back rejecting the order (validation,
        // till closed, etc.) — the backend's idempotency check runs before
        // any of that, so no order exists under this key. Safe to go back to
        // idle and let the cashier fix the cart and retry with the same key.
        setSubmissionState({ status: "idle" });
        // A WhatsApp-only tenant's staff can still reach this screen by URL
        // despite Till being hidden from the nav (BottomNav.tsx) — show a
        // specific, honest message rather than the backend's generic 409
        // text, which isn't written for a cashier to read.
        setErrorMessage(
          isPosNotEnabledError(apiErr)
            ? "POS is not available for this restaurant"
            : friendlyPosError(apiErr, "Could not complete the sale — try again")
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // Recovery: resend the EXACT payload/key an unknown-outcome submission was
  // sent with. Manual, single-shot per click — never an automatic retry
  // loop. Safe regardless of what actually happened last time: the backend
  // returns the original order if it was created, or creates it now for the
  // first time if it wasn't — never a duplicate.
  async function handleRecoverySubmit() {
    if (submissionState.status !== "in_flight") return;
    setRecoverySubmitting(true);
    setRecoveryError(null);
    try {
      const order = await apiClient.post<Order>("/v1/business/pos/orders", submissionState.payload);
      finishSuccessfulSale(order);
    } catch (err) {
      const apiErr = err as ApiFetchError;
      if (apiErr?.noResponse) {
        // Still don't know — stay in_flight, let the cashier try again.
        setRecoveryError("Still couldn't reach the server. Check the connection and try again.");
      } else {
        // A definite rejection this time proves no order exists under this
        // key (the idempotency check runs first, before this rejection could
        // have happened) — safe to unfreeze the cart.
        setSubmissionState({ status: "idle" });
        setRecoveryError(
          isPosNotEnabledError(apiErr)
            ? "POS is not available for this restaurant"
            : apiErr?.message ?? "That sale could not be completed. Check the details and try again."
        );
      }
    } finally {
      setRecoverySubmitting(false);
    }
  }

  // Manual "Print receipt" / retry button in the success overlay — always
  // re-fetches the document rather than reusing a stale one, and never
  // touches the order/checkout endpoint.
  function handlePrintReceipt() {
    if (!lastOrder) return;
    void printReceiptForOrder(lastOrder.id);
  }

  // The post-sale receipt step: Print/Both trigger the EXISTING print flow
  // above (never re-implemented here); WhatsApp/Both open ReceiptSendDialog
  // for the actual send/status/retry. "No receipt" makes no call at all —
  // it only records the choice so the cashier gets a small confirmation
  // that nothing was sent, it never auto-dismisses "Sale complete" (the
  // order total/change info there may still be worth a glance).
  function handleReceiptChoice(choice: "PRINT" | "WHATSAPP" | "BOTH" | "NONE") {
    setReceiptChoice(choice);
    if (choice === "PRINT" || choice === "BOTH") {
      handlePrintReceipt();
    }
    if (choice === "WHATSAPP" || choice === "BOTH") {
      setWhatsappDialogOpen(true);
    }
  }

  const searchTouch = useTouchField({ value: search, onChange: setSearch, layout: "QWERTY" });
  const mobileCartKeyboardSpacer = useTouchKeyboardSpacerStyle();

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const isLoading = loadingCategories || loadingItems;

  const checkoutBlockedReason =
    !training.active && !eventAccess.canTrade
      ? eventAccess.syncOnly
        ? "The event has ended: new sales are switched off. Offline sales saved on this device still upload for a manager to approve."
        : eventAccess.level === "CONFIGURE"
        ? "Set-up mode: selling opens when your paid event day starts. You can practise in Training mode."
        : "Your event access has ended: selling is switched off. You can practise in Training mode."
      : null;
  // BUG-0208: after the event only the upload of queued offline sales is allowed,
  // so the menu (which the server no longer serves) is replaced by that state.
  const syncOnlyMode = eventAccess.syncOnly && !training.active;

  const cartPanel = (
    <CartPanel
      lines={cart}
      onUpdateQty={updateQty}
      onRemove={removeLine}
      orderMode={orderMode}
      onOrderModeChange={setOrderMode}
      tableNumber={tableNumber}
      onTableNumberChange={setTableNumber}
      posSettings={posSettings}
      customerName={customerName}
      onCustomerNameChange={setCustomerName}
      customerPhone={customerPhone}
      onCustomerPhoneChange={setCustomerPhone}
      discountRand={discountRand}
      onDiscountRandChange={setDiscountRand}
      discountReason={discountReason}
      onDiscountReasonChange={setDiscountReason}
      loyaltyReward={loyaltyReward}
      onLoyaltyRewardChange={setLoyaltyReward}
      tillOpen={tillOpen}
      errorMessage={null}
      onCheckout={() => setPaymentOpen(true)}
      checkoutBlockedReason={checkoutBlockedReason}
      // Souk event vendors (KNOWN_BUGS BUG-0210): the opt-in is offered only
      // when the backend reports the ready message can really be sent (the
      // platform enabled WhatsApp, the vendor's own number is connected and
      // its order-ready template is approved). Otherwise it stays hidden
      // rather than promising a message, and the /board collection screen is
      // the "order ready" path. Restaurants: unchanged.
      readyNotify={!eventAccess.readyNotifyAvailable ? undefined : {
        phone: notifyPhone,
        onPhoneChange: setNotifyPhone,
        consent: notifyConsent,
        onConsentChange: setNotifyConsent,
        trainingMode: training.active,
        online,
      }}
    />
  );

  return (
    // The persistent-side-cart layout (isLandscapePOS) drives this
    // container's shrink-by-the-on-screen-keyboard height (0px when closed,
    // via the --touch-keyboard-height CSS var TouchKeyboard.tsx sets) so the
    // panel's checkout button and order total are pushed up above the
    // keyboard instead of being covered by it. This used to be a bare
    // Tailwind `md:` breakpoint (width-only) — now driven by
    // useIsLandscapePOS() instead, since a portrait tablet can share a
    // width with a landscape terminal but needs the OTHER (mobile-style)
    // layout entirely, not just a narrower cart (see KNOWN_BUGS.md).
    // The `min-h-0` override is load-bearing whenever isLandscapePOS is
    // true: the base `min-h-screen` (now `min-h-app`, needed for the
    // normally-scrolling mobile-style layout) sets a full-viewport
    // min-height, which previously
    // silently WON over the explicit `h-[...]` rule below whenever the
    // keyboard was open (min-height always wins over a smaller explicit
    // height) — the container never actually shrank, so content stayed
    // exactly as tall as the keyboard covered.
    // `pb-[var(--bottom-nav-height,0px)]` reserves real, measured space
    // (BottomNav.tsx) for the always-`fixed` bottom nav in this layout too —
    // reserving none at all left only a ~5px sliver of the Checkout button
    // tappable above the nav at 1366x768/1024x768.
    // Mobile/PWA viewport hardening: heights use --app-height (100dvh with a
    // 100vh fallback, index.css) -- 100vh is taller than the visible area in
    // a mobile browser, which pushed the side-cart's Checkout under the
    // browser toolbar. The mobile-style layout's bottom padding is derived
    // from the measured nav height plus the floating cart bar (when shown)
    // instead of a fixed pb-28 that was shorter than nav + bar, which hid
    // the last row of tiles behind the bar.
    <div
      className={cn(
        "min-h-app bg-background",
        !isLandscapePOS && (cart.length > 0 ? "pb-[calc(var(--bottom-nav-height)+5.5rem)]" : "pb-nav"),
        isLandscapePOS && "min-h-0 flex h-[calc(var(--app-height)-var(--touch-keyboard-height,0px))] flex-col pb-[var(--bottom-nav-height,0px)]"
      )}
    >
      {/* Not sticky on a short (landscape phone) screen: at ~375px tall this
          header is half the viewport, and pinning it hid the menu tiles
          scrolled up underneath it. It still scrolls normally there. */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top [@media(max-height:500px)]:static">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          {/* The restaurant leads, the screen name follows: a cashier should
              see whose till this is, not which SaaS product it belongs to.
              RestaurantMark degrades logo -> monogram -> neutral, so an
              unbranded tenant still gets a deliberate header. The <h1>"Till"
              is kept as a sibling rather than replaced -- it is the screen's
              accessible name and existing specs locate the page by it. */}
          <div className="flex min-w-0 items-center gap-3">
            <RestaurantMark size="md" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-semibold leading-tight text-foreground">
                  {brandName}
                </span>
                {branchName ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{branchName}</span>
                ) : null}
              </div>
              {/* sr-only, NOT hidden, below sm. `hidden` sets display:none,
                  which removes the screen's accessible name from the
                  accessibility tree entirely -- on exactly the devices most
                  likely to be driven by a screen reader. This keeps the
                  heading announced at every size while giving the phone its
                  vertical space back. */}
              <h1 className="sr-only text-lg font-semibold leading-tight tracking-tight text-foreground sm:not-sr-only sm:block">
                Till
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {tillOpen ? "Tap an item to add it to the order" : "Open the till to start selling"}
              </p>
              {/* Phone: the till state still has to be visible, but as one
                  short line rather than a heading plus a hint. */}
              {!tillOpen && (
                <p className="text-xs font-medium text-warning sm:hidden">Till closed</p>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
          <ConnectivityBadge />
          <button
            onClick={() => setCashupOpen(true)}
            disabled={!online || training.active || (syncOnlyMode && !tillOpen)}
            title={!online ? "Needs internet" : training.active ? "Not available in training" : syncOnlyMode && !tillOpen ? "The event has ended" : undefined}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold disabled:opacity-50",
              tillOpen
                ? "bg-secondary text-foreground active:bg-muted"
                : "bg-primary text-primary-foreground shadow-sm active:opacity-90"
            )}
            aria-label={tillOpen ? "Cash-up" : "Open the till"}
          >
            <Wallet className="h-5 w-5" />
            {/* Previously this read "Till closed" — a status, styled like a
                badge, which told staff what was wrong but not that tapping it
                was the fix. It now names the action it performs. */}
            {/* Phone: the icon plus the aria-label carry the meaning, and the
                label would otherwise wrap to two lines and push the menu grid
                down. The accessible name is unchanged at every size. */}
            <span className="hidden sm:inline">{tillOpen ? "Cash-up" : "Open till"}</span>
          </button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu…"
            className="h-11 w-full rounded-full border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            {...searchTouch.fieldProps}
          />
        </div>

        <ScanField onScan={(c) => void handleScan(c)} busy={scanBusy} message={scanMessage} disabled={!tillOpen} />

        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            <button
              onClick={() => setActiveCategory("ALL")}
              className={cn(
                "flex-shrink-0 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors",
                activeCategory === "ALL" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
              )}
            >
              All
            </button>
            {categories.filter((c) => c.is_active).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "flex-shrink-0 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors",
                  activeCategory === cat.id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {training.active && <TrainingBanner sales={training.sales.length} onExit={() => training.setActive(false)} />}
      <EventAccessBanner access={eventAccess} />
      <OfflineWarnings />
      {exchange && (
        <div
          role="status"
          data-testid="exchange-banner"
          className="flex items-center justify-between gap-3 border-b border-border bg-primary/10 px-4 py-2 text-sm text-foreground"
        >
          <span className="font-semibold">
            Exchange for order {exchange.number ? `#${exchange.number}` : "(refunded)"}
          </span>
          <button type="button" onClick={clearExchange} className="text-xs font-medium underline-offset-2 hover:underline">
            Not an exchange
          </button>
        </div>
      )}
      {!online && !training.active && (
        <div role="status" data-testid="offline-banner" className="border-b border-warning/40 bg-warning/15 px-4 py-2">
          <p className="text-sm font-semibold text-foreground">Offline - cash sales are saved on this device</p>
          <p className="text-xs text-muted-foreground">
            They upload automatically when you are back online. Card, payment links, WhatsApp receipts, delivery
            and loyalty need internet.
          </p>
        </div>
      )}

      {/* Told inline, not silently — a cashier who reopens the till after a
          reload/relogin needs to know this cart isn't the one they left with
          moments ago, since it was restored from local storage rather than
          freshly built. Dismissable: it's informational, not a blocker. */}
      {draftNotice && submissionState.status !== "in_flight" && (
        <div className="px-4 pt-4">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm text-foreground">{draftNotice}</p>
            <button
              onClick={() => setDraftNotice(null)}
              className="flex-shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Paid-but-unconsumed Pay-by-Link money. Persistent (no dismiss) for
          as long as the backend still lists anything -- the only way to
          clear it is to actually complete a sale with that payment. Never
          shows the payment link itself, only amount/masked phone/time. */}
      {unconsumedPaidIntents.length > 0 && (
        <div className="px-4 pt-4">
          <div role="alert" className="rounded-xl border-2 border-destructive bg-destructive/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-destructive">Payment received but sale not completed</p>
                <p className="mt-0.5 text-sm text-foreground">
                  The customer has paid, but no sale was recorded. Resume the sale to attach this payment to an order.
                </p>
                <ul className="mt-3 space-y-2">
                  {unconsumedPaidIntents.map((intent) => {
                    const receivedAt = formatIntentReceivedAt(intent.paid_at);
                    const selected = resumeIntent?.id === intent.id;
                    return (
                      <li
                        key={intent.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(intent.amount_cents)}</p>
                          <p className="text-xs text-muted-foreground">
                            {[intent.customer_phone_masked, receivedAt ? `received ${receivedAt}` : null].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setResumeIntent(intent)}
                          disabled={selected}
                          aria-label={`Resume Sale for ${formatCurrency(intent.amount_cents)}`}
                          className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
                        >
                          {selected ? "Resuming" : "Resume Sale"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {resumeIntent && (
                  <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <p className="text-sm text-foreground">
                      Ring up items totalling {formatCurrency(resumeIntent.amount_cents)}, then choose Split payment, then Pay by
                      Link in the payment screen and select this pending payment (&ldquo;Use existing payment&rdquo;) instead
                      of sending a new link.
                    </p>
                    <button
                      type="button"
                      onClick={() => setResumeIntent(null)}
                      className="mt-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Stop resuming
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* A failed check is surfaced, not swallowed: silence here would read
          as "nothing outstanding" when we simply don't know. */}
      {unconsumedPaidError && unconsumedPaidIntents.length === 0 && (
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm text-foreground">Couldn&apos;t check for payments received without a completed sale.</p>
            <button
              type="button"
              onClick={() => void refetchUnconsumedPaid()}
              disabled={unconsumedPaidFetching}
              className="flex-shrink-0 text-xs font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              Check again
            </button>
          </div>
        </div>
      )}

      {/* The till being closed is the single most common reason a sale cannot
          be rung up, and the header button alone was too easy to miss on a
          busy screen. This states the blocker in plain words and carries the
          action that clears it, in the place staff are already looking. */}
      {!tillOpen && !syncOnlyMode && (
        <div className="px-4 pt-4">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <Wallet className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">The till is closed</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Open it with the cash already in the drawer to start selling. Until
                  then, menu items and checkout stay locked.
                </p>
                <button
                  onClick={() => setCashupOpen(true)}
                  disabled={!online}
                  className="mt-3 h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50 sm:w-auto"
                >
                  Open till
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={cn(isLandscapePOS && "flex flex-1 overflow-hidden")}>
        {/* Left: product grid */}
        <div className={cn("px-4 py-4", isLandscapePOS && "flex-1 overflow-y-auto")}>
          {syncOnlyMode ? (
            <div data-testid="sync-only-panel" className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-3 text-center">
              <p className="text-base font-semibold text-foreground">Event ended — upload your offline sales only</p>
              <p className="text-sm text-muted-foreground">
                {offline.counts.pending + offline.counts.syncing > 0
                  ? `${offline.counts.pending + offline.counts.syncing} offline sale${offline.counts.pending + offline.counts.syncing === 1 ? " is" : "s are"} waiting to upload.`
                  : "Nothing is waiting to upload on this device."}
                {offline.counts.attention > 0 ? ` ${offline.counts.attention} need${offline.counts.attention === 1 ? "s" : ""} a manager.` : ""}
                {offline.counts.review > 0 ? ` ${offline.counts.review} sent to a manager for review.` : ""}
              </p>
              <button
                type="button"
                onClick={() => void offline.syncNow().catch(() => undefined)}
                className="h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Sync now
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : itemsError ? (
            <p className="py-8 text-center text-sm text-destructive">Failed to load the menu</p>
          ) : visibleItems.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No menu items found"
              description={search.trim() ? "Try a different search" : "Add items to the menu from the Manager Dashboard"}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleTileTap(item)}
                  disabled={!tillOpen}
                  className="flex min-h-[84px] flex-col justify-between gap-1 overflow-hidden rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-all duration-fast hover:border-brand-border hover:shadow-md active:scale-[0.97] disabled:opacity-50 sm:min-h-[104px]"
                >
                  {item.image_url && (
                    // Fixed 4:3 frame + object-contain: the whole dish is
                    // always visible and never stretched; a photo of a
                    // different shape is letterboxed on the muted backdrop
                    // instead of being cropped (was h-16 object-cover). The
                    // img is absolutely positioned: as an in-flow child a
                    // square/tall photo's intrinsic height overrode the
                    // aspect ratio and grew the frame (verified in Chromium).
                    <div className="relative -mx-3 -mt-3 mb-2 aspect-[4/3] w-[calc(100%+1.5rem)] shrink-0 overflow-hidden bg-muted">
                      <img src={item.image_url} alt="" className="absolute inset-0 h-full w-full object-contain" />
                    </div>
                  )}
                  <span className="text-sm font-semibold leading-snug text-foreground line-clamp-2">{item.name}</span>
                  <span className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-bold tabular-nums text-brand">{formatCurrency(item.price_cents)}</span>
                    {itemHasChoices(item) && (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Options
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: persistent cart panel — landscape POS layout only (see
            isLandscapePOS above); a portrait viewport of any width gets the
            mobile-style dialog cart below instead. */}
        {isLandscapePOS && (
          <div className="flex w-[380px] flex-shrink-0 flex-col border-l border-border bg-card">
            {cartPanel}
          </div>
        )}
      </div>

      {/* Blocking recovery overlay — shown whenever a checkout request's
          outcome is unknown (timeout, reload/relogin mid-request, tab
          closed). The cart is frozen: the only way out is checking with the
          server, using the exact same order and idempotency key that was
          already sent, never a fresh one. See handleRecoverySubmit(). */}
      {/* Both overlays below: the card is capped to the overlay's padded box
          and scrolls, so on a short/landscape phone "Check now" / "New sale"
          can always be scrolled to instead of being cut off; the padding keeps
          it out of the status-bar/home-indicator insets (and, for the z-50
          success overlay, above the z-50 bottom nav that paints over it). */}
      {submissionState.status === "in_flight" && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          style={{
            paddingTop: "max(1rem, var(--safe-area-top))",
            paddingBottom: "max(1rem, var(--safe-area-bottom))",
          }}
        >
          <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
            <div className="flex flex-col items-center gap-2 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <h2 className="text-lg font-bold text-foreground">Checking your last sale…</h2>
              <p className="text-sm text-muted-foreground">
                The last checkout didn't get a clear response from the server — it may
                have gone through, or it may not have. We'll check using the exact same
                order, so it's safe to press this even if it already succeeded.
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {cartCount} item{cartCount !== 1 ? "s" : ""} · {formatCurrency(estimatedTotalCents)}
              </p>
            </div>
            {recoveryError && (
              <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                {recoveryError}
              </p>
            )}
            <button
              onClick={handleRecoverySubmit}
              disabled={recoverySubmitting}
              className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
            >
              {recoverySubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Check now
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* A sale that is not (yet) on the server: queued offline, or training. */}
      {localSale && (
        <LocalSaleOverlay
          sale={localSale}
          printFailed={printFailed}
          onPrint={handlePrintLocalSlip}
          onNewSale={() => {
            setPrintFailed(false);
            setLocalSale(null);
          }}
        />
      )}
      {showLocalSlip && localSale && (
        <div className="fixed top-0 left-0 z-[9999]">
          <LocalSlip sale={localSale} />
        </div>
      )}

      {/* Success overlay after a completed sale */}
      {lastOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          style={{
            paddingTop: "max(1rem, var(--safe-area-top))",
            paddingBottom: "calc(max(var(--bottom-nav-height), var(--safe-area-bottom)) + 1rem)",
          }}
        >
          <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
            <div className="flex flex-col items-center gap-2 text-center">
              <PartyPopper className="h-10 w-10 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Sale complete</h2>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Order number</p>
              <p data-testid="sale-order-number" className="text-5xl font-black leading-none text-foreground">
                {lastOrder.order_number}
              </p>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(lastOrder.total_cents)}</p>
              {lastOrder.payment_method === "CASH" && lastOrder.change_due_cents != null && (
                <p className="text-sm text-muted-foreground">
                  Cash received {formatCurrency(lastOrder.cash_tendered_cents)} · Change {formatCurrency(lastOrder.change_due_cents)}
                </p>
              )}
              {/* Sourced ONLY from the backend's own committed order — never
                  recomputed locally. This is the real, applied redemption,
                  not the pre-checkout preview shown earlier in CartPanel/
                  PaymentDialog. */}
              {lastOrder.loyalty_reward_id && (
                <p className="text-sm text-muted-foreground">
                  {lastOrder.loyalty_reward_name ?? "Reward"} redeemed · -{formatCurrency(lastOrder.loyalty_discount_cents ?? 0)}
                  {lastOrder.loyalty_points_redeemed ? ` · ${lastOrder.loyalty_points_redeemed} pts` : ""}
                </p>
              )}
            </div>
            {printFailed && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center">
                <p className="text-sm font-semibold text-destructive">Receipt did not print</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The sale is saved and paid. Check the printer, then print again.
                </p>
              </div>
            )}
            {/* Receipt step: an explicit choice rather than a silent print —
                Print/Both reuse the exact same print flow as the old
                single "Print receipt" button above (still the only thing
                that ever touches the printer); WhatsApp/Both open
                ReceiptSendDialog. Auto-print (posSettings.receipt_auto_print,
                unchanged, above in finishSuccessfulSale) already ran before
                this renders — tapping Print/Both again here is a deliberate
                reprint/retry, same as before. */}
            <div className="mt-5 space-y-2">
              <p className="text-center text-xs font-medium text-muted-foreground">Receipt</p>
              {/* Truthful availability, surfaced BEFORE the cashier taps --
                  but the choice is LABELLED, never removed.
                  
                  An earlier version of this disabled WhatsApp/Both when the
                  tenant lacked the entitlement. That broke a deliberate
                  Commercial V1 contract: all four choices are offered, and an
                  unentitled send is reported honestly as NOT_REQUESTED rather
                  than refused (spec 14-D4b exists precisely to test that, and
                  spec 13-D1b asserts all four are present). Disabling the
                  option removed a path the product had deliberately kept open.
                  
                  So the annotation stays and the disabling goes: the cashier
                  learns the module is off before tapping, and the existing,
                  already-honest NOT_REQUESTED path remains available. This
                  reflects the tenant's ENTITLEMENT only -- it is not a claim
                  about Meta template approval, which only the send can
                  establish. */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("PRINT")}
                  className="flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
                >
                  <Printer className="h-5 w-5" /> Print
                </button>
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("WHATSAPP")}
                  title={whatsappReceiptsAvailable ? undefined : "WhatsApp receipts are not enabled for this restaurant"}
                  className="flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
                >
                  {/* Nothing but the icon and the word may live inside this
                      button. An earlier version nested a "Not enabled" caption
                      here, which made the button's text content
                      "WhatsAppNot enabled" -- changing its ACCESSIBLE NAME and
                      breaking spec 13-D1b, which enumerates the four receipt
                      choices by name. The unavailability message belongs to
                      the explanatory line below the grid, where it already is. */}
                  <MessageCircle className="h-5 w-5" /> WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("BOTH")}
                  title={whatsappReceiptsAvailable ? undefined : "WhatsApp receipts are not enabled for this restaurant"}
                  className="flex h-12 items-center justify-center rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors duration-fast hover:bg-muted active:bg-muted"
                >
                  Both
                </button>
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("NONE")}
                  className="flex h-12 items-center justify-center rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground transition-colors duration-fast hover:bg-muted active:bg-muted"
                >
                  No receipt
                </button>
              </div>
              {!whatsappReceiptsAvailable && (
                <p className="text-center text-xs text-muted-foreground">
                  WhatsApp receipts aren&apos;t enabled for this restaurant. Printing still works.
                </p>
              )}
              {receiptChoice === "NONE" && (
                <p className="text-center text-xs text-muted-foreground">No receipt will be sent.</p>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={() => {
                  setPrintFailed(false);
                  setLastOrder(null);
                  setReceiptChoice(null);
                  setWhatsappDialogOpen(false);
                }}
                className="flex h-12 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:bg-primary/90"
              >
                New sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer receipt (hidden, only rendered for printing) — built from
          the backend's own receipt document, never from local order state. */}
      {showReceipt && receiptDocument && (
        <div className="fixed top-0 left-0 z-[9999]">
          <CustomerReceipt document={receiptDocument} />
        </div>
      )}

      {/* Mobile-style layout (any portrait viewport — see isLandscapePOS
          above): floating cart bar opens a dialog with the same CartPanel */}
      {!isLandscapePOS && cart.length > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          // Positioned from the nav's MEASURED height (BottomNav.tsx), not a
          // fixed bottom-20 (80px): the nav is ~67px plus the home-indicator
          // inset, ~101px on a notched iPhone, which covered the lower part
          // of this bar. Falls back to the safe-area inset when the nav is
          // hidden.
          style={{
            bottom: "calc(max(var(--bottom-nav-height), var(--safe-area-bottom)) + 0.75rem)",
            left: "calc(1rem + var(--safe-area-left))",
            right: "calc(1rem + var(--safe-area-right))",
          }}
          className="fixed z-40 flex min-w-0 items-center justify-between gap-3 rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingBag className="h-5 w-5" />
            {cartCount} item{cartCount !== 1 ? "s" : ""}
          </span>
          <span className="text-base font-bold">{formatCurrency(estimatedTotalCents)}</span>
        </button>
      )}

      {/* Height comes from DialogContent's own viewport-aware cap
          (components/ui/dialog.tsx). Previously `max-h-[90vh]` here was
          silently overridden by that inline cap, while the inner
          `max-h-[85vh]` (100vh-based, taller than the visible area in a
          mobile browser) made two nested scroll regions and left Checkout at
          the very bottom of a long scroll. With the keyboard closed the
          dialog is a flex column, so CartPanel's own layout applies: its
          line items scroll and Total + Checkout stay pinned in view. While
          the on-screen keyboard is open there may be only ~200px of dialog
          left on a short phone, so the whole panel scrolls as one region
          instead (the focused field must win that space, not the totals). */}
      <Dialog open={!isLandscapePOS && mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <DialogContent
          className={cn("p-0", !touchKeyboardActive && "flex flex-col")}
          style={touchKeyboardActive ? undefined : { overflowY: "hidden" }}
        >
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="sr-only">Current order</DialogTitle>
          </DialogHeader>
          <div className={cn(!touchKeyboardActive && "flex min-h-0 flex-1 flex-col")} style={mobileCartKeyboardSpacer}>
            {cartPanel}
          </div>
        </DialogContent>
      </Dialog>

      <CashupDialog open={cashupOpen} onClose={() => setCashupOpen(false)} />

      <ItemOptionsDialog
        item={optionsItem}
        onClose={() => {
          setOptionsItem(null);
          setPendingVariant(null);
        }}
        onAdd={handleAddFromDialog}
      />
      <VariantPicker
        item={variantItem}
        variants={variantList}
        onSelect={handlePickVariant}
        onClose={() => {
          setVariantItem(null);
          setVariantList(null);
        }}
      />

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        totalCents={estimatedTotalCents}
        posSettings={posSettings}
        onConfirm={handleConfirmPayment}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        loyaltyRewardPreview={
          loyaltyReward ? { name: loyaltyReward.name, discountCents: loyaltyDiscountPreviewCents } : null
        }
        customerPhone={customerPhone}
        resumePaymentIntent={resumeIntent}
        restriction={training.active ? "training" : !online ? "offline" : null}
      />

      {lastOrder && (
        <ReceiptSendDialog
          open={whatsappDialogOpen}
          onClose={() => setWhatsappDialogOpen(false)}
          orderId={lastOrder.id}
          prefillPhone={lastOrder.phone_number}
          forceResend={false}
          printAlsoRequested={receiptChoice === "BOTH"}
        />
      )}
    </div>
  );
}
