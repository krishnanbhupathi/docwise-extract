import type { RuleCode } from "@/lib/rules";
import type { InvoiceKind } from "./spec";

/** One entry in test-set/manifest.json. */
export type ManifestEntry = {
  id: string;
  file: string;
  truth: string;
  split: "tuning" | "held_out";
  slice: "clean" | "hard";
  kind: InvoiceKind;
  mediaType: "application/pdf" | "image/jpeg";
  /** Whether the file has a text layer (scans and photos don't). */
  textLayer: boolean;
  /** Rules the true values fail on purpose; such an invoice must end up in review, never auto-approved. */
  expectedRuleFailures: RuleCode[];
  template: string;
  profile: string;
  currency: string;
  lineItems: number;
  pages: number;
};
