import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
