import "dotenv/config";
import { createBrowser } from "./browser";

const ORGANISATION_URL =
  process.env.PORTAL_TENDERS_BY_ORG_URL ||
  "https://tendersodisha.gov.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page";

export type ScrapedOrganisation = {
  name: string;
  tenderCount: number;
};

export async function scrapeOrganisations(): Promise<
  ScrapedOrganisation[]
> {
  const browser = await createBrowser();

  try {
    const page = await browser.newPage();

    console.log("Opening Odisha Tender portal...");

    await page.goto(ORGANISATION_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    console.log("Page loaded:", await page.title());

    // Give the portal a little time to render dynamic content.
    await page.waitForTimeout(3_000);

    const table = page.locator("#table");

    try {
      await table.waitFor({
        state: "visible",
        timeout: 30_000,
      });
    } catch (error) {
      console.error(
        "Organisation table (#table) was not visible."
      );

      console.error(
        "Current URL:",
        page.url()
      );

      console.error(
        "Page title:",
        await page.title()
      );

      // Save diagnostics so we can inspect portal changes.
      await page.screenshot({
        path: "organisation-page-failure.png",
        fullPage: true,
      }).catch(() => {});

      throw error;
    }

    const organisations = await table.locator("tr").evaluateAll((rows) => {
      return rows
        .slice(1)
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td"));

          const name = cells[1]?.textContent?.trim() ?? "";
          const tenderCountText =
            cells[2]?.textContent?.trim() ?? "0";

          return {
            name,
            tenderCount:
              Number.parseInt(tenderCountText, 10) || 0,
          };
        })
        .filter((item) => item.name.length > 0);
    });

    console.log(
      `Actual organisations found: ${organisations.length}`
    );

    if (organisations.length === 0) {
      throw new Error(
        "Organisation table loaded but no organisations were found."
      );
    }

    return organisations;
  } finally {
    await browser.close();
  }
}