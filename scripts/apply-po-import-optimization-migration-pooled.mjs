import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const migrationName = "20260818120000_optimize_po_import_upserts";
const migrationPath = join("prisma", "migrations", migrationName, "migration.sql");
const expectedColumns = [
  "poReportLineNumber",
  "poReportFlids",
  "poItemId",
  "poProductName",
  "poFulfillmentType",
  "poOrderStatus",
  "poOriginalQuantity",
  "poOriginalItemRevenue",
  "poShippingCost",
  "poTax",
  "poDiscount",
  "poOriginalFileName"
];
const uniqueIndexName = "SalesOrderItem_po_line_unique_idx";

loadEnvFile();

const prisma = new PrismaClient();

await main();

async function main() {
  try {
    await assertPrismaMigrationsTableExists();

    const migrationSql = readFileSync(migrationPath, "utf8");
    const checksum = createHash("sha256").update(migrationSql).digest("hex");
    const alreadyRecorded = await migrationRecordExists();
    const existingColumns = await getExistingColumns();
    const uniqueIndexExists = await indexExists(uniqueIndexName);

    if (alreadyRecorded) {
      console.log(`Migration ${migrationName} is already recorded.`);
      return;
    }

    if (existingColumns.length === expectedColumns.length && uniqueIndexExists) {
      await recordMigration(checksum);
      console.log(`PO import optimization already exists. Recorded ${migrationName}.`);
      return;
    }

    await prisma.$transaction(
      async (tx) => {
        await addColumns(tx);
        await assertNoDuplicatePoLines(tx);
        await addUniqueIndex(tx);
        await insertMigrationRecord(tx, checksum);
      },
      { maxWait: 10000, timeout: 60000 }
    );

    console.log(`Applied and recorded ${migrationName} through DATABASE_URL.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function assertPrismaMigrationsTableExists() {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT to_regclass(\'public."_prisma_migrations"\')::text AS table_name'
  );
  const tableName = rows?.[0]?.table_name;

  if (!tableName) {
    throw new Error(
      'Prisma migrations table was not found. Run the initial migrations before using this helper.'
    );
  }
}

async function migrationRecordExists() {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT 1 FROM public."_prisma_migrations" WHERE migration_name = $1 LIMIT 1',
    migrationName
  );

  return rows.length > 0;
}

async function getExistingColumns() {
  const quotedNames = expectedColumns.map((column) => `'${column.replaceAll("'", "''")}'`).join(", ");
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SalesOrderItem'
      AND column_name IN (${quotedNames})
    ORDER BY column_name
  `);

  return rows.map((row) => row.column_name);
}

async function indexExists(indexName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'SalesOrderItem'
       AND indexname = $1
     LIMIT 1`,
    indexName
  );

  return rows.length > 0;
}

async function addColumns(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "SalesOrderItem"
      ADD COLUMN IF NOT EXISTS "poReportLineNumber" TEXT,
      ADD COLUMN IF NOT EXISTS "poReportFlids" TEXT,
      ADD COLUMN IF NOT EXISTS "poItemId" TEXT,
      ADD COLUMN IF NOT EXISTS "poProductName" TEXT,
      ADD COLUMN IF NOT EXISTS "poFulfillmentType" TEXT,
      ADD COLUMN IF NOT EXISTS "poOrderStatus" TEXT,
      ADD COLUMN IF NOT EXISTS "poOriginalQuantity" INTEGER,
      ADD COLUMN IF NOT EXISTS "poOriginalItemRevenue" DECIMAL(14,4),
      ADD COLUMN IF NOT EXISTS "poShippingCost" DECIMAL(14,4),
      ADD COLUMN IF NOT EXISTS "poTax" DECIMAL(14,4),
      ADD COLUMN IF NOT EXISTS "poDiscount" DECIMAL(14,4),
      ADD COLUMN IF NOT EXISTS "poOriginalFileName" TEXT
  `);
}

async function assertNoDuplicatePoLines(client) {
  const rows = await client.$queryRawUnsafe(`
    SELECT "organizationId", "marketplace", "purchaseOrderNumber", "purchaseOrderLineNumber", COUNT(*)::int AS count
    FROM "SalesOrderItem"
    WHERE "purchaseOrderNumber" IS NOT NULL
      AND "purchaseOrderLineNumber" IS NOT NULL
    GROUP BY "organizationId", "marketplace", "purchaseOrderNumber", "purchaseOrderLineNumber"
    HAVING COUNT(*) > 1
    LIMIT 5
  `);

  if (rows.length) {
    throw new Error(
      `Cannot create SalesOrderItem PO unique index because duplicate PO lines already exist. First duplicate count: ${rows[0].count}. Run a PO duplicate cleanup before applying this migration.`
    );
  }
}

async function addUniqueIndex(client) {
  await client.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrderItem_po_line_unique_idx"
      ON "SalesOrderItem"("organizationId", "marketplace", "purchaseOrderNumber", "purchaseOrderLineNumber")
      WHERE "purchaseOrderNumber" IS NOT NULL
        AND "purchaseOrderLineNumber" IS NOT NULL
  `);
}

async function recordMigration(checksum) {
  await insertMigrationRecord(prisma, checksum);
}

async function insertMigrationRecord(client, checksum) {
  await client.$executeRawUnsafe(
    `INSERT INTO public."_prisma_migrations"
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     SELECT $1, $2, NOW(), $3, NULL, NULL, NOW(), 1
     WHERE NOT EXISTS (
       SELECT 1 FROM public."_prisma_migrations" WHERE migration_name = $3
     )`,
    randomUUID(),
    checksum,
    migrationName
  );
}

function loadEnvFile() {
  const envText = readFileSync(".env", "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
