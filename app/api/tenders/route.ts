import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations, tenders } from "@/db/schema";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const organisationId = searchParams.get("organisationId");
    const type = searchParams.get("type");

    const conditions = [];

    if (organisationId) {
      conditions.push(eq(tenders.organisationId, organisationId));
    }

    if (type) {
      conditions.push(eq(tenders.type, type));
    }

    const result = await db
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
      .where(conditions.length ? conditions[0] : undefined)
      .orderBy(desc(tenders.detectedAt));

    return NextResponse.json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("GET /api/tenders failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch tenders",
      },
      { status: 500 }
    );
  }
}