import postgres from "postgres";
import crypto from "node:crypto";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const sql = postgres(connectionString, {
  prepare: false,
});

const LOCK_KEY = "check-tenders";

async function createJobRun() {
  const id = crypto.randomUUID();

  await sql`
    INSERT INTO job_runs (
      id,
      status,
      started_at
    )
    VALUES (
      ${id},
      'running',
      NOW()
    )
  `;

  return id;
}

async function acquireLock(jobRunId) {
  const result = await sql`
    INSERT INTO cron_locks (
      key,
      locked_at,
      job_run_id
    )
    VALUES (
      ${LOCK_KEY},
      NOW(),
      ${jobRunId}
    )
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `;

  return result.length > 0;
}

async function releaseLock(jobRunId) {
  const result = await sql`
    DELETE FROM cron_locks
    WHERE key = ${LOCK_KEY}
      AND job_run_id = ${jobRunId}
    RETURNING key
  `;

  return result.length > 0;
}

async function cleanupJobRun(jobRunId) {
  await sql`
    DELETE FROM job_runs
    WHERE id = ${jobRunId}
  `;
}

try {
  console.log("=================================");
  console.log("CRON LOCK TEST");
  console.log("=================================");

  // Create real job_runs rows
  const jobRun1 = await createJobRun();
  const jobRun2 = await createJobRun();

  console.log("\n1. First job trying to acquire lock...");

  const firstLock = await acquireLock(jobRun1);

  console.log(
    firstLock
      ? "✅ First job acquired lock"
      : "❌ First job could NOT acquire lock"
  );

  console.log("\n2. Second job trying to acquire same lock...");

  const secondLock = await acquireLock(jobRun2);

  console.log(
    secondLock
      ? "❌ TEST FAILED: Second job also acquired lock"
      : "✅ Second job correctly blocked"
  );

  console.log("\n3. First job releasing lock...");

  const released = await releaseLock(jobRun1);

  console.log(
    released
      ? "✅ First job released lock"
      : "❌ Lock release failed"
  );

  console.log("\n4. Second job trying again...");

  const secondLockAfterRelease = await acquireLock(jobRun2);

  console.log(
    secondLockAfterRelease
      ? "✅ Second job acquired lock after release"
      : "❌ Second job could NOT acquire lock"
  );

  console.log("\n5. Cleaning up...");

  await releaseLock(jobRun2);

  await cleanupJobRun(jobRun1);
  await cleanupJobRun(jobRun2);

  console.log("✅ Test data cleaned up");

  console.log("\n=================================");
  console.log("CRON LOCK TEST COMPLETED");
  console.log("=================================");
} catch (error) {
  console.error("\n❌ CRON LOCK TEST FAILED");
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end();
}