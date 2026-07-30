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
    sales/upload/            Direct sales/order upload with preview and commit
    settings/                Local organization settings CRUD
  components/                Shared UI components
  lib/                       Shared utilities and client-side import helpers
  server/
    advertising/             Generic advertising parser
    cogs/                    COGS queries, generic parser, and effective COGS service
    connections/             Connection queries
    connectors/              Marketplace connector registry and implementations
      walmart/               Walmart-specific report parsing and connector metadata
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
- `SalesOrder`: marketplace order or aggregate monthly sales record.
- `SalesOrderItem`: marketplace order line or aggregate SKU sales line.
- `MarketplaceFee`: normalized fees attached to an order or order item.
- `Refund`: normalized refund sales attached to an order, order item, or standalone settlement row.
- `AdvertisingCost`: normalized ad spend rows.
- `MarketplaceDailyTotal`: legacy account-level daily totals table. Overview-report reconciliation is no longer an active workflow.

Important uniqueness and indexing rules:

- `Product`: unique by `organizationId + internalSku`.
- `Listing`: unique by `organizationId + marketplace + sellerSku`.
- `CogsBatch`: unique by `organizationId + marketplace + shipmentId`.
- `CostRecord`: unique by `organizationId + marketplace + sellerSku + shipmentId + effectiveDate`.
- `SalesOrder`: unique by `organizationId + marketplace + externalOrderId`.
- `MarketplaceDailyTotal`: unique by `organizationId + marketplace + reportType + totalDate` if legacy daily-total rows exist.
- Direct sales upload replaces matching order lines by `organizationId + marketplace + externalOrderId + sellerSku`.
- `ImportRun`: duplicate detection is based on `organizationId + marketplace + importKind + reportType + fileHash` for previously imported or review-needed imports.

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
  sales.ts
```

`index.ts` registers the Walmart connector and exposes:

- marketplace code: `walmart`
- display name: `Walmart Seller Center`
- capabilities
- COGS parser alias configuration
- legacy sales parser
- generic import parsers

`sales.ts` handles Walmart-specific report detection and parsing:

- Daily Item Sales Report
- PO / Order Report

The Walmart parser normalizes report rows into generic `ParsedSalesRow` data for sales reports or generic `ParsedImportReport` data for import history and commit handlers.

Current Walmart commit behavior:

- Daily Item Sales reports are registered as the active sales parser for P&L. They require a selected report date and store one daily summary order line per `reportDate + SKU + itemId`.
- Seller Fulfilled/WFS order reports can still be imported for audit/order-detail workflows, but they are not the active P&L sales source.
- PO/order report sales are normalized as `Item Cost x Qty` for non-canceled rows. Shipping, discount, and tax are stored for audit but do not drive dashboard sales.

Overview reports are no longer supported by the import workflow because they do not contain SKU-level order detail. If an Overview file is uploaded, the Walmart sales connector returns an unsupported-file message instead of committing daily totals.

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

Only sales currently has Walmart committers. Sales import commits can write generic orders, order lines, fees, products/listings, and refund sales. Settlement imports can also write standalone refund sales when the marketplace report provides product-price refund rows. Other import kinds are scaffolded for future parsers.

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
- calculates PO/order sales from normalized `itemRevenue` only. For Walmart PO rows, `itemRevenue = Item Cost x Qty`; shipping, discount, and tax are tracked for audit but do not change sales.
- calculates sales as PO/order gross item sales less refund sales, then calculates the pre-ad internal profit subtotal as `Sales / GMV - all fee categories - COGS`
- calculates product Profit as that subtotal minus advertising cost
- calculates Profit Margin % and Profit / Unit from product Profit
- keeps older internal field names such as `grossProfit`, `netProfit`, and `contributionProfit` for compatibility, but the UI labels the after-ad-spend value as Profit
- flags missing COGS units and lines

`queries.ts` is data access and mapping:

- loads organization-scoped sales order items
- joins order, item-level fee, and refund data
- allocates order-level fees and refunds across order lines without per-row database lookups
- loads standalone marketplace fee rows as settlement-style adjustments and standalone refund rows as refund sales
- allocates settlement-derived fees and settlement-derived SEM spend across their actual settlement period for reporting
- assigns effective COGS through `EffectiveCogsService`
- loads ad spend
- filters parent P&L by date range and parent SKU
- filters SKU P&L by date range, parent SKU, brand, department, and the active global marketplace
- filters parent P&L, import history, COGS audit, exports, and reconciliation views by the active global marketplace where applicable
- creates day/week/month/quarter period tiles
- creates Parent P&L monthly comparison rows and selected-SKU order drill-down rows for the UI
- uses daily Walmart Item Sales summary lines as the sales source for day, week, month, quarter, year, and custom P&L
- suppresses PO/order detail rows from dashboard sales so they remain available for audit without double-counting
- keeps line-level PO/order fees and refund sales attached to the same sales-source selection as their order lines, while standalone settlement-style fee adjustments remain available as independent profit adjustments

`daily-service.ts` is the shared daily-grain reporting path for day, week, and partial custom ranges:

- uses only daily Item Sales rows for sales and never uses PO/order detail rows as dashboard sales
- uses effective COGS already assigned to each order line by actual order date
- includes only daily-capable Walmart Connect advertising rows
- excludes monthly/cumulative Walmart Connect rows from daily-grain views and reports a `Missing daily ads` data-quality status
- allocates settlement-derived marketplace commission, fulfillment fees, other fees, and Seller Center SEM across settlement period overlap days
- returns compact data-quality labels and a temporary diagnostic payload explaining included sales, COGS, settlement allocation, SEM, and Walmart Connect values

`calendar-dates.ts` documents the current P&L business-day convention:

- UTC calendar dates are used consistently for selected ranges, orders, ads, settlements, and custom range filtering.
- Selected start and end dates are inclusive.
- Date-only parsing avoids accidental previous-day or next-day shifts.

`settlement-period-allocator.ts` is marketplace-neutral reporting logic:

- Applies only to normalized settlement-derived `MarketplaceFee` rows and settlement-derived SEM `AdvertisingCost` rows.
- Uses settlement metadata period dates, such as `periodStartDate` and `periodEndDate`, when they exist.
- Allocates exact cents across inclusive calendar days and assigns rounding remainders deterministically to the earliest days.
- Uses posting date only as a fallback when settlement period metadata is missing or invalid.
- Does not invent a default 14-day period.
- Does not change stored settlement rows, COGS, Walmart Connect advertising, or organization logic.

Current product profitability labels:

- UI uses `Profit = (Item Sales - refund sales) - marketplace commission - fulfillment fees - other internal fee categories - COGS - ad spend`.
- UI uses `Profit Margin % = Profit / Sales`.
- Marketplace Commission and Fulfillment Fees are displayed separately when fee category data is available.
- Additional fee categories such as shipping, storage, returns, adjustments, and other fees remain modeled internally and can be surfaced as a compact settlement-fee breakdown.
- Walmart Connect Advertising and SEM Advertising are displayed separately and included in Profit.
- Walmart Connect P&L uses daily Item Performance rows only; older monthly/cumulative Walmart Connect rows are ignored to avoid overstating ad spend.
- Older internal fields such as `grossProfit`, `netProfit`, `grossMarginPercent`, and `netMarginPercent` may remain in TypeScript types until a deeper compatibility cleanup is scheduled.

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

## Direct Sales Upload

`/sales/upload` is a direct upload workflow for marketplace order exports. It is separate from the generic `/imports/sales` history framework and is optimized for quickly previewing and committing Walmart Seller Center order files.

Behavior:

- Supports `.xlsx`, `.xls`, and `.csv`.
- Uses connector-specific column aliases when a marketplace provides `parseSalesUploadWorkbook`.
- Walmart aliases live in `src/server/connectors/walmart/sales-upload.ts`.
- Generic normalized parsing lives in `src/server/sales/upload-parser.ts`.
- Database commit behavior lives in `src/server/sales/upload-commit.ts`.
- Uploads preview normalized rows before saving.
- Required normalized fields are marketplace, external order ID, order date, SKU, quantity, and either item price or gross sales.
- Fees are stored as `MarketplaceFee` rows.
- Refunds are stored as `Refund` rows.
- Existing order lines are replaced by `organizationId + marketplace + externalOrderId + sellerSku`.
- Missing products/listings are created for imported SKUs and linked to parent products when parent SKU data is present.

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
- Payments New rows are normalized by `Transaction Posted Timestamp` and preserve `Period Start Date` / `Period End Date` in metadata.
- When Walmart leaves transaction-level period dates blank, the connector inherits the payout period from the report's `PaymentSummary` row and marks `periodDateSource = "payment_summary"` in metadata.
- Settlement fee rows preserve a generic signed-amount convention in metadata so negative settlement amounts count as expenses and positive settlement amounts count as credits.
- Product-price refund rows are committed as standalone `Refund` rows and reduce displayed Sales / GMV.
- `WFS Fulfillment fee` rows are committed as standalone `MarketplaceFee` rows with `feeType = "fulfillment_fee"`.
- WFS return, storage, reimbursement, inbound, review, and other fee rows are committed into generic fee categories.
- `SEM Marketing Fee` rows are committed as `AdvertisingCost` with `source = "walmart_seller_center_sem"`.
- Product price, tax, tax-withheld, promo, and funded-savings rows are skipped for product profitability.
- `Commission on Product` rows become `MarketplaceFee.feeType = "commission"` and are allocated across their settlement period for reporting ranges.

Reporting behavior:

- Settlement-derived fees and settlement-derived Seller Center SEM are shown in day/week/month/quarter/year/custom ranges by prorating the original settlement row across the actual payout period.
- Reporting ranges receive only the overlap between the selected range and the settlement period.
- Existing settlement imports that include `periodStartDate` and `periodEndDate` metadata can use this behavior without re-import.
- Rows missing period metadata remain usable, but P&L marks them as posting-date fallback estimates in the UI.

## Current Technical Debt

- `/advertising/upload` still exists as a legacy upload path for date-based SEM files. New Seller Center SEM should come from Walmart Payments New settlement imports instead.
- `/sales/upload` and `/imports/sales` now overlap and should eventually be consolidated or clearly separated by use case.
- Generic import framework currently has committed Walmart sales and Payments New settlement parsers, but advertising and inventory parsers are future work.
- Prisma client generation may need to be run manually on Windows after migrations.
- Build can be blocked by Windows `EPERM` worker spawn permissions in this environment.
- Parser and broad P&L tests are not yet in place; focused `EffectiveCogsService` tests exist.
- Some helper scripts are one-off operational tools and should be retired when the project stabilizes.
