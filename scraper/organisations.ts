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

    await page.waitForLoadState("networkidle").catch(() => {});

    console.log("Page loaded:", await page.title());

    const table = page.locator("#table");

    await table.waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const organisations = await table.locator("tr").evaluateAll((rows) => {
      return rows
        .slice(1)
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td"));

          const name = cells[1]?.textContent?.trim() ?? "";
          const tenderCountText = cells[2]?.textContent?.trim() ?? "0";

          return {
            name,
            tenderCount: Number.parseInt(tenderCountText, 10) || 0,
          };
        })
        .filter((item) => item.name.length > 0);
    });

    console.log(
      `Actual organisations found: ${organisations.length}`
    );

    return organisations;
  } finally {
    await browser.close();
  }
}