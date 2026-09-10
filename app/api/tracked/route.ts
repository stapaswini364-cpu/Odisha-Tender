import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trackedTenders } from "@/db/schema";

// GET: return all tracked tender IDs
export async function GET() {
  const rows = await db.select({ tenderId: trackedTenders.tenderId }).from(trackedTenders);
  return NextResponse.json({ tenderIds: rows.map((r) => r.tenderId) });
}

// POST: toggle tracked state for a tender { tenderId: string }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenderId } = body;

  if (!tenderId) {
    return NextResponse.json({ error: "tenderId is required" }, { status: 400 });
  }

  const existing = await db
    .select()
    .from(trackedTenders)
    .where(eq(trackedTenders.tenderId, tenderId))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(trackedTenders).where(eq(trackedTenders.tenderId, tenderId));
    return NextResponse.json({ tracked: false });
  } else {
    await db.insert(trackedTenders).values({ tenderId });
    return NextResponse.json({ tracked: true });
  }
}