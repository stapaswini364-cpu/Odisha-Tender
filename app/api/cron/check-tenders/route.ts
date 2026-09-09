import { NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { db } from "@/db";

import {
  organisations,
  tenders,
  jobRuns,
  notificationLogs,
  scraperState,
} from "@/db/schema";

import { scrapeOrganisations } from "@/scraper/organisations";

import { scrapeTendersByOrganisation } from "@/scraper/tenders";

const BATCH_SIZE = 15;

const CURSOR_KEY = "org_cursor";

type ProcessOrganisationResult = {
  newItemsFound: number;
  notificationsSent: number;
  status: "success" | "captcha_failed" | "failed";
  errorMessage: string | null;
};

type TelegramItem = {
  organisation: string;
  type: string;
  title: string;
  referenceNo: string | null;
  detectedAt: string;
  sourceUrl: string;
};

/**
 * Send Telegram notification.
 */
async function sendTelegramNotification(
  item: TelegramItem
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  if (!chatId) {
    throw new Error(
      "TELEGRAM_CHAT_ID is not configured"
    );
  }

  const url =
    `https://api.telegram.org/bot${token}/sendMessage`;

  const message = `🔔 New Odisha Tender Detected

Organisation: ${item.organisation}

Type: ${item.type}

Title: ${item.title}

Reference: ${item.referenceNo ?? "N/A"}

Detected: ${item.detectedAt}

Link: ${item.sourceUrl}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Telegram HTTP error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * Process one organisation.
 */
async function processOrganisation(
  org: {
    name: string;
    tenderCount: number;
  }
): Promise<ProcessOrganisationResult> {
  let newItemsFound = 0;
  let notificationsSent = 0;

  try {
    /**
     * Upsert organisation.
     */
    const [orgRecord] = await db
      .insert(organisations)
      .values({
        name: org.name,
        lastKnownCount: org.tenderCount,
      })
      .onConflictDoUpdate({
        target: organisations.name,
        set: {
          lastKnownCount: org.tenderCount,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!orgRecord) {
      throw new Error(
        `Unable to create/find organisation: ${org.name}`
      );
    }

    /**
     * Scrape tenders.
     */
    const scrapedTenders =
      await scrapeTendersByOrganisation(
        org.name
      );

    console.log(
      `${org.name}: ${scrapedTenders.length} tenders scraped`
    );

    /**
     * Process each tender.
     */
    for (const t of scrapedTenders) {
      /**
       * Check existing tender.
       *
       * externalKey is unique and is our
       * primary idempotency key.
       */
      const existing = await db
        .select()
        .from(tenders)
        .where(
          eq(
            tenders.externalKey,
            t.externalKey
          )
        )
        .limit(1);

      /**
       * Already processed.
       *
       * Do not create another tender and
       * do not send another notification.
       */
      if (existing.length > 0) {
        continue;
      }

      /**
       * Insert new tender.
       */
      const [newTender] = await db
        .insert(tenders)
        .values({
          organisationId: orgRecord.id,
          externalKey: t.externalKey,
          title: t.title,
          referenceNo: t.referenceNo,
          type: t.type,
          sourceUrl: t.sourceUrl,
          publishedAt: t.publishedAt,
          notificationStatus: "pending",
        })
        .returning();

      if (!newTender) {
        throw new Error(
          `Failed to insert tender: ${t.externalKey}`
        );
      }

      newItemsFound++;

      /**
       * Telegram notification.
       */
      try {
        const tgResult =
          await sendTelegramNotification({
            organisation: org.name,
            type: t.type,
            title: t.title,
            referenceNo: t.referenceNo,
            detectedAt:
              new Date().toISOString(),
            sourceUrl: t.sourceUrl,
          });

        if (tgResult?.ok) {
          /**
           * Mark tender notification as sent.
           */
          await db
            .update(tenders)
            .set({
              notificationStatus: "sent",
              notifiedAt: new Date(),
            })
            .where(
              eq(
                tenders.id,
                newTender.id
              )
            );

          /**
           * Save notification log.
           */
          await db
            .insert(notificationLogs)
            .values({
              tenderId: newTender.id,
              chatId:
                process.env
                  .TELEGRAM_CHAT_ID ?? null,
              status: "sent",
              sentAt: new Date(),
              attemptCount: 1,
            });

          notificationsSent++;
        } else {
          /**
           * Telegram API returned an unsuccessful
           * response.
           */
          const telegramError =
            JSON.stringify(tgResult);

          await db
            .update(tenders)
            .set({
              notificationStatus: "failed",
            })
            .where(
              eq(
                tenders.id,
                newTender.id
              )
            );

          await db
            .insert(notificationLogs)
            .values({
              tenderId: newTender.id,
              chatId:
                process.env
                  .TELEGRAM_CHAT_ID ?? null,
              status: "failed",
              attemptCount: 1,
              errorMessage: telegramError,
            });

          console.error(
            `Telegram notification failed for tender ${newTender.id}:`,
            telegramError
          );
        }
      } catch (telegramError) {
        const errorMessage =
          telegramError instanceof Error
            ? telegramError.message
            : String(telegramError);

        console.error(
          `Telegram error for tender ${newTender.id}:`,
          errorMessage
        );

        /**
         * Tender remains in database.
         *
         * This prevents duplicate tender creation
         * on the next scrape.
         */
        await db
          .update(tenders)
          .set({
            notificationStatus: "failed",
          })
          .where(
            eq(
              tenders.id,
              newTender.id
            )
          );

        await db
          .insert(notificationLogs)
          .values({
            tenderId: newTender.id,
            chatId:
              process.env
                .TELEGRAM_CHAT_ID ?? null,
            status: "failed",
            attemptCount: 1,
            errorMessage,
          });
      }
    }

    return {
      newItemsFound,
      notificationsSent,
      status: "success",
      errorMessage: null,
    };
  } catch (orgError) {
    const errorMessage =
      orgError instanceof Error
        ? orgError.message
        : String(orgError);

    console.error(
      `Error processing ${org.name}:`,
      errorMessage
    );

    /**
     * CAPTCHA is treated separately.
     */
    if (
      errorMessage.startsWith(
        "CAPTCHA_REQUIRED:"
      )
    ) {
      return {
        newItemsFound,
        notificationsSent,
        status: "captcha_failed",
        errorMessage,
      };
    }

    return {
      newItemsFound,
      notificationsSent,
      status: "failed",
      errorMessage,
    };
  }
}

/**
 * POST
 *
 * Used by:
 * - Vercel Cron
 * - manual protected requests
 */
export async function POST(
  req: NextRequest
) {
  /**
   * Verify cron secret.
   */
  const authHeader =
    req.headers.get("authorization");

  const cronSecret =
    process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET is not configured",
      },
      { status: 500 }
    );
  }

  if (
    authHeader !==
    `Bearer ${cronSecret}`
  ) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      { status: 401 }
    );
  }

  const startTime = Date.now();

  let runStatus:
    | "running"
    | "success"
    | "failed"
    | "captcha_failed" = "running";

  let errorMessage:
    | string
    | null = null;

  let newItemsFound = 0;

  let notificationsSent = 0;

  /**
   * Create job run.
   */
  const [jobRun] = await db
    .insert(jobRuns)
    .values({
      status: "running",
    })
    .returning();

  if (!jobRun) {
    return NextResponse.json(
      {
        error:
          "Unable to create job run",
      },
      { status: 500 }
    );
  }

  try {
    /**
     * Get scraper cursor.
     */
    let stateRows = await db
      .select()
      .from(scraperState)
      .where(
        eq(
          scraperState.key,
          CURSOR_KEY
        )
      )
      .limit(1);

    /**
     * Create cursor if it doesn't exist.
     */
    if (stateRows.length === 0) {
      const [inserted] = await db
        .insert(scraperState)
        .values({
          key: CURSOR_KEY,
          cursor: 0,
        })
        .returning();

      stateRows = [inserted];
    }

    let cursor =
      stateRows[0].cursor ?? 0;

    /**
     * Scrape organisation list.
     */
    const allOrgs =
      await scrapeOrganisations();

    console.log(
      `Total organisations: ${allOrgs.length}. Starting from cursor: ${cursor}`
    );

    /**
     * Reset cursor if organisation list
     * became smaller.
     */
    if (
      cursor >= allOrgs.length
    ) {
      cursor = 0;
    }

    /**
     * Select current batch.
     */
    const batch = allOrgs.slice(
      cursor,
      cursor + BATCH_SIZE
    );

    console.log(
      `Processing batch: organisations ${cursor} to ${
        cursor + batch.length
      }`
    );

    let failedOrganisations = 0;

    let captchaFailures = 0;

    /**
     * Process organisations sequentially.
     */
    for (const org of batch) {
      const result =
        await processOrganisation(org);

      newItemsFound +=
        result.newItemsFound;

      notificationsSent +=
        result.notificationsSent;

      if (
        result.status ===
        "captcha_failed"
      ) {
        captchaFailures++;

        console.warn(
          `CAPTCHA failure for organisation: ${org.name}`
        );

        console.warn(
          result.errorMessage
        );
      }

      if (
        result.status === "failed"
      ) {
        failedOrganisations++;

        console.error(
          `Organisation failed: ${org.name}`
        );

        console.error(
          result.errorMessage
        );
      }
    }

    /**
     * Move cursor only after the batch has
     * been attempted.
     */
    const nextCursor =
      cursor + batch.length;

    const normalizedNextCursor =
      nextCursor >= allOrgs.length
        ? 0
        : nextCursor;

    await db
      .update(scraperState)
      .set({
        cursor: normalizedNextCursor,
        updatedAt: new Date(),
      })
      .where(
        eq(
          scraperState.key,
          CURSOR_KEY
        )
      );

    console.log(
      `Batch complete. Next cursor will be: ${normalizedNextCursor}`
    );

    /**
     * Determine final job status.
     */
    if (captchaFailures > 0) {
      runStatus = "captcha_failed";

      errorMessage =
        `${captchaFailures} organisation(s) encountered CAPTCHA. ` +
        `${failedOrganisations} organisation(s) failed.`;
    } else if (
      failedOrganisations > 0
    ) {
      runStatus = "failed";

      errorMessage =
        `${failedOrganisations} organisation(s) failed during processing.`;
    } else {
      runStatus = "success";
    }
  } catch (error) {
    runStatus = "failed";

    errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "Cron job failed:",
      errorMessage
    );
  }

  /**
   * Finalize job run.
   */
  const durationMs =
    Date.now() - startTime;

  await db
    .update(jobRuns)
    .set({
      finishedAt: new Date(),
      status: runStatus,
      newItemsFound,
      notificationsSent,
      durationMs,
      errorMessage,
    })
    .where(
      eq(
        jobRuns.id,
        jobRun.id
      )
    );

  /**
   * Return job result.
   */
  return NextResponse.json({
    status: runStatus,
    newItemsFound,
    notificationsSent,
    durationMs,
    error: errorMessage,
  });
}

/**
 * Vercel Cron sends GET requests.
 *
 * Reuse the same protected execution logic.
 */
export async function GET(
  req: NextRequest
) {
  return POST(req);
}