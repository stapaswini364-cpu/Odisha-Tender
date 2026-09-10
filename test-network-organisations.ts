import "dotenv/config";

import { scrapeTendersByOrganisation } from "./scraper/tenders";
import { createBrowser } from "./scraper/browser";

const organisations = [
  "CE-BM,LMB Basin,BBSR",
  "CE-BM,RVN Basin,Berhampur",
  "ST and SC Development Deptt",
  "WAPCOS LIMITED",
  "WATCO Bhubaneswar",
];

type TestResult = {
  organisation: string;
  status: "SUCCESS" | "FAILED";
  tenderCount: number;
  error?: string;
  durationMs: number;
};

async function main() {
  const startedAt = Date.now();

  console.log("========================================");
  console.log("    NETWORK ORGANISATIONS TEST");
  console.log("========================================");

  console.log(
    `Total organisations to test: ${organisations.length}`
  );

  const results: TestResult[] = [];

  let browser: Awaited<
    ReturnType<typeof createBrowser>
  > | null = null;

  try {
    console.log("\nStarting shared browser...");

    browser = await createBrowser();

    console.log("Shared browser started.");

    for (let i = 0; i < organisations.length; i++) {
      const organisation = organisations[i];

      console.log("\n========================================");
      console.log(
        `[${i + 1}/${organisations.length}] ${organisation}`
      );
      console.log("========================================");

      const organisationStartedAt = Date.now();

      try {
        const tenders =
          await scrapeTendersByOrganisation(
            organisation,
            browser
          );

        const durationMs =
          Date.now() - organisationStartedAt;

        console.log("\n----------------------------------------");
        console.log("RESULT");
        console.log("----------------------------------------");

        console.log(
          `Organisation : ${organisation}`
        );

        console.log(
          `Status       : SUCCESS`
        );

        console.log(
          `Tender Count : ${tenders.length}`
        );

        console.log(
          `Duration     : ${Math.round(
            durationMs / 1000
          )} sec`
        );

        results.push({
          organisation,
          status: "SUCCESS",
          tenderCount: tenders.length,
          durationMs,
        });
      } catch (error) {
        const durationMs =
          Date.now() - organisationStartedAt;

        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          "\n----------------------------------------"
        );

        console.error("RESULT");

        console.error(
          "----------------------------------------"
        );

        console.error(
          `Organisation : ${organisation}`
        );

        console.error(
          `Status       : FAILED`
        );

        console.error(
          `Error        : ${errorMessage}`
        );

        console.error(
          `Duration     : ${Math.round(
            durationMs / 1000
          )} sec`
        );

        results.push({
          organisation,
          status: "FAILED",
          tenderCount: 0,
          error: errorMessage,
          durationMs,
        });
      }
    }

    const totalDurationMs =
      Date.now() - startedAt;

    const successful = results.filter(
      (item) => item.status === "SUCCESS"
    );

    const failed = results.filter(
      (item) => item.status === "FAILED"
    );

    console.log("\n\n========================================");
    console.log("       NETWORK TEST FINAL RESULT");
    console.log("========================================");

    console.log(
      `Total Tested : ${results.length}`
    );

    console.log(
      `Successful   : ${successful.length}`
    );

    console.log(
      `Failed       : ${failed.length}`
    );

    console.log(
      `Total Time   : ${Math.round(
        totalDurationMs / 1000
      )} sec`
    );

    console.log("\n========================================");
    console.log("          SUCCESSFUL ORGANISATIONS");
    console.log("========================================");

    if (successful.length === 0) {
      console.log("None");
    } else {
      successful.forEach((item, index) => {
        console.log(
          `${index + 1}. ${item.organisation} | ${
            item.tenderCount
          } tenders | ${Math.round(
            item.durationMs / 1000
          )} sec`
        );
      });
    }

    console.log("\n========================================");
    console.log("            FAILED ORGANISATIONS");
    console.log("========================================");

    if (failed.length === 0) {
      console.log("None");
    } else {
      failed.forEach((item, index) => {
        console.log(
          `\n${index + 1}. ${item.organisation}`
        );

        console.log(
          `   Error: ${item.error}`
        );

        console.log(
          `   Duration: ${Math.round(
            item.durationMs / 1000
          )} sec`
        );
      });
    }

    console.log("\n========================================");
    console.log("             TEST COMPLETE");
    console.log("========================================");
  } finally {
    if (browser) {
      console.log("\nClosing shared browser...");

      await browser.close();

      console.log("Shared browser closed.");
    }
  }
}

main();