import "dotenv/config";

import { desc } from "drizzle-orm";
import { db } from "./db";
import { tenders } from "./db/schema";

async function main() {
  const rows = await db
    .select({
      id: tenders.id,
      externalKey: tenders.externalKey,
      referenceNo: tenders.referenceNo,
      title: tenders.title,
      detectedAt: tenders.detectedAt,
    })
    .from(tenders)
    .orderBy(desc(tenders.detectedAt))
    .limit(20);

  console.log("========================================");
  console.log("DATABASE TENDER CHECK");
  console.log("========================================");

  console.log(`Total rows shown: ${rows.length}\n`);

  rows.forEach((row, index) => {
    console.log(`${index + 1}.`);
    console.log(`ID          : ${row.id}`);
    console.log(`External Key: ${row.externalKey}`);
    console.log(`Reference   : ${row.referenceNo}`);
    console.log(`Title       : ${row.title}`);
    console.log(`Detected At : ${row.detectedAt}`);
    console.log("----------------------------------------");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});