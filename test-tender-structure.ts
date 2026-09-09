import "dotenv/config";
import { createBrowser } from "./scraper/browser";

const ORGANISATION_URL =
  process.env.PORTAL_TENDERS_BY_ORG_URL ||
  "https://tendersodisha.gov.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page";

async function main() {
  const browser = await createBrowser();

  try {
    const page = await browser.newPage();

    console.log("Opening organisation page...");

    await page.goto(ORGANISATION_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await page.waitForLoadState("networkidle").catch(() => {});

    console.log("Page:", await page.title());

    const organisationTable = page.locator("#table");

    await organisationTable.waitFor({
      state: "visible",
      timeout: 30_000,
    });

    // Find CE RW I
    const organisationRow = organisationTable
      .locator("tr")
      .filter({ hasText: "CE RW I" })
      .first();

    console.log("CE RW I found:", await organisationRow.count());

    const link = organisationRow.locator("a").first();

    console.log("Organisation link:", await link.innerText());
    console.log("Organisation href:", await link.getAttribute("href"));

    await link.click();

    await page.waitForLoadState("networkidle").catch(() => {});

    console.log("\n========================================");
    console.log("TENDER PAGE");
    console.log("========================================");

    console.log("URL:", page.url());
    console.log("Title:", await page.title());

    const tables = page.locator("table");
    const tableCount = await tables.count();

    console.log("\nTotal tables:", tableCount);

    for (let i = 0; i < tableCount; i++) {
      const table = tables.nth(i);

      const visible = await table.isVisible().catch(() => false);

      if (!visible) continue;

      const id = await table.getAttribute("id");
      const className = await table.getAttribute("class");

      const rows = table.locator("tr");
      const rowCount = await rows.count();

      const headers = await table
        .locator("tr")
        .first()
        .locator("th, td")
        .allInnerTexts()
        .catch(() => []);

      const tenderLinks = await table
        .locator('a[href*="FrontEndViewTender"]')
        .count()
        .catch(() => 0);

      console.log("\n----------------------------------------");
      console.log(`TABLE ${i}`);
      console.log("----------------------------------------");
      console.log("ID:", id);
      console.log("Class:", className);
      console.log("Rows:", rowCount);
      console.log("Headers:", headers);
      console.log("Tender links:", tenderLinks);

      // Print first 5 rows
      const limit = Math.min(rowCount, 6);

      for (let r = 0; r < limit; r++) {
        const row = rows.nth(r);

        const cells = await row
          .locator("th, td")
          .allInnerTexts()
          .catch(() => []);

        const links = await row
          .locator("a")
          .evaluateAll((anchors) =>
            anchors.map((a) => ({
              text: (a.textContent || "").trim(),
              href: (a as HTMLAnchorElement).href,
            }))
          )
          .catch(() => []);

        console.log(`\nRow ${r}:`);
        console.log("Cells:");

        cells.forEach((cell, index) => {
          console.log(`  [${index}] ${cell.trim()}`);
        });

        if (links.length > 0) {
          console.log("Links:");
          console.log(JSON.stringify(links, null, 2));
        }
      }
    }

    // Specifically inspect rows containing actual tender links
    console.log("\n\n========================================");
    console.log("ROWS WITH ACTUAL TENDER LINKS");
    console.log("========================================");

    const tenderLinks = page.locator(
      'a[href*="FrontEndViewTender"]'
    );

    const tenderLinkCount = await tenderLinks.count();

    console.log("Tender links found:", tenderLinkCount);

    for (let i = 0; i < Math.min(tenderLinkCount, 10); i++) {
      const currentLink = tenderLinks.nth(i);

      console.log(`\nTender Link ${i + 1}`);

      console.log(
        "Text:",
        (await currentLink.innerText()).trim()
      );

      console.log(
        "Href:",
        await currentLink.getAttribute("href")
      );

      const row = currentLink.locator("xpath=ancestor::tr[1]");

      const cells = await row
        .locator("td, th")
        .allInnerTexts()
        .catch(() => []);

      console.log("Row cells:");

      cells.forEach((cell, index) => {
        console.log(`  [${index}] ${cell.trim()}`);
      });
    }

    console.log("\n========================================");
    console.log("DIAGNOSTIC COMPLETE");
    console.log("========================================");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Diagnostic failed:");
  console.error(error);
  process.exit(1);
});