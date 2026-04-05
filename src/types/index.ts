// ═══════════════════════════════════════════════════════════════
// Staff types — aligned to REAL backend schemas
// ═══════════════════════════════════════════════════════════════

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
  pin: string;
}

// Backend OrderItemResponse
export interface OrderItem {
  id: string;
  name_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  options_snapshot: Record<string, unknown> | null;
  special_instructions: string | null;
}

// Backend OrderResponse
export interface Order {
  id: string;
  order_number: string;
  status: OrderStatus;
  order_mode: string;
  source: string;
  customer_name: string | null;
  phone_number: string | null;
  delivery_address: string | null;
  items: OrderItem[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  currency: string;
  estimated_ready_at: string | null;
  confirmed_at: string | null;
  accepted_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
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
