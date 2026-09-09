import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  organisations,
  tenders,
  jobRuns,
  notificationLogs,
} from "@/db/schema";

export async function GET() {
  try {
    // ---------------------------------------------
    // 1. Total organisations
    // ---------------------------------------------
    const organisationCountResult = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(organisations);

    const totalOrganisations = Number(
      organisationCountResult[0]?.count ?? 0
    );

    // ---------------------------------------------
    // 2. Latest job run
    // ---------------------------------------------
    const latestJobRuns = await db
      .select({
        id: jobRuns.id,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
        status: jobRuns.status,
        newItemsFound: jobRuns.newItemsFound,
        notificationsSent: jobRuns.notificationsSent,
        durationMs: jobRuns.durationMs,
        errorMessage: jobRuns.errorMessage,
      })
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);

    const latestJobRun = latestJobRuns[0] ?? null;

    // ---------------------------------------------
    // 3. Latest tenders
    // ---------------------------------------------
    const latestTenders = await db
      .select({
        id: tenders.id,
        externalKey: tenders.externalKey,
        title: tenders.title,
        referenceNo: tenders.referenceNo,
        type: tenders.type,
        sourceUrl: tenders.sourceUrl,
        publishedAt: tenders.publishedAt,
        detectedAt: tenders.detectedAt,
        notifiedAt: tenders.notifiedAt,
        notificationStatus: tenders.notificationStatus,
        organisation: organisations.name,
      })
      .from(tenders)
      .leftJoin(
        organisations,
        eq(tenders.organisationId, organisations.id)
      )
      .orderBy(desc(tenders.detectedAt))
      .limit(10);

    // ---------------------------------------------
    // 4. Recent job runs
    // ---------------------------------------------
    const recentJobRuns = await db
      .select({
        id: jobRuns.id,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
        status: jobRuns.status,
        newItemsFound: jobRuns.newItemsFound,
        notificationsSent: jobRuns.notificationsSent,
        durationMs: jobRuns.durationMs,
        errorMessage: jobRuns.errorMessage,
      })
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(10);

    // ---------------------------------------------
    // 5. Notification statistics
    // ---------------------------------------------
    const notificationCountResult = await db
      .select({
        sent: sql<number>`
          count(*) filter (where ${notificationLogs.status} = 'sent')
        `,
        failed: sql<number>`
          count(*) filter (where ${notificationLogs.status} = 'failed')
        `,
      })
      .from(notificationLogs);

    const notificationStats = notificationCountResult[0] ?? {
      sent: 0,
      failed: 0,
    };

    // ---------------------------------------------
    // 6. Dashboard response
    // ---------------------------------------------
    return NextResponse.json({
      success: true,

      stats: {
        totalOrganisations,
        newTenders: latestJobRun?.newItemsFound ?? 0,
        notificationsSent:
          latestJobRun?.notificationsSent ??
          Number(notificationStats.sent ?? 0),
        lastRun: latestJobRun,
      },

      latestTenders,

      recentJobRuns,

      systemStatus: {
        database: {
          status: "Connected",
          healthy: true,
        },

        tenderPortal: {
          status: "Ready",
          healthy: true,
        },

        telegram: {
          status: "Pending",
          healthy: false,
        },

        captcha: {
          status: "Pending",
          healthy: false,
        },

        cron: {
          status: "15 min cycle",
          healthy: true,
        },
      },
    });
  } catch (error) {
    console.error("GET /api/dashboard failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to load dashboard data",
      },
      {
        status: 500,
      }
    );
  }
}