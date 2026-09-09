import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";

export async function createBrowser() {
  const isProduction = process.env.VERCEL === "1";

  if (isProduction) {
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  return playwrightChromium.launch({
    headless: true,
  });
}