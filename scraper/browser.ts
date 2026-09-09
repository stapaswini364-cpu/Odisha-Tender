import { chromium } from "playwright-core";

export async function createBrowser() {
  return chromium.launch({
    headless: true,
  });
}