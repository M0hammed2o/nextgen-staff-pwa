// ═══════════════════════════════════════════════════════════════
// Staff types — aligned to REAL backend schemas
// ═══════════════════════════════════════════════════════════════

export interface SavedBusiness {
  business_id: string;
  business_code: string;
  business_name: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface StaffUser {
  id: string;
  email: string | null;
  staff_name: string | null;
  role: string;
  business_id: string | null;
  business_name: string | null;
}

export interface LoginResponse {
  tokens: AuthTokens;
  user: StaffUser;
}

export interface LoginRequest {
  business_code: string;
  staff_id: string;
  pin: string;
}

// One selectable staff member on the pick-your-name login step
export interface StaffDirectoryEntry {
  id: string;
  staff_name: string;
}

export interface StaffDirectoryResponse {
  business_name: string;
  staff: StaffDirectoryEntry[];
}

export interface WhatsAppStatus {
  paused: boolean;
  paused_at: string | null;
  paused_by_name: string | null;
  busy_text: string | null;
}

// Backend OrderItemResponse
export interface OrderItemAddOn {
  name: string;
  price_cents: number;
  quantity: number;
}

export interface OrderItem {
  id: string;
  name_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  options_snapshot: Record<string, unknown> | null;
  add_ons_snapshot: OrderItemAddOn[] | null;
  // Matches what the backend actually ever writes here (both
  // backend/app/bot/pipeline.py::_resolve_option_prices and
  // backend/app/pos/pricing.py) -- group_id/option_id are also present but
  // unused by this app today.
  selected_options_snapshot: Array<{ group_name: string; option_name: string; price_delta_cents: number }> | null;
  removed_ingredients_snapshot: Array<{ id: string; name: string }> | null;
  special_instructions: string | null;
}

export type PaymentStatus =
  | 'UNPAID'
  | 'PENDING'
  | 'PAID'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'FAILED'
  | 'VOIDED'
  | 'CASH_ON_COLLECTION';

export type POSPaymentMethod = 'CASH' | 'CARD' | 'OTHER';

// Backend OrderResponse
export interface Order {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_required: boolean;
  payment_method: string | null;
  payment_reference: string | null;
  payment_link_url: string | null;
  paid_at: string | null;
  order_mode: string;
  table_number: string | null;
  source: string;
  cash_tendered_cents: number | null;
  change_due_cents: number | null;
  till_session_id: string | null;
  created_by_user_id: string | null;
  refund_reference: string | null;
  refund_amount_cents: number | null;
  refunded_at: string | null;
  customer_name: string | null;
  phone_number: string | null;
  delivery_address: string | null;
  items: OrderItem[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  tax_cents: number;
  discount_reason: string | null;
  total_cents: number;
  currency: string;
  estimated_ready_at: string | null;
  confirmed_at: string | null;
  accepted_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  special_instructions: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
  // Loyalty redemption snapshot (migration 0050) — mirrors
  // backend/app/api/v1/routes_orders.py::OrderResponse exactly. Always
  // present on a response from a backend that has run this migration;
  // typed nullable/optional here because a pre-migration cached response
  // shape is not something this frontend should assume away. Never
  // rewritten by refund/void (DECISION-0034) — these are the immutable
  // financial snapshot of what was actually redeemed at checkout, the only
  // honest source for a receipt or a "Sale complete" summary.
  loyalty_discount_cents?: number | null;
  loyalty_reward_id?: string | null;
  loyalty_points_redeemed?: number | null;
  loyalty_reward_name?: string | null;
}

// Backend valid statuses
export type OrderStatus =
  | "PENDING_DELIVERY_FEE"
  | "FEE_SENT"
  | "NEW"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "READY"
  | "COLLECTED"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

export interface StatusUpdateRequest {
  status: string;
  reason?: string;
  estimated_ready_minutes?: number;
}

export interface DeliveryFeeRequest {
  delivery_fee_cents: number;
}

// Paginated response wrapper
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    per_page: number;
    next_cursor: string | null;
    has_more: boolean;
  };
}

export interface ApiError {
  message: string;
  status: number;
}

// ═══════════════════════════════════════════════════════════════
// Menu (read-only here — staff can view the catalog to build a POS
// cart, but menu management itself remains owner/manager-only).
// Mirrors backend/app/api/v1/routes_menu.py's response schemas exactly.
// ═══════════════════════════════════════════════════════════════

export interface MenuCategoryEntry {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface MenuOptionChoice {
  id: string;
  name: string;
  price_delta_cents: number;
  sort_order: number;
  is_enabled: boolean;
}

export interface MenuOptionGroup {
  id: string;
  name: string;
  required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  is_enabled: boolean;
  default_option_id: string | null;
  options: MenuOptionChoice[];
}

export interface RemovableIngredient {
  id: string;
  name: string;
}

export interface MenuItemOptions {
  option_groups: MenuOptionGroup[];
  removable_ingredients?: RemovableIngredient[];
}

export interface MenuAddOn {
  id: string;
  name: string;
  price_cents: number;
  min_qty: number;
  max_qty: number;
  default_qty: number;
  is_active: boolean;
  sort_order: number;
}

export interface MenuItemEntry {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  options_json: MenuItemOptions | null;
  add_ons: MenuAddOn[];
  is_active: boolean;
  sort_order: number;
  image_url: string | null;
  requires_preparation: boolean;
}

// ═══════════════════════════════════════════════════════════════
// POS order creation — backend/app/api/v1/routes_pos.py
// ═══════════════════════════════════════════════════════════════

export interface POSAddOnSelectionRequest {
  add_on_id: string;
  quantity: number;
}

export interface POSOrderItemRequest {
  menu_item_id: string;
  quantity: number;
  selected_option_ids: Record<string, string>;
  add_on_selections: POSAddOnSelectionRequest[];
  removed_ingredient_ids: string[];
  special_instructions?: string | null;
}

export interface POSOrderCreateRequest {
  items: POSOrderItemRequest[];
  order_mode: "PICKUP" | "DELIVERY" | "DINE_IN";
  table_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  discount_cents?: number;
  discount_reason?: string | null;
  // A LoyaltyReward to redeem against this sale (backend/app/api/v1/routes_pos.py
  // ::POSOrderCreateRequest.loyalty_reward_id). The backend requires
  // customer_phone AND idempotency_key to both be set whenever this is —
  // see Pos.tsx::handleConfirmPayment, which only ever sets this alongside
  // both. The backend is the only thing that ever validates/applies it;
  // this frontend never computes the resulting discount independently.
  loyalty_reward_id?: string | null;
  // ── Payment: EXACTLY ONE of the two shapes below, never both ──────────
  // Legacy single-method checkout (unchanged) — `payment_method` stays
  // required in practice for a normal sale; it is typed optional here only
  // because a split-payment checkout (see `payments` below) omits it
  // entirely. Pos.tsx::handleConfirmPayment is the single place that
  // decides which shape to send, driven by whether the cashier used
  // PaymentDialog's "Split payment" entry point.
  payment_method?: POSPaymentMethod;
  cash_tendered_cents?: number | null;
  payment_reference?: string | null;
  // Split-payment checkout (POS split-payment / Pay-by-Link feature). >= 2
  // entries; the backend validates SUM(payments[].amount_cents) ==
  // server-computed total_cents exactly and rejects any PAY_BY_LINK entry
  // whose payment_intent_id isn't already confirmed PAID. Mutually
  // exclusive with `payment_method`/`cash_tendered_cents`/`payment_reference`
  // above.
  payments?: POSPaymentAllocationRequest[];
  idempotency_key?: string | null;
}

// A single tender line within a split-payment checkout. `PAY_BY_LINK` is
// only ever valid here (never as the legacy top-level `payment_method`,
// which predates Pay-by-Link entirely).
export type POSSplitPaymentMethod = POSPaymentMethod | "PAY_BY_LINK";

export interface POSPaymentAllocationRequest {
  payment_method: POSSplitPaymentMethod;
  amount_cents: number;
  cash_tendered_cents?: number;
  payment_reference?: string;
  payment_intent_id?: string;
}

// The two payloads PaymentDialog can hand back to Pos.tsx::handleConfirmPayment
// — either a normal single-method confirmation (unchanged shape) or the new
// split-payment array. Pos.tsx is the only place that maps this onto
// POSOrderCreateRequest.
export type POSCheckoutPaymentPayload =
  | { payment_method: POSPaymentMethod; cash_tendered_cents?: number; payment_reference?: string }
  | { payments: POSPaymentAllocationRequest[] };

// ── Pay by Link (WhatsApp payment-link) payment intents ────────────────────
// POST/GET /v1/business/pos/payment-intents[...]. This is the ONLY safe,
// client-facing shape — it never includes the raw payment link URL. The
// Staff UI must never display, copy, or open that link anywhere (hard
// product constraint); the cashier only ever sees status.
export type PaymentIntentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "CONSUMED";
export type PaymentIntentWhatsAppStatus = "NOT_SENT" | "SENT" | "FAILED" | "TEMPLATE_REQUIRED";

export interface PaymentIntent {
  id: string;
  status: PaymentIntentStatus;
  whatsapp_status: PaymentIntentWhatsAppStatus;
  amount_cents: number;
  expires_at: string;
  // The fields below mirror routes_pos.py::POSPaymentIntentResponse. All
  // optional here so older fixtures/mocks stay valid; the backend always
  // sends them (nullable). None of them is the raw payment link URL, which
  // this type must never carry.
  currency?: string;
  provider?: string;
  whatsapp_failure_reason?: string | null;
  /** Already masked server-side, e.g. "+27 •• ••• 1234". */
  customer_phone_masked?: string | null;
  created_at?: string;
  paid_at?: string | null;
  provider_reference?: string | null;
  till_session_id?: string | null;
  created_by_user_id?: string | null;
  /** Null until the intent is consumed into an order at checkout. */
  order_id?: string | null;
}

export interface PaymentIntentCreateRequest {
  amount_cents: number;
  customer_phone: string;
}

export interface POSRefundRequest {
  amount_cents?: number | null;
  reason?: string | null;
}

export interface POSVoidRequest {
  reason: string;
}

// POST /v1/business/pos/orders/{order_id}/receipt — mirrors
// backend/app/api/v1/routes_pos.py::POSReceiptRequest/POSReceiptResponse
// exactly. `force_resend` is checked at the route layer (OWNER/MANAGER
// only) — a STAFF caller must never set it to true.
export type POSReceiptChannel = "PRINT" | "WHATSAPP";

export interface POSReceiptRequest {
  channels: POSReceiptChannel[];
  phone_number?: string | null;
  force_resend?: boolean;
}

export type WhatsAppReceiptStatus = "NOT_REQUESTED" | "QUEUED" | "SENT" | "DELIVERED" | "FAILED";

export interface POSReceiptResponse {
  id: string;
  order_id: string;
  receipt_url: string;
  print_requested: boolean;
  whatsapp_requested: boolean;
  whatsapp_status: WhatsAppReceiptStatus;
  whatsapp_failure_reason?: string | null;
}

// GET /v1/business/pos/settings — staff-readable subset of business settings
export interface POSSettings {
  cash_enabled: boolean;
  card_enabled: boolean;
  other_payment_enabled: boolean;
  table_number_required: boolean;
  delivery_fee_cents: number;
  max_staff_discount_cents: number;

  // VAT — the till shows a tax line before checkout
  vat_registered: boolean;
  vat_rate_basis_points: number;
  vat_inclusive_pricing: boolean;

  // Receipt / thermal printing
  receipt_paper_width_mm: number;
  receipt_auto_print: boolean;
  receipt_copies: number;
  print_kitchen_receipt: boolean;

  // Inventory — gates the quick-wastage action on the till
  inventory_enabled: boolean;

  // Digital receipts — whether this business is entitled to the WhatsApp
  // receipt module. Read-only: a platform-admin entitlement, never set here.
  digital_receipts_enabled: boolean;

  // Loyalty — gates the staff Loyalty nav entry/page (UI V2.1 follow-up
  // Part B). Read-only: a platform-admin entitlement
  // (Business.loyalty_enabled), mirrored directly here rather than inferred
  // by probing the Loyalty API — see lib/loyalty.ts.
  loyalty_enabled: boolean;

  // Which tabs this tenant's bottom navigation should show. Display
  // configuration only — a hidden tab never disables the feature, and
  // every route behind one still enforces its own permissions.
  staff_live_orders_tab_enabled: boolean;
  staff_wastage_tab_enabled: boolean;
  staff_stocktake_tab_enabled: boolean;

  // Pay by Link (WhatsApp payment-link) entitlement. Optional/possibly
  // absent on older backend responses during rollout — treat `undefined`
  // the same as `false` (hide the option), never crash on it. See
  // PaymentDialog.tsx's split-payment "+ Add payment" method list.
  pay_by_link_enabled?: boolean;

  // Whether this tenant's subscription includes POS at all ("WhatsApp-only"
  // plans do not). Optional/possibly absent on older backend responses
  // during rollout — treat `undefined` the same as `true` (POS enabled),
  // never hide Till or break the landing redirect for every existing
  // tenant just because a cached/older response doesn't carry this field
  // yet. When `false`, every POS-write route (till open/close, order
  // creation, payment intents, refund/void) 409s with `POS_NOT_ENABLED` —
  // see BottomNav.tsx's Till gate, lib/pos-settings.ts::landingPath, and
  // Pos.tsx::isPosNotEnabledError.
  pos_enabled?: boolean;
}

// ── Inventory (staff-facing subset) ────────────────────────────────────────
// Matches shared/enums.py::CanonicalUnit and mirrors the equivalent type in
// nextgen-insights-main/src/types/inventory.ts — kept as its own small type
// here since the two frontend repos have no shared package (see WORKLOG.md
// for the acknowledged duplication).
export type CanonicalUnit = "GRAM" | "MILLILITRE" | "UNIT";

export interface IngredientSummary {
  id: string;
  name: string;
  canonical_unit: CanonicalUnit;
  count_method: "UNIT_COUNT" | "WEIGHT" | "VOLUME";
  on_hand_milli: number;
  on_hand_display: string;
  below_par: boolean;
}

export interface WastageReasonOption {
  value: string;
  label: string;
  requires_note: boolean;
}

// ── Stocktake (staff-facing) — backend/app/api/v1/routes_stocktake.py ─────
export interface StocktakeLine {
  ingredient_id: string;
  ingredient_name: string;
  canonical_unit: CanonicalUnit;
  count_method: "UNIT_COUNT" | "WEIGHT" | "VOLUME";
  unit_label: string | null;
  counted_quantity_milli: number | null;
  counted_display: string | null;
  /**
   * What staff actually typed and which unit token they typed it in (e.g.
   * "2" / "KG") — as opposed to `counted_quantity_milli`, which is always in
   * the ingredient's CANONICAL unit (e.g. milligrams). Only present once the
   * backend has a value to return for this line (see
   * StocktakeLineResponse in routes_stocktake.py); null for a line with no
   * count yet, or one saved before this field existed. Seeding the editable
   * field from these (see stocktake-units.ts::seedCountEntries) — instead of
   * re-deriving a value from the canonical quantity in a different unit —
   * is what keeps a reload showing "2 kg" as "2 kg", not "2000 g".
   */
  entered_quantity: string | null;
  entered_unit: string | null;
  expected_quantity_milli: number;
  expected_display: string;
  variance_quantity_milli: number;
  variance_display: string;
  variance_value_cents: number;
  variance_percent: string;
  is_flagged: boolean;
  notes: string | null;
}

export interface StocktakeSession {
  id: string;
  reference: string | null;
  status: "DRAFT" | "COMPLETED" | "APPROVED" | "CANCELLED";
  cutoff_at: string;
  period_start_at: string | null;
  opened_at: string;
  completed_at: string | null;
  approved_at: string | null;
  total_variance_value_cents: number;
  total_theoretical_value_cents: number;
  accuracy_percent: string;
  is_locked: boolean;
  lines: StocktakeLine[];
  notes: string | null;
}

/** One row of the history list — GET /v1/business/stocktake */
export interface StocktakeHistoryEntry {
  id: string;
  reference: string | null;
  status: "DRAFT" | "COMPLETED" | "APPROVED" | "CANCELLED";
  opened_at: string | null;
  cutoff_at: string | null;
  completed_at: string | null;
  approved_at: string | null;
  opened_by_name: string | null;
  completed_by_name: string | null;
  approved_by_name: string | null;
  line_count: number;
  counted_line_count: number;
  total_variance_value_cents: number;
  total_theoretical_value_cents: number;
  is_locked: boolean;
  notes: string | null;
}

// ── Till (cash-up) — backend/app/api/v1/routes_pos.py ──────────────────────
export interface TillSession {
  id: string;
  status: "OPEN" | "CLOSED";
  opening_float_cents: number;
  expected_cash_cents: number | null;
  counted_cash_cents: number | null;
  variance_cents: number | null;
  cash_sales_cents?: number | null;
  cash_refunds_cents?: number | null;
  opened_at: string;
  closed_at: string | null;
}

export interface TillOpenRequest {
  opening_float_cents: number;
}

export interface TillCloseRequest {
  counted_cash_cents: number;
}

// GET /v1/business/loyalty/customers/lookup?phone= — mirrors
// backend/app/api/v1/routes_loyalty.py::CustomerLoyaltyResponse exactly.
// See src/lib/loyalty.ts for the two backend quirks callers must handle:
// looking a customer up by phone CREATES them as a side effect, and the
// route 404s (LOYALTYPROGRAM_NOT_FOUND) whenever the business hasn't
// enabled its loyalty programme.
export interface CustomerLoyaltyResponse {
  customer_id: string;
  display_name: string | null;
  phone_number: string | null;
  loyalty_points_balance: number;
  loyalty_tier: string;
}

// GET /v1/business/loyalty/rewards — mirrors
// backend/app/api/v1/routes_loyalty.py::LoyaltyRewardResponse exactly.
// STAFF-or-above (require_staff_or_above) — the route itself already
// filters to `is_active == true` server-side (routes_loyalty.py::list_rewards),
// so `is_active` here is defensive-only from the frontend's point of view,
// never the only thing standing between a cashier and an inactive reward.
// `value_cents` is nullable: NULL means "not redeemable at the till, hand
// it over manually" (DECISIONS.md DECISION-0038) — see
// src/components/pos/LoyaltyRewardPicker.tsx for how this is filtered.
export interface LoyaltyRewardResponse {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  is_active: boolean;
  value_cents: number | null;
}

// One line in the till's in-progress cart, before submission. Prices here
// are computed client-side purely so staff can see a running total while
// building the order — the server always recomputes and is the only
// authoritative total (shared/pricing/engine.py), per this platform's
// server-side-pricing-only principle. Never trust cartLineTotal for a
// receipt; only the Order returned by POST /business/pos/orders is real.
export interface CartLine {
  key: string; // client-only id (menu_item_id + selected options), for React keys / de-dup
  menuItemId: string;
  name: string;
  basePriceCents: number;
  quantity: number;
  requiresPreparation: boolean;
  selectedOptionIds: Record<string, string>;
  selectedOptionsDisplay: { groupName: string; optionName: string; priceDeltaCents: number }[];
  addOnSelections: { addOnId: string; name: string; priceCents: number; quantity: number }[];
  removedIngredientIds: string[];
  removedIngredientsDisplay: { id: string; name: string }[];
  specialInstructions: string | null;
}
