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
  special_instructions: string | null;
}

export type PaymentStatus = 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CASH_ON_COLLECTION';

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
  source: string;
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

export interface MenuItemOptions {
  option_groups: MenuOptionGroup[];
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
  special_instructions?: string | null;
}

export interface POSOrderCreateRequest {
  items: POSOrderItemRequest[];
  order_mode: "PICKUP" | "DELIVERY" | "DINE_IN";
  customer_name?: string | null;
  customer_phone?: string | null;
  discount_cents?: number;
  discount_reason?: string | null;
}

// ── Till (cash-up) — backend/app/api/v1/routes_pos.py ──────────────────────
export interface TillSession {
  id: string;
  status: "OPEN" | "CLOSED";
  opening_float_cents: number;
  expected_cash_cents: number | null;
  counted_cash_cents: number | null;
  variance_cents: number | null;
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
  selectedOptionIds: Record<string, string>;
  selectedOptionsDisplay: { groupName: string; optionName: string; priceDeltaCents: number }[];
  addOnSelections: { addOnId: string; name: string; priceCents: number; quantity: number }[];
  specialInstructions: string | null;
}
