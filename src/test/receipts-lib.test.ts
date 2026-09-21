import { describe, it, expect, vi, afterEach } from "vitest";

const getMock = vi.fn();
const postMock = vi.fn();

afterEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

import { fetchReceiptDocument, reprintReceiptDocument } from "@/lib/receipts";

describe("fetchReceiptDocument", () => {
  it("GETs the order's receipt document (read-only, never audited)", async () => {
    getMock.mockResolvedValueOnce({ document_type: "CUSTOMER_RECEIPT" });
    const doc = await fetchReceiptDocument("order-123");
    expect(getMock).toHaveBeenCalledWith("/v1/business/receipts/orders/order-123");
    expect(postMock).not.toHaveBeenCalled();
    expect(doc).toEqual({ document_type: "CUSTOMER_RECEIPT" });
  });
});

describe("reprintReceiptDocument", () => {
  it("POSTs to the audited reprint endpoint, never the GET", async () => {
    postMock.mockResolvedValueOnce({ document_type: "CUSTOMER_RECEIPT", banner: "REPRINT" });
    const doc = await reprintReceiptDocument("order-123");
    expect(postMock).toHaveBeenCalledWith("/v1/business/receipts/orders/order-123/reprint", {});
    expect(getMock).not.toHaveBeenCalled();
    expect(doc.banner).toBe("REPRINT");
  });
});
