import { NextResponse } from "next/server";
import { asc, desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { organisations, tenders } from "@/db/schema";

export async function GET() {
  try {
    const result = await db
      .select({
        id: organisations.id,
        name: organisations.name,
        lastKnownCount: organisations.lastKnownCount,
        createdAt: organisations.createdAt,
        updatedAt: organisations.updatedAt,
        tenderCount: sql<number>`count(${tenders.id})`,
      })
      .from(organisations)
      .leftJoin(
        tenders,
        sql`${tenders.organisationId} = ${organisations.id}`
      )
      .groupBy(
        organisations.id,
        organisations.name,
        organisations.lastKnownCount,
        organisations.createdAt,
        organisations.updatedAt
      )
      .orderBy(asc(organisations.name));

    return NextResponse.json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("GET /api/organisations failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch organisations",
      },
      { status: 500 }
    );
  }
}