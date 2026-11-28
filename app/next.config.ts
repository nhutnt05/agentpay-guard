import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    // Next 16 builds with Turbopack, which ignores the `webpack` fallback below. Without this,
    // `next build` fails: @anchor-lang/core's browser bundle references `fs`.
    resolveAlias: {
      fs: { browser: "./src/lib/empty-module.ts" },
      net: { browser: "./src/lib/empty-module.ts" },
      tls: { browser: "./src/lib/empty-module.ts" },
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Polyfills for Node.js modules in browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
