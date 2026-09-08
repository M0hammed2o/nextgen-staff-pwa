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
  payment_method: POSPaymentMethod;
  cash_tendered_cents?: number | null;
  payment_reference?: string | null;
  idempotency_key?: string | null;
}

export interface POSRefundRequest {
  amount_cents?: number | null;
  reason?: string | null;
}

export interface POSVoidRequest {
  reason: string;
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

  // Which tabs this tenant's bottom navigation should show. Display
  // configuration only — a hidden tab never disables the feature, and
  // every route behind one still enforces its own permissions.
  staff_live_orders_tab_enabled: boolean;
  staff_wastage_tab_enabled: boolean;
  staff_stocktake_tab_enabled: boolean;
}

// ── Inventory (staff-facing subset) ────────────────────────────────────────
export interface IngredientSummary {
  id: string;
  name: string;
  canonical_unit: "GRAM" | "MILLILITRE" | "UNIT";
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
  canonical_unit: "GRAM" | "MILLILITRE" | "UNIT";
  count_method: "UNIT_COUNT" | "WEIGHT" | "VOLUME";
  unit_label: string | null;
  counted_quantity_milli: number | null;
  counted_display: string | null;
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
