import "dotenv/config";

import { scrapeOrganisations } from "./scraper/organisations";
import { scrapeTendersByOrganisation } from "./scraper/tenders";
import { createBrowser } from "./scraper/browser";
import { upsertTenders } from "./db/queries/tenders";

async function main() {
  const startedAt = Date.now();

  let browser: Awaited<
    ReturnType<typeof createBrowser>
  > | null = null;

  try {
    console.log("========================================");
    console.log("   ALL ORGANISATIONS TENDER SYNC");
    console.log("========================================\n");

    // Step 1: Get all organisations from portal
    const organisations = await scrapeOrganisations();

    console.log(
      `Total organisations found: ${organisations.length}\n`
    );

    let totalScraped = 0;
    let totalInserted = 0;
    let totalSkipped = 0;

    const failedOrganisations: {
      name: string;
      error: string;
    }[] = [];

    // Step 2: Create ONE browser for all organisations
    console.log("Starting shared browser...");
    browser = await createBrowser();
    console.log("Shared browser started.\n");

    // Step 3: Process each organisation
    for (
      let i = 0;
      i < organisations.length;
      i++
    ) {
      const organisation = organisations[i];

      console.log(
        "\n========================================"
      );

      console.log(
        `[${i + 1}/${organisations.length}] ${organisation.name}`
      );

      console.log(
        "========================================"
      );

      try {
        // Step 4: Scrape tenders
        const tenders =
          await scrapeTendersByOrganisation(
            organisation.name,
            browser
          );

        console.log(
          `Scraped: ${tenders.length}`
        );

        // Step 5: No tenders found
        if (tenders.length === 0) {
          console.log(
            "No tenders found."
          );

          continue;
        }

        // Step 6: Insert / skip duplicate tenders
        const result =
          await upsertTenders(tenders);

        console.log(
          `Inserted: ${result.inserted} | Skipped: ${result.skipped}`
        );

        totalScraped +=
          tenders.length;

        totalInserted +=
          result.inserted;

        totalSkipped +=
          result.skipped;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error);

        failedOrganisations.push({
          name: organisation.name,
          error: errorMessage,
        });

        console.error(
          `FAILED: ${organisation.name}`
        );

        console.error(
          `Error: ${errorMessage}`
        );

        // Continue with next organisation
        continue;
      }
    }

    // Step 7: Calculate duration
    const durationMs =
      Date.now() - startedAt;

    // Step 8: Final result
    console.log(
      "\n\n========================================"
    );

    console.log(
      "       FINAL SYNC RESULT"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Organisations : ${organisations.length}`
    );

    console.log(
      `Successful    : ${
        organisations.length -
        failedOrganisations.length
      }`
    );

    console.log(
      `Failed        : ${failedOrganisations.length}`
    );

    console.log(
      `Total Scraped : ${totalScraped}`
    );

    console.log(
      `Total Inserted: ${totalInserted}`
    );

    console.log(
      `Total Skipped : ${totalSkipped}`
    );

    console.log(
      `Duration      : ${Math.round(
        durationMs / 1000
      )} sec`
    );

    // Step 9: Show failed organisations
    if (
      failedOrganisations.length > 0
    ) {
      console.log(
        "\n========================================"
      );

      console.log(
        "       FAILED ORGANISATIONS"
      );

      console.log(
        "========================================"
      );

      failedOrganisations.forEach(
        (item, index) => {
          console.log(
            `\n${index + 1}. ${item.name}`
          );

          console.log(
            `Error: ${item.error}`
          );
        }
      );
    }

    // Step 10: Complete
    console.log(
      "\n========================================"
    );

    console.log(
      "             SYNC COMPLETE"
    );

    console.log(
      "========================================"
    );
  } catch (error) {
    console.error(
      "\nALL ORGANISATION SYNC FAILED:"
    );

    console.error(error);

    process.exit(1);
  } finally {
    // Close the shared browser only once
    if (browser) {
      console.log(
        "\nClosing shared browser..."
      );

      await browser.close();

      console.log(
        "Shared browser closed."
      );
    }
  }
}

main();