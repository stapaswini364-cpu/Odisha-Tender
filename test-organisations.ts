import "dotenv/config";
import { scrapeOrganisations } from "./scraper/organisations";

async function main() {
  try {
    const organisations = await scrapeOrganisations();

    console.log("\n========== ORGANISATIONS ==========\n");

    organisations.forEach((organisation, index) => {
      console.log(
        `${index + 1}. ${organisation.name} | Tenders: ${organisation.tenderCount}`
      );
    });

    console.log(
      `\nTotal Organisations: ${organisations.length}`
    );
  } catch (error) {
    console.error("Organisation scraper failed:", error);
    process.exit(1);
  }
}

main();