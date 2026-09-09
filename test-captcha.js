const { chromium } = require("playwright-core");
const path = require("path");

async function testCaptchaCapture() {
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

    console.log("'Tenders by Organisation' pe click kar raha hoon...");
    await page.click("text=Tenders by Organisation");
    await page.waitForLoadState("networkidle", { timeout: 30000 });

    console.log("Ek organisation pe click kar raha hoon (CE RW I)...");
    await page.click("text=CE RW I");
    await page.waitForTimeout(2000);

    console.log("CAPTCHA image dhundh raha hoon...");

    const images = await page.$$eval("img", (imgs) =>
      imgs.map((img) => ({ src: img.src, alt: img.alt, id: img.id }))
    );

    console.log("Page pe mili images:");
    console.log(JSON.stringify(images, null, 2));

    const screenshotPath = path.join(__dirname, "captcha-page-screenshot.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log("✅ Screenshot save ho gaya: " + screenshotPath);

    await page.waitForTimeout(5000);
  } catch (err) {
    console.error("❌ Error aaya:", err.message);
  } finally {
    await browser.close();
    console.log("Browser band ho gaya.");
  }
}

testCaptchaCapture();