import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and, or, ilike, SQL } from "drizzle-orm";
import { db } from "@/db";
import { organisations, tenders } from "@/db/schema";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const organisationId = searchParams.get("organisationId");
    const type = searchParams.get("type");
    const q = searchParams.get("q"); // free-text search
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Number(limitParam), 200) : 50;

    const conditions: SQL[] = [];

    if (organisationId) {
      conditions.push(eq(tenders.organisationId, organisationId));
    }

    if (type) {
      conditions.push(eq(tenders.type, type));
    }

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      // Search across title, reference number, and organisation name
      conditions.push(
        or(
          ilike(tenders.title, term),
          ilike(tenders.referenceNo, term),
          ilike(organisations.name, term)
        )!
      );
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
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(tenders.detectedAt))
      .limit(limit);

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