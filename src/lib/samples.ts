/**
 * The public demo's sample invoices: tuning-split invoices from the test set
 * (never held-out ones), each shown with the model's saved answer from an
 * eval run, so opening a sample costs nothing.
 */

/** The eval run whose saved answers the samples show (prompt v1, the app's model). */
export const SAMPLE_RUN = "eval-02-v1-sonnet-5-5-tuning";

export const SAMPLES = [
  { invoice: "inv-001", label: "Clean PDF", detail: "US layout, 7 lines" },
  { invoice: "inv-002", label: "Clean PDF", detail: "German number format, 12 lines" },
  { invoice: "inv-014", label: "Indian GST", detail: "CGST + SGST, 15 lines" },
  { invoice: "inv-046", label: "Scan", detail: "Tilted, no text layer" },
  { invoice: "inv-049", label: "Phone photo", detail: "Perspective and shadow" },
  { invoice: "inv-052", label: "Two pages", detail: "35 lines" },
  { invoice: "inv-055", label: "Handwritten notes", detail: "Numbers that aren't the invoice's" },
  { invoice: "inv-056", label: "Doesn't add up", detail: "The printed total is wrong" },
  { invoice: "inv-058", label: "Doesn't add up", detail: "A line amount is wrong" },
] as const;

export type Sample = (typeof SAMPLES)[number];

/** Samples have stable ids, so links to them survive a re-seed. */
export const sampleId = (sample: Pick<Sample, "invoice">) => `sample-${sample.invoice.slice(4)}`;

export const sampleFor = (documentId: string): Sample | undefined => SAMPLES.find((s) => sampleId(s) === documentId);
