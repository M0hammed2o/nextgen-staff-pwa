/**
 * Cart helpers for variant lines. Kept out of Pos.tsx so the selection ->
 * cart line -> sale payload chain is unit-testable.
 */
import type { CartLine, MenuItemEntry, POSOrderItemRequest } from "@/types";
import type { ProductVariant } from "@/lib/variants";

/** Cart line for a chosen variant. The price is the variant's effective price (display only; the server re-prices). */
export function buildVariantLine(
  item: Pick<MenuItemEntry, "id" | "name" | "requires_preparation">,
  variant: ProductVariant,
  extras: Partial<Pick<
    CartLine,
    | "selectedOptionIds"
    | "selectedOptionsDisplay"
    | "addOnSelections"
    | "removedIngredientIds"
    | "removedIngredientsDisplay"
    | "specialInstructions"
  >> = {},
): CartLine {
  const plain = Object.keys(extras).length === 0;
  return {
    // A plain variant line is keyed by the variant so scanning the same
    // shirt twice raises the quantity; a line carrying options/notes is its
    // own line (unique key, like the existing options flow).
    key: plain ? `${item.id}::v::${variant.id}` : `${item.id}::v::${variant.id}::${Date.now()}`,
    menuItemId: item.id,
    name: item.name,
    basePriceCents: variant.effective_price_cents,
    quantity: 1,
    requiresPreparation: item.requires_preparation,
    selectedOptionIds: {},
    selectedOptionsDisplay: [],
    addOnSelections: [],
    removedIngredientIds: [],
    removedIngredientsDisplay: [],
    specialInstructions: null,
    ...extras,
    variantId: variant.id,
    variantLabel: variant.label,
    sku: variant.sku,
  };
}

/** Add a line, bumping the quantity of an existing line with the same key. */
export function addLineToCart(cart: CartLine[], line: CartLine): CartLine[] {
  if (cart.some((l) => l.key === line.key)) {
    return cart.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + line.quantity } : l));
  }
  return [...cart, line];
}

/** One cart line as the POS create-order item. variant_id is sent only for variant lines. */
export function cartLineToSaleItem(line: CartLine): POSOrderItemRequest {
  return {
    menu_item_id: line.menuItemId,
    quantity: line.quantity,
    selected_option_ids: line.selectedOptionIds,
    add_on_selections: line.addOnSelections.map((a) => ({ add_on_id: a.addOnId, quantity: a.quantity })),
    removed_ingredient_ids: line.removedIngredientIds,
    special_instructions: line.specialInstructions,
    ...(line.variantId ? { variant_id: line.variantId } : {}),
  };
}
