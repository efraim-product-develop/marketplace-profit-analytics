import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnvFile();

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE IF EXISTS public."_prisma_migrations" ENABLE ROW LEVEL SECURITY'
  );
  console.log("Enabled RLS on public._prisma_migrations.");
} finally {
  await prisma.$disconnect();
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
