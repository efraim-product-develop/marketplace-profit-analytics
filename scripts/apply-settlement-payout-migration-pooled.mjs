import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const migrationName = "20260817120000_add_settlement_payouts";
const migrationPath = join("prisma", "migrations", migrationName, "migration.sql");
const expectedTables = ["SettlementPayout"];

loadEnvFile();

const prisma = new PrismaClient();

await main();

async function main() {
  try {
    await assertPrismaMigrationsTableExists();

    const alreadyRecorded = await migrationRecordExists();
    const existingTables = await getExistingTables();

    if (alreadyRecorded) {
      console.log(`Migration ${migrationName} is already recorded.`);
      return;
    }

    const migrationSql = readFileSync(migrationPath, "utf8");
    const checksum = createHash("sha256").update(migrationSql).digest("hex");

    if (existingTables.length === expectedTables.length) {
      await recordMigration(checksum);
      console.log(`Settlement payout table already exists. Recorded ${migrationName}.`);
      return;
    }

    const statements = migrationSql
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    await prisma.$transaction(
      async (tx) => {
        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement);
        }

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

async function getExistingTables() {
  const quotedNames = expectedTables.map((table) => `'${table.replaceAll("'", "''")}'`).join(", ");
  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${quotedNames})
    ORDER BY table_name
  `);

  return rows.map((row) => row.table_name);
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
