-- Generic import framework for reusable report previews, validation, history, and commits.

CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "importKind" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "reportTypeLabel" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "originalFileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateOfId" TEXT,
    "options" JSONB,
    "summary" JSONB,
    "parsedPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportRunIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRunIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportRunPreviewRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "rawData" JSONB,
    "normalizedData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRunPreviewRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportRun_organizationId_importKind_createdAt_idx" ON "ImportRun"("organizationId", "importKind", "createdAt");
CREATE INDEX "ImportRun_organizationId_marketplace_reportType_idx" ON "ImportRun"("organizationId", "marketplace", "reportType");
CREATE INDEX "ImportRun_organizationId_marketplace_importKind_reportType_fileHash_idx" ON "ImportRun"("organizationId", "marketplace", "importKind", "reportType", "fileHash");
CREATE INDEX "ImportRunIssue_organizationId_importRunId_idx" ON "ImportRunIssue"("organizationId", "importRunId");
CREATE INDEX "ImportRunPreviewRow_organizationId_importRunId_idx" ON "ImportRunPreviewRow"("organizationId", "importRunId");

ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportRunIssue" ADD CONSTRAINT "ImportRunIssue_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportRunPreviewRow" ADD CONSTRAINT "ImportRunPreviewRow_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
