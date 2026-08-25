CREATE TABLE "SettlementPayout" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importRunId" TEXT,
  "marketplace" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'settlement_report',
  "settlementReference" TEXT NOT NULL,
  "settlementPeriodStart" TIMESTAMP(3),
  "settlementPeriodEnd" TIMESTAMP(3),
  "payoutAmount" DECIMAL(14,4) NOT NULL,
  "payoutDate" TIMESTAMP(3),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "originalFileName" TEXT,
  "metadata" JSONB,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SettlementPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementPayout_organizationId_marketplace_settlementReference_key"
  ON "SettlementPayout"("organizationId", "marketplace", "settlementReference");

CREATE INDEX "SettlementPayout_organizationId_marketplace_settlementPeriodEnd_idx"
  ON "SettlementPayout"("organizationId", "marketplace", "settlementPeriodEnd");

CREATE INDEX "SettlementPayout_organizationId_marketplace_payoutDate_idx"
  ON "SettlementPayout"("organizationId", "marketplace", "payoutDate");

CREATE INDEX "SettlementPayout_organizationId_importRunId_idx"
  ON "SettlementPayout"("organizationId", "importRunId");

ALTER TABLE "SettlementPayout"
  ADD CONSTRAINT "SettlementPayout_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "SettlementPayout"
  ADD CONSTRAINT "SettlementPayout_importRunId_fkey"
  FOREIGN KEY ("importRunId")
  REFERENCES "ImportRun"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
