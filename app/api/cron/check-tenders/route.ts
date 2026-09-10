import { NextRequest, NextResponse } from "next/server";

import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db";

import {
  organisations,
  tenders,
  jobRuns,
  notificationLogs,
  scraperState,
  cronLocks,
} from "@/db/schema";

import { scrapeOrganisations } from "@/scraper/organisations";
import { scrapeTendersByOrganisation } from "@/scraper/tenders";
import { createBrowser } from "@/scraper/browser";

const BATCH_SIZE = 2;

const CURSOR_KEY = "org_cursor";

const CRON_LOCK_KEY = "check-tenders";

/**
 * A lock older than this duration is considered stale.
 *
 * Kept short because Vercel serverless functions can be killed
 * by the platform timeout before the finally block runs, which
 * would otherwise leave the lock stuck for a long time.
 */
const STALE_LOCK_MS = 8 * 60 * 1000;

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
 * Acquire cron lock atomically.
 *
 * Strategy:
 *
 * 1. Try to insert a new lock.
 * 2. If a lock already exists, check whether it is stale.
 * 3. If stale, atomically reclaim it.
 * 4. If active, return false.
 *
 * PostgreSQL primary key on cron_locks.key guarantees
 * concurrent jobs cannot both acquire the same lock.
 */
async function acquireCronLock(
  jobRunId: string
): Promise<boolean> {
  const now = new Date();

  /**
   * First attempt:
   * acquire completely free lock.
   */
  const inserted = await db
    .insert(cronLocks)
    .values({
      key: CRON_LOCK_KEY,
      jobRunId,
      lockedAt: now,
    })
    .onConflictDoNothing({
      target: cronLocks.key,
    })
    .returning({
      key: cronLocks.key,
    });

  if (inserted.length > 0) {
    console.log(
      `Cron lock acquired for job ${jobRunId}`
    );

    return true;
  }

  /**
   * Existing lock found.
   *
   * Try to reclaim only if lockedAt is older
   * than the stale threshold.
   *
   * This UPDATE is atomic.
   */
  const staleBefore = new Date(
    Date.now() - STALE_LOCK_MS
  );

  const reclaimed = await db
    .update(cronLocks)
    .set({
      jobRunId,
      lockedAt: now,
    })
    .where(
      and(
        eq(
          cronLocks.key,
          CRON_LOCK_KEY
        ),
        lt(
          cronLocks.lockedAt,
          staleBefore
        )
      )
    )
    .returning({
      key: cronLocks.key,
    });

  if (reclaimed.length > 0) {
    console.warn(
      `Stale cron lock detected and reclaimed by job ${jobRunId}`
    );

    return true;
  }

  /**
   * Another healthy cron execution is still running.
   */
  console.warn(
    "Cron lock is currently active. Another job is already running."
  );

  return false;
}

/**
 * Release cron lock.
 *
 * jobRunId is checked so an old execution cannot
 * accidentally delete a newer execution's lock.
 */
async function releaseCronLock(
  jobRunId: string
): Promise<void> {
  await db
    .delete(cronLocks)
    .where(
      and(
        eq(
          cronLocks.key,
          CRON_LOCK_KEY
        ),
        eq(
          cronLocks.jobRunId,
          jobRunId
        )
      )
    );
}

/**
 * Process one organisation.
 *
 * Browser is passed from the batch so the same browser
 * instance can be reused for multiple organisations.
 */
async function processOrganisation(
  org: {
    name: string;
    tenderCount: number;
  },
  browser: Awaited<
    ReturnType<typeof createBrowser>
  >
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
        org.name,
        browser
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

          await db
            .insert(notificationLogs)
            .values({
              tenderId: newTender.id,
              chatId:
                process.env.TELEGRAM_CHAT_ID ??
                null,
              status: "sent",
              sentAt: new Date(),
              attemptCount: 1,
            });

          notificationsSent++;
        } else {
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
                process.env.TELEGRAM_CHAT_ID ??
                null,
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
              process.env.TELEGRAM_CHAT_ID ??
              null,
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
      startedAt: new Date(),
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

  /**
   * IMPORTANT:
   *
   * Keep this flag so the finally block only
   * releases a lock actually owned by this job.
   */
  let lockAcquired = false;

  /**
   * ==================================================
   * MAIN CRON EXECUTION
   * ==================================================
   */
  try {
    /**
     * Atomic cron lock.
     */
    lockAcquired =
      await acquireCronLock(
        jobRun.id
      );

    if (!lockAcquired) {
      runStatus = "failed";

      errorMessage =
        "Skipped because another cron job is already running.";

      console.warn(
        "Cron skipped: another check-tenders job is already running."
      );

      return NextResponse.json(
        {
          status: "skipped",
          reason: "job_already_running",
        },
        { status: 409 }
      );
    }

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

      if (!inserted) {
        throw new Error(
          "Unable to initialize scraper cursor"
        );
      }

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
     * Create ONE browser for the complete batch.
     */
    const browser =
      await createBrowser();

    try {
      /**
       * Process organisations sequentially.
       */
      for (const org of batch) {
        const result =
          await processOrganisation(
            org,
            browser
          );

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
          result.status ===
          "failed"
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
    } finally {
      /**
       * Always close browser.
       */
      try {
        await browser.close();

        console.log(
          "Browser closed successfully."
        );
      } catch (browserError) {
        console.error(
          "Failed to close browser:",
          browserError
        );
      }
    }

    /**
     * Move cursor after batch attempt.
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
      runStatus =
        "captcha_failed";

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
  } finally {
    /**
     * ==================================================
     * GUARANTEED LOCK RELEASE
     * ==================================================
     *
     * Release first so that even if job-run
     * finalization fails, the next cron execution
     * is not permanently blocked.
     */
    if (lockAcquired) {
      try {
        await releaseCronLock(
          jobRun.id
        );

        console.log(
          `Cron lock released for job ${jobRun.id}`
        );
      } catch (lockError) {
        console.error(
          "Failed to release cron lock:",
          lockError
        );
      }
    }

    /**
     * Finalize job run.
     *
     * This is deliberately inside its own try/catch
     * so a database finalization error cannot affect
     * lock release.
     */
    try {
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

      console.log(
        `Job run ${jobRun.id} finalized with status: ${runStatus}`
      );
    } catch (finalizationError) {
      console.error(
        "Failed to finalize job run:",
        finalizationError
      );
    }
  }

  /**
   * Return job result.
   */
  const durationMs =
    Date.now() - startTime;

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