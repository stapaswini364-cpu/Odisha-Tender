import "dotenv/config";

import { scrapeTendersByOrganisation } from "./scraper/tenders";
import { createBrowser } from "./scraper/browser";

async function main() {
  let browser: Awaited<
    ReturnType<typeof createBrowser>
  > | null = null;

  try {
    const organisationName = "CE RW I";

    console.log("========================================");
    console.log("       ODISHA TENDER SCRAPER TEST");
    console.log("========================================");
    console.log(`Organisation: ${organisationName}\n`);

    console.log("Starting browser...");

    browser = await createBrowser();

    console.log("Browser started.\n");

    const tenders =
      await scrapeTendersByOrganisation(
        organisationName,
        browser
      );

    console.log(
      "\n========== SCRAPED TENDERS ==========\n"
    );

    if (tenders.length === 0) {
      console.log("No tenders found.");
      return;
    }

    tenders.forEach((tender, index) => {
      console.log(`Tender ${index + 1}`);
      console.log("----------------------------------------");

      console.log(
        `Organisation : ${tender.organisationName}`
      );

      console.log(
        `Title        : ${tender.title}`
      );

      console.log(
        `Reference No : ${
          tender.referenceNo || "N/A"
        }`
      );

      console.log(
        `Type         : ${tender.type}`
      );

      console.log(
        `Source URL   : ${tender.sourceUrl}`
      );

      console.log(
        `Published At : ${
          tender.publishedAt
            ? tender.publishedAt.toISOString()
            : "N/A"
        }`
      );

      console.log();
    });

    console.log(
      `Total Tenders Found: ${tenders.length}`
    );
  } catch (error) {
    console.error(
      "\nTender scraper failed:"
    );

    console.error(error);

    process.exit(1);
  } finally {
    if (browser) {
      console.log(
        "\nClosing browser..."
      );

      await browser.close();

      console.log(
        "Browser closed."
      );
    }
  }
}

main();