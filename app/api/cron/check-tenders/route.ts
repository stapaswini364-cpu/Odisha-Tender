import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations, tenders, jobRuns, notificationLogs, scraperState } from "@/db/schema";
import { scrapeOrganisations } from "@/scraper/organisations";
import { scrapeTendersByOrganisation } from "@/scraper/tenders";

const BATCH_SIZE = 15; // kitne organisations har cron run mein process honge
const CURSOR_KEY = "org_cursor";

async function sendTelegramNotification(item: {
  organisation: string;
  type: string;
  title: string;
  referenceNo: string | null;
  detectedAt: string;
  sourceUrl: string;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const message = `🔔 New Odisha Tender Detected
Organisation: ${item.organisation}
Type: ${item.type}
Title: ${item.title}
Reference: ${item.referenceNo ?? "N/A"}
Detected: ${item.detectedAt}
Link: ${item.sourceUrl}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  return response.json();
}

async function processOrganisation(org: { name: string; tenderCount: number }) {
  let newItemsFound = 0;
  let notificationsSent = 0;

  try {
    const [orgRecord] = await db
      .insert(organisations)
      .values({ name: org.name, lastKnownCount: org.tenderCount })
      .onConflictDoUpdate({
        target: organisations.name,
        set: { lastKnownCount: org.tenderCount, updatedAt: new Date() },
      })
      .returning();

    const scrapedTenders = await scrapeTendersByOrganisation(org.name);

    for (const t of scrapedTenders) {
      const existing = await db
        .select()
        .from(tenders)
        .where(eq(tenders.externalKey, t.externalKey))
        .limit(1);

      if (existing.length > 0) continue;

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

      newItemsFound++;

      try {
        const tgResult = await sendTelegramNotification({
          organisation: org.name,
          type: t.type,
          title: t.title,
          referenceNo: t.referenceNo,
          detectedAt: new Date().toISOString(),
          sourceUrl: t.sourceUrl,
        });

        if (tgResult.ok) {
          await db
            .update(tenders)
            .set({ notificationStatus: "sent", notifiedAt: new Date() })
            .where(eq(tenders.id, newTender.id));

          await db.insert(notificationLogs).values({
            tenderId: newTender.id,
            chatId: process.env.TELEGRAM_CHAT_ID,
            status: "sent",
            sentAt: new Date(),
          });

          notificationsSent++;
        } else {
          await db
            .update(tenders)
            .set({ notificationStatus: "failed" })
            .where(eq(tenders.id, newTender.id));

          await db.insert(notificationLogs).values({
            tenderId: newTender.id,
            chatId: process.env.TELEGRAM_CHAT_ID,
            status: "failed",
            errorMessage: JSON.stringify(tgResult),
          });
        }
      } catch (tgErr: any) {
        console.error("Telegram error:", tgErr.message);
        await db.insert(notificationLogs).values({
          tenderId: newTender.id,
          chatId: process.env.TELEGRAM_CHAT_ID,
          status: "failed",
          errorMessage: tgErr.message,
        });
      }
    }
  } catch (orgErr: any) {
    console.error(`Error processing ${org.name}:`, orgErr.message);
  }

  return { newItemsFound, notificationsSent };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  let runStatus = "running";
  let errorMessage: string | null = null;
  let newItemsFound = 0;
  let notificationsSent = 0;

  const [jobRun] = await db
    .insert(jobRuns)
    .values({ status: "running" })
    .returning();

  try {
    let stateRows = await db
      .select()
      .from(scraperState)
      .where(eq(scraperState.key, CURSOR_KEY))
      .limit(1);

    if (stateRows.length === 0) {
      const [inserted] = await db
        .insert(scraperState)
        .values({ key: CURSOR_KEY, cursor: 0 })
        .returning();
      stateRows = [inserted];
    }

    let cursor = stateRows[0].cursor ?? 0;

    const allOrgs = await scrapeOrganisations();
    console.log(`Total organisations: ${allOrgs.length}. Starting from cursor: ${cursor}`);

    if (cursor >= allOrgs.length) {
      cursor = 0;
    }

    const batch = allOrgs.slice(cursor, cursor + BATCH_SIZE);
    console.log(`Processing batch: organisations ${cursor} to ${cursor + batch.length}`);

    for (const org of batch) {
      const result = await processOrganisation(org);
      newItemsFound += result.newItemsFound;
      notificationsSent += result.notificationsSent;
    }

    const nextCursor = cursor + batch.length;
    await db
      .update(scraperState)
      .set({ cursor: nextCursor, updatedAt: new Date() })
      .where(eq(scraperState.key, CURSOR_KEY));

    console.log(`Batch complete. Next cursor will be: ${nextCursor >= allOrgs.length ? 0 : nextCursor}`);

    runStatus = "success";
  } catch (err: any) {
    runStatus = "failed";
    errorMessage = err.message;
    console.error("Cron job failed:", err.message);
  }

  const durationMs = Date.now() - startTime;
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
    .where(eq(jobRuns.id, jobRun.id));

  return NextResponse.json({
    status: runStatus,
    newItemsFound,
    notificationsSent,
    durationMs,
    error: errorMessage,
  });
}

// Vercel Cron sends GET requests with the Authorization header automatically.
// This lets scheduled cron triggers reuse the same logic as manual POST calls.
export async function GET(req: NextRequest) {
  return POST(req);
}