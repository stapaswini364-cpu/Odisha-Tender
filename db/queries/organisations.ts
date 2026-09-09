import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organisations } from "@/db/schema";

export async function upsertOrganisations(
  items: {
    name: string;
    tenderCount: number;
  }[]
) {
  for (const item of items) {
    const name = item.name.trim();

    if (!name) continue;

    await db
      .insert(organisations)
      .values({
        name,
        lastKnownCount: item.tenderCount,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: organisations.name,
        set: {
          lastKnownCount: item.tenderCount,
          updatedAt: new Date(),
        },
      });
  }
}