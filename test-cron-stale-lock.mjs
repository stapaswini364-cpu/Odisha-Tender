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

async function cleanupJobRun(jobRunId) {
  await sql`
    DELETE FROM job_runs
    WHERE id = ${jobRunId}
  `;
}

async function cleanupLock() {
  await sql`
    DELETE FROM cron_locks
    WHERE key = ${LOCK_KEY}
  `;
}

async function createStaleLock(jobRunId) {
  await sql`
    INSERT INTO cron_locks (
      key,
      locked_at,
      job_run_id
    )
    VALUES (
      ${LOCK_KEY},
      NOW() - INTERVAL '60 minutes',
      ${jobRunId}
    )
  `;
}

async function checkLock() {
  const result = await sql`
    SELECT
      key,
      locked_at,
      job_run_id
    FROM cron_locks
    WHERE key = ${LOCK_KEY}
  `;

  return result[0] ?? null;
}

async function reclaimStaleLock(jobRunId) {
  const staleBefore = new Date(
    Date.now() - 45 * 60 * 1000
  );

  const result = await sql`
    UPDATE cron_locks
    SET
      job_run_id = ${jobRunId},
      locked_at = NOW()
    WHERE
      key = ${LOCK_KEY}
      AND locked_at < ${staleBefore}
    RETURNING key, job_run_id, locked_at
  `;

  return result.length > 0;
}

try {
  console.log("=================================");
  console.log("STALE CRON LOCK TEST");
  console.log("=================================");

  /**
   * Create two real job runs.
   */
  const oldJobRun = await createJobRun();
  const newJobRun = await createJobRun();

  console.log("\n1. Creating stale lock...");

  await cleanupLock();

  await createStaleLock(oldJobRun);

  const staleLock = await checkLock();

  if (!staleLock) {
    throw new Error(
      "Stale lock was not created"
    );
  }

  console.log(
    "✅ Stale lock created successfully"
  );

  console.log(
    `   Locked at: ${staleLock.locked_at}`
  );

  console.log(
    `   Old job: ${staleLock.job_run_id}`
  );

  /**
   * Verify that the lock is actually older
   * than the 45-minute threshold.
   */
  console.log(
    "\n2. Checking stale lock age..."
  );

  const lockAgeMs =
    Date.now() -
    new Date(
      staleLock.locked_at
    ).getTime();

  const lockAgeMinutes =
    lockAgeMs / 1000 / 60;

  console.log(
    `   Lock age: ${lockAgeMinutes.toFixed(2)} minutes`
  );

  if (lockAgeMinutes < 45) {
    throw new Error(
      "Lock is not old enough for stale recovery test"
    );
  }

  console.log(
    "✅ Lock is older than 45 minutes"
  );

  /**
   * Try reclaiming stale lock.
   */
  console.log(
    "\n3. New job trying to reclaim stale lock..."
  );

  const reclaimed =
    await reclaimStaleLock(
      newJobRun
    );

  if (!reclaimed) {
    throw new Error(
      "Stale lock could NOT be reclaimed"
    );
  }

  console.log(
    "✅ Stale lock successfully reclaimed"
  );

  /**
   * Verify ownership changed.
   */
  console.log(
    "\n4. Verifying new job owns the lock..."
  );

  const currentLock =
    await checkLock();

  if (!currentLock) {
    throw new Error(
      "Lock disappeared after reclaim"
    );
  }

  if (
    currentLock.job_run_id !==
    newJobRun
  ) {
    throw new Error(
      "Lock ownership was not transferred to new job"
    );
  }

  console.log(
    "✅ New job correctly owns the lock"
  );

  /**
   * Verify timestamp was refreshed.
   */
  const newLockAgeMs =
    Date.now() -
    new Date(
      currentLock.locked_at
    ).getTime();

  const newLockAgeMinutes =
    newLockAgeMs / 1000 / 60;

  console.log(
    `   New lock age: ${newLockAgeMinutes.toFixed(2)} minutes`
  );

  if (newLockAgeMinutes >= 1) {
    throw new Error(
      "Lock timestamp was not refreshed"
    );
  }

  console.log(
    "✅ Lock timestamp refreshed"
  );

  /**
   * Cleanup.
   */
  console.log(
    "\n5. Cleaning up test data..."
  );

  await cleanupLock();

  await cleanupJobRun(
    oldJobRun
  );

  await cleanupJobRun(
    newJobRun
  );

  console.log(
    "✅ Test data cleaned up"
  );

  console.log(
    "\n================================="
  );

  console.log(
    "STALE CRON LOCK TEST COMPLETED"
  );

  console.log(
    "================================="
  );
} catch (error) {
  console.error(
    "\n❌ STALE CRON LOCK TEST FAILED"
  );

  console.error(error);

  process.exitCode = 1;
} finally {
  /**
   * Safety cleanup.
   */
  try {
    await cleanupLock();
  } catch {}

  await sql.end();
}