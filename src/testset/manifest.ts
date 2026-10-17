/** One entry in test-set/manifest.json. */
export type ManifestEntry = {
  id: string;
  file: string;
  truth: string;
  split: "tuning" | "held_out";
  slice: "clean" | "hard";
  template: string;
  profile: string;
  currency: string;
  lineItems: number;
  pages: number;
};
