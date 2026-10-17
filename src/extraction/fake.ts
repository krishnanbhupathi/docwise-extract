import type { CallModel } from "./model";

/**
 * A stand-in model for local development and e2e (DOCWISE_FAKE_MODEL=1): no
 * API key, no cost. It always "reads" the same invoice, with one rule failure
 * (the total) so the review path is exercised.
 */
const FAKE_INVOICE = {
  supplier_name: "Brightfield Supply Co.",
  invoice_number: "BF-10442",
  invoice_date: "2026-10-05",
  due_date: "2026-11-04",
  currency: "USD",
  subtotal: "1180.00",
  tax: "94.40",
  total: "1284.40",
  line_items: [
    { description: "A4 copier paper, 80 gsm (box of 5 reams)", quantity: "12", unit_price: "45.00", amount: "540.00" },
    { description: "Toner cartridge, black", quantity: "4", unit_price: "135.00", amount: "540.00" },
    { description: "Delivery", quantity: null, unit_price: null, amount: "100.00" },
  ],
  uncertain: [{ field: "tax", reason: "Fake model: always unsure about tax" }],
};

export const fakeModel: CallModel = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return {
    text: JSON.stringify(FAKE_INVOICE),
    model: "fake",
    stopReason: "end_turn",
    inputTokens: 0,
    outputTokens: 0,
    fallbackUsed: false,
    raw: { fake: true },
  };
};
