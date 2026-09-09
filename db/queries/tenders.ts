import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organisations, tenders } from "@/db/schema";

type TenderInput = {
  organisationName: string;
  title: string;
  referenceNo: string | null;
  externalKey: string;
  type: "tender" | "corrigendum";
  sourceUrl: string;
  publishedAt: Date | null;
};

export async function upsertTenders(items: TenderInput[]) {
  if (items.length === 0) {
    return {
      inserted: 0,
      skipped: 0,
    };
  }

  const organisationName = items[0].organisationName.trim();

  // Find organisation only ONCE
  const organisation = await db
    .select({
      id: organisations.id,
    })
    .from(organisations)
    .where(eq(organisations.name, organisationName))
    .limit(1);

  if (organisation.length === 0) {
    throw new Error(
      `Organisation not found: ${organisationName}`
    );
  }

  const organisationId = organisation[0].id;

  const values = items.map((item) => ({
    organisationId,
    externalKey: item.externalKey,
    title: item.title,
    referenceNo: item.referenceNo,
    type: item.type,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    detectedAt: new Date(),
    notificationStatus: "pending",
  }));

  // One bulk INSERT + PostgreSQL unique conflict handling
  const insertedRows = await db
    .insert(tenders)
    .values(values)
    .onConflictDoNothing({
      target: tenders.externalKey,
    })
    .returning({
      id: tenders.id,
    });

  const inserted = insertedRows.length;
  const skipped = items.length - inserted;

  return {
    inserted,
    skipped,
  };
}