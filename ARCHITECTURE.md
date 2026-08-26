# Architecture

This document is the technical source of truth for the current app structure. Read it before implementing future features.

## Tech Stack

- Next.js 14 App Router
- TypeScript
- React 18
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- TanStack Table
- `xlsx` for Excel and CSV-style workbook parsing
- Supabase-compatible Postgres for hosted local-development data
- Visual Studio Code workspace configuration for local development

## Folder Structure

```text
.vscode/                     Local editor settings, tasks, extension recommendations, and debug profiles
src/
  app/
    ad-spend/upload/         Direct Walmart Connect advertising upload with preview and commit
    advertising/upload/      Legacy ad spend upload page
    cogs/audit/              COGS history and audit tables
    cogs/upload/             COGS upload, preview, and import flow
    connections/             Local marketplace connection CRUD
    imports/                 Generic import framework UI
      _components/           Shared import upload/detail components
      sales/                 Generic sales import pages
      settlements/           Generic settlement import pages
      advertising/           Generic advertising import pages
      inventory/             Generic inventory import pages
    pnl/
      parent/                Parent P&L dashboard, monthly comparison, export, and expandable table
      sku/                   SKU P&L filters, table, CSV export, source indicators, and order drill-down
    settings/                Local organization settings CRUD
  components/                Shared UI components
  lib/                       Shared utilities and client-side import helpers
  server/
    advertising/             Generic advertising parser
    cogs/                    COGS queries, generic parser, and effective COGS service
    connections/             Connection queries
    connectors/              Marketplace connector registry and implementations
      walmart/               Walmart-specific report parsing, product mapping, API client, and connector metadata
    imports/                 Generic import framework and committers
    marketplaces/            Current marketplace context helpers
    organizations/           Current organization resolver
    pnl/                     Marketplace-neutral P&L engine and data queries
    sales/                   Generic sales parser
    settings/                Settings queries
prisma/
  schema.prisma              Database schema
  migrations/                Prisma migration history
scripts/                     Local maintenance, Supabase, and seed helpers
```

## Local Development Tooling

The project includes VS Code workspace files:

- `.vscode/settings.json`: formatting, ESLint, TypeScript, Tailwind, Prisma, terminal, and generated-folder visibility settings.
- `.vscode/extensions.json`: recommended extensions for Prisma, ESLint, Prettier, Tailwind CSS, Error Lens, and GitLens.
- `.vscode/tasks.json`: reusable tasks for dev server, typecheck, lint, formatting, Prisma validation/generation, Prisma Studio, and build.
- `.vscode/launch.json`: debug profiles for server-side, client-side, and full-stack Next.js debugging.

Formatting is handled by Prettier. Linting uses Next.js ESLint configuration. Prisma schema validation is available through `pnpm run prisma:validate`.

## Global Marketplace Context

The app has one global marketplace selector in the top-right app header.

Rules:

- The selected marketplace is stored in a browser cookie and is remembered across navigation and refreshes.
- Server-rendered pages read the selected marketplace through `src/server/marketplaces/current.ts`.
- Client UI uses the same marketplace list and cookie name from `src/lib/marketplace-context.ts`.
- Pages should not add their own marketplace selectors.
- Upload pages should display the active marketplace in titles and labels.
- Queries, imports, exports, COGS audit, P&L pages, and audit pages should scope to the active marketplace when their data is marketplace-specific.
- Organization selection is intentionally not part of this UI. Each organization has its own login/account, so do not add an organization dropdown.
- The marketplace context is UI/application context only; marketplace identity is still stored as data on marketplace records.

## Database Architecture

The Prisma schema is designed around generic marketplace commerce concepts rather than Walmart-only concepts.

Core models:

- `Organization`: tenant/workspace boundary. Today there is one local organization.
- `OrganizationSettings`: default currency, time zone, default marketplace, inventory cost method.
- `MarketplaceConnection`: local record for marketplace connection metadata.
- `Product`: internal product/SKU entity. Parent products and SKU products are represented here.
- `Listing`: marketplace-specific seller SKU record linked to a product.
- `CostUpload`: COGS upload history.
- `CostUploadIssue`: row-level COGS upload issues.
- `CogsBatch`: shipment/batch grouping for cost records.
- `CostRecord`: effective-dated SKU cost record.
- `SalesImport`: committed sales import history used by current order tables.
- `SalesImportIssue`: row-level sales import issues.
- `ImportRun`: generic import preview/history record for the new import framework.
- `ImportRunIssue`: generic row-level import issue.
- `ImportRunPreviewRow`: generic preview rows shown before commit.
- `ConnectorReportRequest`: generic connector report-request chunk history retained for future API-driven report syncs.
- `MarketplaceDailySalesCoverage`: daily sales coverage status by marketplace/source/date, retained for future coverage checks.
- `SalesOrder`: marketplace order record. Walmart PO rows provide sales, order dates, order counts, units, SKU, product, and fulfillment context.
- `SalesOrderItem`: marketplace order line. Walmart PO identifiers and PO audit fields are stored directly on the line for duplicate-safe imports and audit.
- `MarketplaceFee`: normalized fees attached to an order or order item.
- `Refund`: normalized refund sales attached to an order, order item, or standalone settlement row.
- `AdvertisingCost`: normalized ad spend rows.
- `SettlementPayout`: normalized settlement cash-flow/payable records. These are shown separately from Profit.
- `MarketplaceDailyTotal`: legacy account-level daily totals table. Account-summary reconciliation is no longer an active workflow.

Important uniqueness and indexing rules:

- `Product`: unique by `organizationId + internalSku`.
- `Listing`: unique by `organizationId + marketplace + sellerSku`.
- `CogsBatch`: unique by `organizationId + marketplace + shipmentId`.
- `CostRecord`: unique by `organizationId + marketplace + sellerSku + shipmentId + effectiveDate`.
- `SalesOrder`: unique by `organizationId + marketplace + externalOrderId`.
- `SalesOrderItem`: indexed by `organizationId + marketplace + purchaseOrderNumber`, plus a database-level partial unique index on `organizationId + marketplace + purchaseOrderNumber + purchaseOrderLineNumber` for duplicate-safe Walmart PO line imports.
- `SettlementPayout`: unique by `organizationId + marketplace + settlementReference`.
- `MarketplaceDailyTotal`: unique by `organizationId + marketplace + reportType + totalDate` if legacy daily-total rows exist.
- Direct sales upload replaces matching order lines by `organizationId + marketplace + externalOrderId + sellerSku`.
- `ImportRun`: duplicate detection is based on `organizationId + marketplace + importKind + reportType + fileHash` for previously imported or review-needed imports.
- `ConnectorReportRequest`: retained for future connector report requests, with Walmart experimental request chunks treated as obsolete unless explicitly reactivated.
- `MarketplaceDailySalesCoverage`: unique by `organizationId + marketplace + source + coverageDate`.

All current application queries and writes are scoped through `organizationId`, using `getCurrentOrganization()` or `getCurrentOrganizationId()`. Standalone scripts are exceptions and should be reviewed before use.

## Marketplace-Neutral Design

The core P&L engine must not know about Walmart report formats, Walmart column names, or Walmart-specific business rules.

Marketplace-neutral rules:

- Store marketplace identity as data, for example `marketplace = "walmart"`.
- Normalize external reports into generic entities: listings, orders, order items, fees, costs, advertising costs.
- Keep marketplace parsing in `src/server/connectors/<marketplace>`.
- Keep P&L math in `src/server/pnl`.
- Keep generic import orchestration in `src/server/imports`.
- Add new marketplaces by registering connectors, not by branching inside the P&L engine.

## Walmart Connector Architecture

Walmart-specific code lives in:

```text
src/server/connectors/walmart/
  index.ts
  item-sales-mapping.ts
  api-client.ts
  po-reports.ts
  retry.ts
  settlements.ts
```

`index.ts` registers the Walmart connector and exposes:

- marketplace code: `walmart`
- display name: `Walmart Seller Center`
- capabilities
- COGS parser alias configuration
- Walmart PO sales parser
- generic import parsers
- API connection capability metadata

`po-reports.ts` contains the active Walmart PO parser and committer for order-date sales.

`item-sales-mapping.ts` contains the mapping-only Walmart Item Sales parser and committer for SKU-to-parent hierarchy. It writes catalog metadata to `Product` and `Listing`, but it does not write sales orders, fees, refunds, daily totals, or P&L values.

`settlements.ts` contains the active Walmart Payments New parser and committer for refunds, commission, fulfillment fees, other fees and adjustments, and settlement payout tracking.

Current Walmart sales architecture:

- PO reports are the Walmart sales source of truth for P&L.
- Walmart Item Sales reports are allowed only as the authoritative Walmart product hierarchy source for SKU-to-parent mapping.
- Item Sales financial columns such as GMV, orders, units, auth sales, cancelled sales, refund sales, GMV minus commission, and AUR are ignored.
- PO imports create or update `SalesOrder` / `SalesOrderItem` rows using the true Walmart PO order date.
- PO rows provide sales, order date, units, orders, SKU, product, fulfillment type, and day/week/month/quarter/year/custom sales reporting.
- PO duplicate identity is `organizationId + marketplace + purchaseOrderNumber + purchaseOrderLineNumber`, represented as `SalesOrder.externalOrderId = PO#` and `SalesOrderItem.externalLineId = Line#`, with explicit PO/customer-order fields also stored on `SalesOrderItem`.
- PO customer order, item, fulfillment, raw Walmart status, shipping, tax, discount, original quantity, and original item revenue values are preserved directly on `SalesOrderItem` for audit.
- PO Gross Sales uses a shared helper: unit-level price fields such as `Item Cost`, `Item Price`, `Unit Price`, or `Price` are multiplied by active quantity; extended line amount fields such as `Gross Sales`, `Item Revenue`, `Sales`, `PO GMV`, or `GMV` are used as the line amount without multiplying again.
- Cancelled PO rows are preserved as zero-sales order-line updates. They update any previously imported copy of the same PO line and are excluded from P&L through the shared PO sales-source rule.
- Walmart Payments settlement reports are a separate financial source for refunds, marketplace commission, fulfillment fees, other Walmart fees and adjustments, and payout.
- Settlement commission and WFS fulfillment fee rows link directly to PO order lines only when `Purchase Order # + Purchase Order line #` matches exactly one existing `SalesOrderItem`.
- Settlement commission and WFS fulfillment fee rows that cannot be matched exactly remain marketplace-level rows and use `Transaction Posted Timestamp` as their P&L reporting day.
- Settlement sale/product rows are not imported as sales and do not supersede PO rows.
- There is no PO-to-settlement sales finalizer, no ambiguous settlement match queue, and no unmatched settlement sale review workflow.
- Competing Walmart sales-summary/account-summary reports and monthly summary fallbacks are not active P&L sales sources. Item Sales exists only for catalog mapping.
- Do not double-count sales: PO is the only Walmart sales dataset used by P&L.

The retired Walmart sales summary parser, account-summary workflow, and experimental daily sales sync route have been removed from the active codebase.

`api-client.ts` handles Walmart Marketplace API credential readiness, token testing, and server-side authorized API headers:

- reads credentials from local environment variables
- requests a short-lived Walmart token with the client credentials flow
- keeps real secrets out of the database
- exposes credential-readiness and token-test helpers for `/connections`

Current API behavior:

- `/connections` can test Walmart API credentials and save connection status in `MarketplaceConnection`.
- The abandoned Walmart daily sales sync UI, queue, polling, report download, coverage tracking, and sync-specific tests have been removed.
- Do not reintroduce daily sales report sync paths for P&L unless the roadmap explicitly approves a new PO/order-based API design.
- Future API work should target PO/order-style sales data for the sales layer and Walmart settlement data for the financial layer, keeping the two sources separate.

Walmart account-summary files are no longer supported by the sales import workflow.

Adding a new Walmart report should usually require:

1. Add a parser function in `src/server/connectors/walmart`.
2. Add a matching `ImportReportParser` entry with `detect`, `parse`, and optional `commit`.
3. Reuse an existing generic committer when possible.
4. Avoid changing `/imports` UI unless the generic import framework itself needs a new capability.

## Generic Import Framework

The import framework lives under `src/server/imports`.

Key files:

- `types.ts`: parser, preview, issue, and commit contracts.
- `framework.ts`: detection, preview creation, duplicate detection, commit dispatch, import kind configuration.
- `queries.ts`: import history/detail queries.
- `db.ts`: typed wrapper for generic import tables, used because local Prisma generation can be blocked by Windows sandbox permissions.
- `utils.ts`: JSON and type conversion helpers.
- `committers/sales.ts`: reusable sales committer.

UI lives under `src/app/imports`.

Import flow:

1. User uploads a file to `/imports/<kind>`.
2. Framework computes a file hash.
3. Framework asks the selected marketplace connector for matching parsers.
4. Best parser detects and parses the report.
5. Framework writes an `ImportRun`, preview rows, issues, summary, and normalized payload.
6. User reviews the import detail page.
7. User clicks Import.
8. Framework checks duplicates again.
9. If the parser has a committer, the payload is committed to application tables.
10. Framework updates import status and imported count.

Current import kinds:

- `sales`
- `settlements`
- `advertising`
- `inventory`

Only sales currently has Walmart committers. Sales import commits can write generic orders, order lines, fees, products/listings, and refund sales. Settlement imports can also write standalone refund rows for audit when the marketplace report provides product-price refund rows. Other import kinds are scaffolded for future parsers.

## Effective COGS Design

COGS is modeled as effective-dated cost records.

COGS upload required fields:

- SKU
- effective date
- unit COGS

Optional COGS fields:

- parent SKU
- product name
- variation name
- shipment ID
- inbound freight per unit
- prep cost per unit
- packaging cost per unit
- notes

COGS import behavior:

- Validates required fields and numeric cost fields.
- Previews rows before import.
- Rejects duplicate rows inside the uploaded workbook for the same `sku + effective_date`.
- Creates or updates parent product records when parent SKU context is provided.
- Creates or updates SKU product records.
- Creates or updates marketplace listings.
- Creates or updates COGS batches. If no shipment ID is provided, the importer creates a deterministic `manual-cogs-YYYY-MM-DD` batch.
- Upserts `CostRecord` using `organizationId + marketplace + sellerSku + shipmentId + effectiveDate`.
- Stores row-level issues in `CostUploadIssue`.
- Exports current active COGS as a three-column workbook: `sku`, `effective_date`, and `unit_cogs`.

P&L cost assignment:

- `src/server/cogs/effective-cogs.ts` contains `EffectiveCogsService`, the reusable historical COGS assignment service.
- P&L loads active `CostRecord` rows once, ordered by newest effective date, and passes them into `EffectiveCogsService`.
- For each order item, the selected cost is the newest active cost for matching `marketplace + sellerSku` with `effectiveDate <= orderDate`.
- `getEffectiveCogsForSku(...)` resolves one SKU/order date from preloaded cost records.
- `getEffectiveCogsForOrderLines(...)` resolves a batch of order lines without one database query per line.
- If no effective COGS exists and the order item has no line-level COGS, the line is flagged as missing COGS.

Current limitation:

- `OrganizationSettings.inventoryCostMethod` includes `WEIGHTED_AVERAGE`, but the P&L query currently uses latest effective date matching.

## P&L Engine Architecture

P&L engine files:

```text
src/server/pnl/
  types.ts
  engine.ts
  queries.ts
  daily-service.ts
  calendar-dates.ts
  settlement-period-allocator.ts
```

`types.ts` defines generic P&L inputs and outputs.

`engine.ts` is pure business logic:

- groups rows by seller SKU or parent SKU
- sums revenue, discounts, refunds, tax, fee categories, COGS, and advertising costs
- treats `po_report` lines as the Walmart sales source
- applies settlement refunds and fees as separate financial inputs
- calculates the pre-ad internal profit subtotal as `Sales / GMV - all fee categories - COGS`
- calculates product Profit as that subtotal minus advertising cost
- calculates Profit Margin % and Profit / Unit from product Profit
- keeps older internal field names such as `grossProfit`, `netProfit`, and `contributionProfit` for compatibility, but the UI labels the after-ad-spend value as Profit
- flags missing COGS units and lines

`queries.ts` is data access and mapping:

- loads organization-scoped sales order items
- joins order, item-level fee, and refund data
- allocates order-level fees and refunds across order lines without per-row database lookups
- loads standalone marketplace fee rows and settlement refunds as financial adjustments
- resolves current parent SKU relationships from the catalog so later Item Sales mapping imports can improve Parent P&L grouping without rewriting historical PO transactions
- filters new settlement-derived refunds, order-line fee rows, unmatched settlement fee rows, and Seller Center SEM rows by `Transaction Posted Timestamp`
- assigns effective COGS through `EffectiveCogsService`
- loads ad spend
- filters parent P&L by date range and parent SKU
- filters SKU P&L by date range, parent SKU, brand, department, and the active global marketplace
- filters parent P&L, import history, COGS audit, and exports by the active global marketplace where applicable
- creates day/week/month/quarter period tiles
- creates Parent P&L monthly comparison rows and selected-SKU order drill-down rows for the UI
- uses PO report sales lines as the only supported Walmart sales source for day, week, month, quarter, year, and custom P&L
- applies the shared PO sales-source rule from `server/sales/po-sales-source.ts`, including cancellation exclusion
- ignores obsolete competing sales-summary/account-summary, monthly summary, and fallback rows for dashboard sales
- keeps standalone settlement-style fee adjustments available as independent profit adjustments
- calculates Parent and SKU product rows from only deterministically attributable components, while marketplace-only costs remain outside product rollups

`daily-service.ts` is the shared daily-grain reporting path for day, week, and partial custom ranges:

- uses only supported PO report rows for sales and never uses retired sales-summary/account-summary, settlement sale rows, or monthly summary rows as dashboard sales
- reports expected dates, imported dates, missing dates, and `coverageComplete` for each selected P&L range
- uses effective COGS already assigned to each order line by actual order date
- includes only daily-capable Walmart Connect advertising rows
- excludes monthly/cumulative Walmart Connect rows from daily-grain views and reports a `Missing daily ads` data-quality status
- filters settlement-derived refunds, matched/order-line fees, unmatched standalone settlement fees, and Seller Center SEM by transaction posted date
- supports Seller Center SEM modes so product-level Parent/SKU rows exclude un-attributable SEM
- returns compact data-quality labels and a temporary diagnostic payload explaining included sales, COGS, settlement allocation, SEM, and Walmart Connect values

`product-attribution.ts` defines the product-level attribution boundary:

- Refunds are included in SKU/Parent P&L only when the settlement row has a seller SKU plus product attribution metadata marked reliable.
- Marketplace Commission and Fulfillment Fees are included in SKU/Parent P&L only when the settlement row is linked to an exact PO order line.
- Unmatched Marketplace Commission and Fulfillment Fees remain in overall Marketplace P&L but are excluded from SKU/Parent product Profit.
- Other Walmart Fees & Adjustments remain marketplace-level by default, even when metadata is preserved for audit.
- Seller Center SEM remains marketplace-level when settlement rows have no reliable SKU or item attribution.
- Walmart Connect Advertising is included in SKU/Parent P&L only when the daily ad row has reliable SKU/item attribution.
- Parent P&L is the sum of child SKU product rows; it does not independently redistribute marketplace totals.

`calendar-dates.ts` documents the current P&L business-day convention:

- UTC calendar dates are used consistently for selected ranges, orders, ads, settlements, and custom range filtering.
- Selected start and end dates are inclusive.
- Date-only parsing avoids accidental previous-day or next-day shifts.

`settlement-period-allocator.ts` is marketplace-neutral reporting logic:

- Applies only to older normalized settlement-derived `MarketplaceFee` rows and settlement-derived SEM `AdvertisingCost` rows that do not have posted-date authority metadata.
- Uses settlement metadata period dates, such as `periodStartDate` and `periodEndDate`, when they exist.
- Allocates exact cents across inclusive calendar days and assigns rounding remainders deterministically to the earliest days.
- Uses posting date only as a fallback when settlement period metadata is missing or invalid.
- Does not invent a default 14-day period.
- Does not change stored settlement rows, COGS, Walmart Connect advertising, or organization logic.

Current product profitability labels:

- `Gross Sales` means valid PO sales before settlement refunds. Cancelled PO lines are excluded from Gross Sales.
- `Refunds` means product-price refunds from Walmart settlement reports. Cancelled PO lines do not create refunds.
- `Sales = Gross Sales - Refunds`.
- Overall Marketplace P&L uses `Profit = Sales - COGS - Marketplace Commission - Fulfillment Fees - Seller Center SEM Advertising - Walmart Connect Advertising - Other Walmart Fees & Adjustments`, with settlement credits/reimbursements increasing Profit through signed fee normalization. Refunds are not subtracted again because they are already included in Sales.
- SKU/Parent product P&L uses `Product Profit = Product Sales - historical COGS - attributable marketplace commission - attributable fulfillment fees - attributable Walmart Connect Advertising`, where `Product Sales = Product Gross Sales - reliably attributable settlement refunds`.
- SKU/Parent product P&L does not subtract Seller Center SEM, unallocated refunds, unallocated commission, unallocated fulfillment fees, unallocated Walmart Connect rows, Other Walmart Fees & Adjustments, or Settlement Payout.
- UI uses `Profit Margin % = Profit / Sales`.
- Marketplace Commission and Fulfillment Fees are displayed separately when fee category data is available.
- Additional fee categories such as shipping, storage, returns, adjustments, and other fees remain modeled internally and can be surfaced as a compact settlement-fee breakdown.
- Overall Marketplace P&L can display Walmart Connect Advertising and Seller Center SEM separately. SKU/Parent product P&L displays only SKU-attributed Walmart Connect Advertising.
- Seller Center SEM comes from Walmart Payments New settlement rows with `SEM Marketing Fee` amount type and is stored in `AdvertisingCost` with `source = "walmart_seller_center_sem"`.
- Seller Center SEM is included in overall marketplace P&L only and is not allocated into Parent P&L or SKU P&L rows unless a future source provides reliable SKU or parent attribution.
- Walmart Connect P&L uses daily advertising rows only; older monthly/cumulative Walmart Connect rows are ignored to avoid overstating ad spend.
- Settlement Payout is displayed as a separate cash-flow metric and is never included in Profit.
- Older internal fields such as `grossProfit`, `netProfit`, `grossMarginPercent`, and `netMarginPercent` may remain in TypeScript types until a deeper compatibility cleanup is scheduled.

## Walmart Data Quality / Import Audit

`/imports/audit` is the operational readiness view for Walmart P&L data.

The audit is read-only and respects the global marketplace selector. It answers whether the selected period has enough source data to trust P&L, without comparing against Item Sales financial columns, Item Performance sales sync, Overview, settlement sale rows, or PO-to-settlement matching.

The audit checks:

- PO Sales coverage from `SalesOrder` / `SalesOrderItem` by PO order date.
- Settlement coverage from `SettlementPayout` period metadata plus settlement-derived `Refund`, `MarketplaceFee`, and Seller Center SEM `AdvertisingCost` rows by `Transaction Posted Timestamp`.
- Seller Center SEM coverage from settlement-derived `AdvertisingCost` rows.
- Walmart Connect coverage from active daily `AdvertisingCost` rows only.
- COGS coverage through `EffectiveCogsService` by PO order date.
- Product attribution coverage for refunds, commission, fulfillment, and Walmart Connect rows that can be deterministically assigned to SKU/parent.

Status values are deliberately conservative:

- `Complete` means imported metadata proves the selected dates are covered.
- `Partial` means only some selected dates are covered.
- `Missing` means no relevant source rows or coverage metadata were found.
- `Coverage Unknown` means the application has data but lacks enough import metadata to prove completeness.

Overall `P&L Data Ready` is shown only when PO Sales, Settlement, COGS, Seller Center SEM, and Walmart Connect all report `Complete`. The audit does not block P&L pages; it shows the missing or uncertain source data and links to the existing import workflows.

`pnpm run validate:product-pnl -- --from=YYYY-MM-DD --to=YYYY-MM-DD` runs the same read-only audit path from the command line and prints Marketplace P&L, Product P&L aggregate, marketplace-only/unallocated amounts, and data coverage.

## Separation Between UI, Business Logic, and Connectors

### UI Layer

Location:

```text
src/app
src/components
```

Responsibilities:

- Render forms, tables, navigation, and dashboard cards.
- Call server actions or server queries.
- Present validation and import summary results.
- Avoid marketplace-specific parsing logic.
- Avoid P&L calculations beyond formatting already-computed values.

### Business Logic Layer

Location:

```text
src/server/pnl
src/server/imports
src/server/cogs
src/server/sales
src/server/advertising
src/lib/cogs-import.ts
```

Responsibilities:

- Normalize generic inputs.
- Validate data.
- Run import orchestration.
- Commit normalized records.
- Calculate P&L.
- Keep application behavior marketplace-neutral unless the file is explicitly generic parser logic.

### Marketplace Connector Layer

Location:

```text
src/server/connectors
```

Responsibilities:

- Define marketplace capabilities.
- Detect marketplace-specific report types.
- Parse marketplace-specific columns.
- Normalize parsed data into generic types.
- Register report parsers for the generic import framework.

Rule:

No Walmart-specific logic belongs in `src/server/pnl`. If a P&L behavior seems Walmart-specific, normalize the data earlier in the Walmart connector or generic import committer.

## Retired Sales Uploads

The legacy direct `/sales/upload` workflow is not the preferred workflow. Walmart sales should enter P&L through the generic import framework.

The supported sales workflow is Walmart PO reports as order-date sales. Retired Walmart sales-summary/account-summary files and monthly sales summaries should not appear in the normal upload workflow. Walmart Item Sales appears only in the SKU / Parent Mapping workflow and must not be treated as a sales import.

The generic `SalesOrder` and `SalesOrderItem` tables are retained because they are still the normalized storage layer for PO sales.

## Direct Ad Spend Upload

`/ad-spend/upload` is the current direct upload workflow for Walmart Connect Item Performance files.

Behavior:

- Supports `.csv`, `.xlsx`, and `.xls`.
- Requires a selected reporting period. When the file includes a row-level `Date`, those dates are used and rows outside the selected period are skipped. If a file lacks row-level dates, the selected period must be one day.
- Previews valid rows before saving.
- Walmart Connect Item Performance requires SKU ID and Ad Spend.
- Optional metrics are item ID, item name, campaign name, campaign type, clicks, impressions, attributed orders, attributed sales, attributed units, average CPC, and ROAS.
- Stores rows as marketplace-neutral `AdvertisingCost`.
- Uses `source = "walmart_connect_item_performance"` for Walmart Connect Item Performance.
- Stores the selected report month, item/campaign fields, clicks, impressions, attributed metrics, source row, original file name, and duplicate key in `metadata`.
- Prevents duplicate Connect rows by updating existing rows with the same `organizationId + marketplace + source + reportMonth + sellerSku + campaignName + itemId`.
- Revalidates SKU and Parent P&L after import.

## Settlement Imports

`/imports/settlements` uses the generic import framework for marketplace settlement files.

Current Walmart behavior:

- `src/server/connectors/walmart/settlements.ts` detects Walmart Payments New reports.
- `src/server/connectors/walmart/sem-advertising.ts` is retained as legacy parser code but is no longer registered in the active Walmart generic import workflow.
- Payments New refund rows, exact PO-line matched commission/fulfillment fee rows, unmatched standalone fee rows, and Seller Center SEM rows are reported by `Transaction Posted Timestamp`.
- Payment period dates from rows or `PaymentSummary` are retained for audit and payout coverage, but they are not used to move unmatched fees to the period end date.
- When Walmart leaves transaction-level period dates blank, the connector can still inherit payout-period audit context from the report's `PaymentSummary` row and marks `periodDateSource = "payment_summary"` in metadata.
- Settlement fee rows preserve a generic signed-amount convention in metadata so negative settlement amounts count as expenses and positive settlement amounts count as credits.
- Product-price refund rows are committed as standalone `Refund` rows and applied as settlement-derived refund sales.
- `WFS Fulfillment fee` rows are committed as standalone `MarketplaceFee` rows with `feeType = "fulfillment_fee"`.
- Known WFS return, shipping, storage, inventory transfer, inbound transportation, long-term storage, prep service, inventory disposal, review accelerator, found/damaged/lost inventory, WFS refund, and reimbursement rows are classified as marketplace-level `Other Walmart Fees & Adjustments` unless a category is explicitly approved for product-level attribution.
- Each classified adjustment stores `classificationStatus`, `financialDirection`, `adjustmentCategory`, `adjustmentCategoryLabel`, `attributionScope`, and `productAttributionReliable` in metadata.
- Unsupported financial settlement rows are preserved in import summaries with description/amount counts but are excluded from active profit until deliberately mapped.
- `SEM Marketing Fee` rows are imported from settlement reports as Seller Center SEM `AdvertisingCost` rows.
- Product price sale rows and tax are ignored. Promo/funded-savings rows are treated as unsupported financial rows instead of being silently included in profit.
- Tax rows are ignored and do not feed sales, refunds, fees, ads, or profit.
- `Commission on Product` rows become `MarketplaceFee.feeType = "commission"` and use their actual Walmart settlement amount.
- `PaymentSummary.Total Payable` is the authoritative settlement payout/payable field and is stored as a standalone `SettlementPayout` record.
- `PaymentSummary.Period Start Date` and `PaymentSummary.Period End Date` are stored as the payout settlement period. If those dates are missing, the payout preserves null dates instead of inventing a 14-day period.
- Payout date remains null unless the report has an explicit payout/payment/deposit date field. `Transaction Posted Timestamp` is preserved in payout metadata but is not treated as payout date by default.

Reporting behavior:

- Newly imported settlement-derived refunds and matched/order-line fees are shown in day/week/month/quarter/year/custom ranges by their `Transaction Posted Timestamp`.
- Newly imported unmatched standalone settlement fees are shown on their transaction posted date, with settlement period metadata preserved for audit.
- Settlement totals are not evenly allocated across payout days.
- Settlement Payout appears as a separate cash-flow panel/history on Marketplace Parent P&L and is not included in Profit.
- Older settlement imports that include active `periodStartDate` and `periodEndDate` metadata may still use the legacy allocation path until they are cleaned and re-imported.

## Current Technical Debt

- `/advertising/upload` still exists as a legacy upload path for date-based SEM files, but new Walmart Seller Center SEM data should come from Payments New settlement reports.
- Generic import framework currently has committed Walmart PO sales, Payments New settlement, and Item Sales mapping parsers. Inventory has the mapping-only Walmart Item Sales parser; additional inventory parsers are future work.
- Prisma client generation may need to be run manually on Windows after migrations.
- Build can be blocked by Windows `EPERM` worker spawn permissions in this environment.
- Focused tests exist for Effective COGS, P&L engine math, settlement allocation, PO source selection, product attribution, Walmart PO imports, settlements, SEM imports, Walmart Connect imports, Parent/SKU pages, and data-quality audit behavior.
- Some helper scripts are one-off operational tools and should be retired when the project stabilizes.
