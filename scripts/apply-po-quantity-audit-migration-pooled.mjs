import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const migrationName = "20260824120000_add_po_quantity_audit_fields";
const migrationPath = join("prisma", "migrations", migrationName, "migration.sql");
const expectedColumns = ["poCancelledQuantity", "poPriceSourceKind"];

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

    if (alreadyRecorded) {
      console.log(`Migration ${migrationName} is already recorded.`);
      return;
    }

    if (existingColumns.length === expectedColumns.length) {
      await recordMigration(checksum);
      console.log(`PO quantity audit fields already exist. Recorded ${migrationName}.`);
      return;
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(migrationSql);
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
