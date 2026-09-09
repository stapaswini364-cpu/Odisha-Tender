import "dotenv/config";

import { scrapeOrganisations } from "./scraper/organisations";
import { upsertOrganisations } from "./db/queries/organisations";

async function main() {
  try {
    console.log("Starting organisation sync...\n");

    const organisations = await scrapeOrganisations();

    console.log(
      `Scraped organisations: ${organisations.length}`
    );

    await upsertOrganisations(organisations);

    console.log(
      `Successfully synced ${organisations.length} organisations to Supabase.`
    );
  } catch (error) {
    console.error("Organisation DB sync failed:", error);
    process.exit(1);
  }
}

main();