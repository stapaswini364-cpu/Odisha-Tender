import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "playwright-core",
    "@sparticuz/chromium",
  ],

  outputFileTracingIncludes: {
    "/api/cron/check-tenders": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
};

export default nextConfig;