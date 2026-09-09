import "dotenv/config";

import { scrapeTendersByOrganisation } from "./scraper/tenders";

async function main() {
  const organisationName =
    "CE-BM,BSB Basin,Laxmiposi";

  console.log("========================================");
  console.log("       SINGLE ORGANISATION TEST");
  console.log("========================================");

  console.log(
    `Organisation: ${organisationName}`
  );

  try {
    const tenders =
      await scrapeTendersByOrganisation(
        organisationName
      );

    console.log("\n========================================");
    console.log("             TEST RESULT");
    console.log("========================================");

    console.log(
      `Organisation: ${organisationName}`
    );

    console.log(
      `Total tenders: ${tenders.length}`
    );

    if (tenders.length === 0) {
      console.log("\nNo tenders found.");
      return;
    }

    console.log("\nTenders:");

    tenders.forEach((tender, index) => {
      console.log(
        "\n----------------------------------------"
      );

      console.log(
        `#${index + 1}`
      );

      console.log(
        `Title        : ${tender.title}`
      );

      console.log(
        `Reference No : ${tender.referenceNo ?? "N/A"}`
      );

      console.log(
        `External Key : ${tender.externalKey}`
      );

      console.log(
        `Type         : ${tender.type}`
      );

      console.log(
        `Published    : ${
          tender.publishedAt
            ? tender.publishedAt.toISOString()
            : "N/A"
        }`
      );

      console.log(
        `Source URL   : ${tender.sourceUrl}`
      );
    });

    console.log("\n========================================");
    console.log("           TEST COMPLETED");
    console.log("========================================");
  } catch (error) {
    console.error(
      "\n========================================"
    );

    console.error(
      "             TEST FAILED"
    );

    console.error(
      "========================================"
    );

    console.error(error);
  }
}

main();