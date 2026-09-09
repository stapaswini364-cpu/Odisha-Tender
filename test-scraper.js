const { chromium } = require("playwright-core");
const path = require("path");

async function testScraper() {
  console.log("Browser khol raha hoon...");

  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  try {
    console.log("Portal khol raha hoon...");
    await page.goto("https://tendersodisha.gov.in", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    console.log("Homepage load ho gaya. 'Tenders by Organisation' dhundh raha hoon...");

    await page.click("text=Tenders by Organisation");

    console.log("Click ho gaya. Naya page load hone ka wait kar raha hoon...");
    await page.waitForLoadState("networkidle", { timeout: 30000 });

    await page.waitForTimeout(2000);

    const screenshotPath = path.join(__dirname, "org-page-screenshot.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log("✅ Success! Naya screenshot save ho gaya: " + screenshotPath);
    console.log("Page title:", await page.title());
    console.log("Current URL:", page.url());

    await page.waitForTimeout(5000);
  } catch (err) {
    console.error("❌ Error aaya:", err.message);
  } finally {
    await browser.close();
    console.log("Browser band ho gaya.");
  }
}

testScraper();