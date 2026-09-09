import "dotenv/config";

import { scrapeTendersByOrganisation } from "./scraper/tenders";
import { upsertTenders } from "./db/queries/tenders";

async function main() {
  const organisationName = "CE RW I";

  try {
    console.log("========================================");
    console.log("     TENDER DATABASE SYNC TEST");
    console.log("========================================");
    console.log(`Organisation: ${organisationName}\n`);

    const tenders =
      await scrapeTendersByOrganisation(organisationName);

    console.log(
      `Scraped tenders: ${tenders.length}`
    );

    const result = await upsertTenders(tenders);

    console.log("\n========================================");
    console.log("DATABASE SYNC RESULT");
    console.log("========================================");

    console.log(`Inserted : ${result.inserted}`);
    console.log(`Skipped  : ${result.skipped}`);
    console.log("========================================");
  } catch (error) {
    console.error("\nTender DB sync failed:");
    console.error(error);
    process.exit(1);
  }
}

main();