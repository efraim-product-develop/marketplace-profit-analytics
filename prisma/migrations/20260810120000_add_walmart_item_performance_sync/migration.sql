CREATE TABLE "ConnectorReportRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "reportVersion" TEXT NOT NULL,
    "granularity" TEXT NOT NULL,
    "overallStartDate" TIMESTAMP(3) NOT NULL,
    "overallEndDate" TIMESTAMP(3) NOT NULL,
    "chunkStartDate" TIMESTAMP(3) NOT NULL,
    "chunkEndDate" TIMESTAMP(3) NOT NULL,
    "externalRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "requestedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "unmappedSkuCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorReportRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceDailySalesCoverage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "coverageDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MISSING',
    "connectorReportRequestId" TEXT,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "unmappedSkuCount" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceDailySalesCoverage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectorReportRequest_organizationId_marketplace_connector_externalRequestId_key" ON "ConnectorReportRequest"("organizationId", "marketplace", "connector", "externalRequestId");
CREATE INDEX "ConnectorReportRequest_organizationId_marketplace_connector_status_idx" ON "ConnectorReportRequest"("organizationId", "marketplace", "connector", "status");
CREATE INDEX "ConnectorReportRequest_organizationId_marketplace_source_chunkStartDate_chunkEndDate_idx" ON "ConnectorReportRequest"("organizationId", "marketplace", "source", "chunkStartDate", "chunkEndDate");

CREATE UNIQUE INDEX "mdsc_org_market_source_date_key" ON "MarketplaceDailySalesCoverage"("organizationId", "marketplace", "source", "coverageDate");
CREATE INDEX "mdsc_org_market_source_status_idx" ON "MarketplaceDailySalesCoverage"("organizationId", "marketplace", "source", "status");
CREATE INDEX "mdsc_org_market_source_date_idx" ON "MarketplaceDailySalesCoverage"("organizationId", "marketplace", "source", "coverageDate");
CREATE INDEX "mdsc_org_report_request_idx" ON "MarketplaceDailySalesCoverage"("organizationId", "connectorReportRequestId");

ALTER TABLE "ConnectorReportRequest" ADD CONSTRAINT "ConnectorReportRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceDailySalesCoverage" ADD CONSTRAINT "MarketplaceDailySalesCoverage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceDailySalesCoverage" ADD CONSTRAINT "MarketplaceDailySalesCoverage_connectorReportRequestId_fkey" FOREIGN KEY ("connectorReportRequestId") REFERENCES "ConnectorReportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
