import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e tests build into their own folder, so they can run beside `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cache Components is off: every page is per-browser (a workspace cookie)
  // or live extraction status, so there is little static shell to win.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
