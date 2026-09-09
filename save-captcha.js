const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

async function saveCaptchaImage() {
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

    console.log("Organisation pe click kar raha hoon (CE RW I)...");
    await page.click("text=CE RW I");
    await page.waitForTimeout(2000);

    console.log("CAPTCHA image ka base64 data nikaal raha hoon...");

    const base64Data = await page.$eval("#captchaImage", (img) => {
      return img.src.replace(/^data:image\/png;base64,/, "");
    });

    const captchaPath = path.join(__dirname, "captcha.png");
    fs.writeFileSync(captchaPath, base64Data, "base64");

    console.log("✅ CAPTCHA image save ho gayi: " + captchaPath);
    console.log("Ab is file ko khol ke dekho.");

    await page.waitForTimeout(3000);
  } catch (err) {
    console.error("❌ Error aaya:", err.message);
  } finally {
    await browser.close();
    console.log("Browser band ho gaya.");
  }
}

saveCaptchaImage();