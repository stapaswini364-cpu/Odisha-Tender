import "dotenv/config";

import { Page } from "playwright-core";

import { createBrowser } from "./browser";

const ORGANISATION_URL =
  process.env.PORTAL_TENDERS_BY_ORG_URL ||
  "https://tendersodisha.gov.in/nicgep/app?page=FrontEndTendersByOrganisation&service=page";

const PORTAL_BASE_URL =
  process.env.PORTAL_BASE_URL ||
  "https://tendersodisha.gov.in";

export type ScrapedTender = {
  organisationName: string;
  title: string;
  referenceNo: string | null;
  externalKey: string;
  type: "tender" | "corrigendum";
  sourceUrl: string;
  publishedAt: Date | null;
};

/**
 * Parse portal date format.
 *
 * Example:
 * 08-Sep-2026 06:00 PM
 */
function parsePortalDate(value: string): Date | null {
  const match = value.match(
    /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i
  );

  if (!match) {
    return null;
  }

  const [
    ,
    day,
    monthText,
    year,
    hourText,
    minute,
    meridiem,
  ] = match;

  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const month = months[monthText];

  if (month === undefined) {
    return null;
  }

  let hour = Number(hourText);

  if (meridiem.toUpperCase() === "PM" && hour !== 12) {
    hour += 12;
  }

  if (meridiem.toUpperCase() === "AM" && hour === 12) {
    hour = 0;
  }

  return new Date(
    Number(year),
    month,
    Number(day),
    hour,
    Number(minute)
  );
}

/**
 * Parse tender text.
 *
 * Expected format:
 *
 * [Tender Title]
 * [Reference Number]
 * [External Tender ID]
 */
function parseTenderDetails(value: string) {
  const parts = [...value.matchAll(/\[([^\]]+)\]/g)].map(
    (match) => match[1].trim()
  );

  const title = parts[0] || "";
  const referenceNo = parts[1] || null;
  const externalKey = parts[2] || "";

  return {
    title,
    referenceNo,
    externalKey,
  };
}

/**
 * Open organisation listing page with retry handling.
 *
 * Portal can sometimes be slow or temporarily unavailable.
 */
async function openOrganisationPage(page: Page) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `Opening organisation page (attempt ${attempt}/${maxAttempts})...`
      );

      await page.goto(ORGANISATION_URL, {
        waitUntil: "commit",
        timeout: 60_000,
      });

      await page
        .waitForLoadState("domcontentloaded", {
          timeout: 30_000,
        })
        .catch(() => {
          console.warn(
            "DOMContentLoaded timeout. Continuing because navigation committed."
          );
        });

      const organisationTable = page.locator("#table");

      await organisationTable.waitFor({
        state: "visible",
        timeout: 30_000,
      });

      console.log("Organisation table loaded.");

      return;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      console.warn(
        `Organisation page attempt ${attempt} failed:`
      );

      console.warn(errorMessage);

      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = 3000 * attempt;

      console.log(
        `Retrying organisation page after ${delay}ms...`
      );

      await page.waitForTimeout(delay);
    }
  }
}

/**
 * Detect whether the portal is asking for CAPTCHA.
 *
 * Current portal CAPTCHA image selector:
 * #captchaImage
 */
async function detectCaptcha(page: Page): Promise<boolean> {
  const captchaImage = page.locator("#captchaImage");

  try {
    await captchaImage.waitFor({
      state: "visible",
      timeout: 3_000,
    });

    console.warn("CAPTCHA detected on tender page.");

    return true;
  } catch {
    return false;
  }
}

/**
 * Scrape tenders for a single organisation.
 *
 * Browser is provided by the caller so that the same browser
 * instance can be reused across multiple organisations.
 */
export async function scrapeTendersByOrganisation(
  organisationName: string,
  browser: Awaited<ReturnType<typeof createBrowser>>
): Promise<ScrapedTender[]> {
  const page = await browser.newPage();

  try {
    console.log(
      `\n========================================`
    );

    console.log(
      `Scraping organisation: ${organisationName}`
    );

    console.log(
      `========================================`
    );

    /**
     * Step 1:
     * Open organisation listing page.
     */
    await openOrganisationPage(page);

    /**
     * Step 2:
     * Get organisation table.
     */
    const organisationTable = page.locator("#table");

    /**
     * Step 3:
     * Find requested organisation.
     */
    const organisationRow = organisationTable
      .locator("tr")
      .filter({
        hasText: organisationName,
      })
      .first();

    if ((await organisationRow.count()) === 0) {
      throw new Error(
        `Organisation not found: ${organisationName}`
      );
    }

    /**
     * Step 4:
     * Get organisation link.
     */
    const organisationLink = organisationRow
      .locator("a")
      .first();

    if ((await organisationLink.count()) === 0) {
      throw new Error(
        `Organisation link not found: ${organisationName}`
      );
    }

    /**
     * Step 5:
     * Get organisation href.
     *
     * IMPORTANT:
     * We use direct navigation instead of click()
     * because the portal can sometimes cause
     * Playwright navigation timeout after click().
     */
    const organisationHref =
      await organisationLink.getAttribute("href");

    if (!organisationHref) {
      throw new Error(
        `Organisation link href not found: ${organisationName}`
      );
    }

    /**
     * Step 6:
     * Convert relative URL into absolute URL.
     */
    const organisationUrl = new URL(
      organisationHref,
      PORTAL_BASE_URL
    ).toString();

    console.log(
      `Opening tender page directly: ${organisationUrl}`
    );

    /**
     * Step 7:
     * Navigate directly to tender page.
     */
    await page.goto(organisationUrl, {
      waitUntil: "commit",
      timeout: 60_000,
    });

    await page
      .waitForLoadState("domcontentloaded", {
        timeout: 30_000,
      })
      .catch(() => {
        console.warn(
          "Tender page DOMContentLoaded timeout. Continuing..."
        );
      });

    console.log(
      "Tender page loaded:",
      page.url()
    );

    /**
     * Step 8:
     * Detect CAPTCHA.
     *
     * We do not automatically bypass the portal CAPTCHA.
     * Instead, report a specific CAPTCHA error so the
     * cron/job-run layer can mark this run appropriately.
     */
    const captchaDetected = await detectCaptcha(page);

    if (captchaDetected) {
      throw new Error(
        `CAPTCHA_REQUIRED: Portal CAPTCHA detected for ${organisationName}`
      );
    }

    /**
     * Step 9:
     * Wait for actual tender links.
     *
     * We intentionally target only actual tender
     * detail links.
     */
    const tenderLinks = page.locator(
      'a[href*="FrontEndViewTender"]'
    );

    await tenderLinks
      .first()
      .waitFor({
        state: "visible",
        timeout: 30_000,
      })
      .catch(() => {
        console.warn(
          `No visible tender link found immediately for ${organisationName}`
        );
      });

    const tenderLinkCount =
      await tenderLinks.count();

    console.log(
      `Tender links found for ${organisationName}: ${tenderLinkCount}`
    );

    const tenders: ScrapedTender[] = [];

    /**
     * Prevent duplicate records within
     * the same scrape.
     */
    const seenKeys = new Set<string>();

    /**
     * Step 10:
     * Parse each tender row.
     */
    for (
      let i = 0;
      i < tenderLinkCount;
      i++
    ) {
      try {
        const link = tenderLinks.nth(i);

        /**
         * Get parent tender row.
         */
        const row = link.locator(
          "xpath=ancestor::tr[1]"
        );

        const cells = await row
          .locator("td")
          .allInnerTexts();

        /**
         * Expected tender table:
         *
         * 0 = S.No
         * 1 = Published Date
         * 2 = Closing Date
         * 3 = Opening Date
         * 4 = Tender Details
         * 5 = Organisation
         */
        if (cells.length < 6) {
          console.warn(
            `Skipping row ${i + 1}: expected 6 columns, got ${cells.length}`
          );

          continue;
        }

        const serialNo =
          cells[0].trim();

        const publishedText =
          cells[1].trim();

        const tenderText =
          cells[4].trim();

        /**
         * Get tender URL.
         */
        const sourceHref =
          await link.getAttribute("href");

        if (!sourceHref) {
          console.warn(
            `Skipping row ${serialNo}: source URL missing`
          );

          continue;
        }

        const sourceUrl = new URL(
          sourceHref,
          PORTAL_BASE_URL
        ).toString();

        /**
         * Parse:
         *
         * title
         * reference number
         * external tender ID
         */
        const {
          title,
          referenceNo,
          externalKey,
        } = parseTenderDetails(
          tenderText
        );

        /**
         * External key is required for
         * reliable idempotent deduplication.
         */
        if (!externalKey) {
          console.warn(
            `Skipping row ${serialNo}: external tender ID missing`
          );

          continue;
        }

        /**
         * Prevent duplicate tender keys
         * within current scrape.
         */
        if (seenKeys.has(externalKey)) {
          console.warn(
            `Duplicate tender skipped: ${externalKey}`
          );

          continue;
        }

        seenKeys.add(externalKey);

        /**
         * Detect tender type.
         */
        const type = /corrigendum/i.test(
          tenderText
        )
          ? "corrigendum"
          : "tender";

        /**
         * Add normalized tender.
         */
        tenders.push({
          organisationName,
          title,
          referenceNo,
          externalKey,
          type,
          sourceUrl,
          publishedAt:
            parsePortalDate(
              publishedText
            ),
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error);

        console.warn(
          `Failed to parse tender row ${i + 1} for ${organisationName}:`
        );

        console.warn(errorMessage);

        /**
         * Do not fail the complete organisation
         * because one tender row is malformed.
         */
        continue;
      }
    }

    console.log(
      `Successfully parsed ${tenders.length} tenders.`
    );

    return tenders;
  } finally {
    /**
     * Close only the page.
     *
     * The browser itself is intentionally kept open
     * and reused by the cron batch.
     */
    await page.close();
  }
}