# Project Roadmap

This document is the source of truth for project direction. Read this, `ARCHITECTURE.md`, `IMPORT_FORMATS.md`, `TODO.md`, and `CONTRIBUTING.md` before implementing future product features.

## Overall Vision

Marketplace Profit Analytics is a local-first profit and loss tool for marketplace sellers. The first real workflow targets Walmart Seller Center file imports, but the product must stay marketplace-neutral at its core so it can grow into a SaaS product with multiple marketplaces, multiple organizations, and repeatable import pipelines.

The long-term product should help sellers answer:

- Which SKUs and parent products are profitable?
- Which costs are missing or stale?
- Which marketplace reports reconcile to P&L?
- How do sales, marketplace commission, fulfillment fees, COGS, ad spend, and refunds move by day, week, month, and quarter?
- Which imports created the data behind a number?

The current phase is not about authentication, billing, charts, or automation. It is about building a trustworthy local data foundation.

## Current Progress

The app is a Next.js 14 App Router project using TypeScript, Tailwind CSS, Prisma, PostgreSQL, TanStack Table, and `xlsx`.

The current app includes:

- Local single-organization resolver using `Local Workspace`.
- Global marketplace selector in the app header. The selected marketplace is remembered across navigation and refreshes and scopes pages without adding organization switching.
- Marketplace-neutral Prisma models for organizations, connections, products, listings, COGS, sales orders, fees, advertising costs, and generic import runs.
- Walmart connector code isolated under `src/server/connectors/walmart`.
- COGS `.xlsx` upload with a simple required template (`sku`, `effective_date`, `unit_cogs`), row preview, validation, upload history, row issues, optional parent/SKU/listing context, cost batches, and effective-dated cost records.
- Current COGS export that downloads the latest active cost per SKU for update-and-reupload workflows.
- COGS audit page that reads database cost history, upload history, and row issues.
- Generic import framework under `src/server/imports` with report detection, preview rows, validation issues, duplicate file detection, import history, and optional commit handlers.
- Generic import pages for sales, settlements, advertising, and inventory.
- Walmart sales architecture has pivoted to PO reports as the sales source and settlement reports as a separate financial source.
- Walmart PO reports can now be imported through `/imports/sales` as order-date sales rows keyed by PO number and line number.
- Walmart Item Sales reports can be imported through `/imports/inventory` only as SKU-to-parent mapping files. Item Sales financial columns are ignored and never feed P&L.
- Competing Walmart sales-summary, account-summary, fallback, and reconciliation paths are retired for P&L.
- Sales import commit path that creates/updates products, listings, sales imports, orders, order items, categorized fee rows, and refunds.
- Marketplace-neutral `Refund` model for imported refund rows.
- Direct `/ad-spend/upload` workflow for previewing and importing monthly Walmart Connect Item Performance spend into `AdvertisingCost` rows.
- Walmart Payments New settlement import through `/imports/settlements` for refunds, marketplace commission, WFS fulfillment fees, and classified Other Walmart Fees & Adjustments. Settlement SEM is excluded because Seller Center SEM comes from `/imports/advertising`.
- Settlement Payout tracking stores Walmart `PaymentSummary.Total Payable` as a separate cash-flow metric with payout history, while keeping it out of Profit calculations.
- SKU P&L and Parent P&L pages using database data, effective COGS lookup, marketplace commission, fulfillment fees, ad spend, missing COGS flags, and product profit metrics.
- P&L engine support for imported refunds, categorized fee rows, standalone settlement-style fee/refund adjustments, Profit, Profit Margin %, and Profit / Unit.
- Other Walmart Fees & Adjustments now preserve signed charge/credit direction, category metadata, marketplace-level attribution by default, unsupported-row reporting, and an expandable Parent P&L breakdown.
- SKU P&L filters for date, parent SKU, brand, and department, plus global marketplace scoping, source indicators, CSV export, loading state, and order drill-down.
- Parent P&L date filters, parent SKU filter, day/week/month/quarter period tiles, monthly comparison, source indicators, CSV export, and expandable parent rows with SKU-level detail.
- Settings and connections CRUD-style forms for local configuration.
- Walmart Marketplace API credential readiness and token-test support on `/connections`; real secrets stay in local `.env`.
- Previous experimental Walmart API report sync, Orders API sync, polling, and Sync Center UI have been removed so the API layer can be rebuilt cleanly.
- Previous experimental Walmart daily sales sync code has been removed from the active codebase.
- Advertising cost model and legacy ad spend upload path.
- Duplicate-safe monthly Walmart Connect item-performance advertising upload with clicks, impressions, attributed orders/sales/units, average CPC, and ROAS metadata.
- VS Code workspace setup with recommended extensions, formatting, tasks, and debug profiles.

Known operational state:

- Last verified on June 29, 2026: `pnpm install`, `pnpm run prisma:validate`, `pnpm run typecheck`, and `pnpm run lint` completed successfully.
- Last verified on July 2, 2026: P&L engine tests, typecheck, lint, and January-May dashboard route checks completed successfully.
- Last verified on July 7, 2026: focused tests, typecheck, and lint completed successfully after Parent P&L Step 10 enhancements.
- Last verified on July 8, 2026: typecheck and lint completed successfully after global marketplace selector refactor.
- Prisma schema validates.
- Typecheck and lint pass with no ESLint warnings or errors.
- Prettier is configured for formatting through VS Code and `pnpm run format`.
- Production build can be blocked in this Windows environment by `EPERM` when Next.js tries to spawn workers.
- Supabase direct database host may be unreachable from the local machine. Pooled fallback helpers exist for supported one-off migrations.
- Walmart API credential testing is active. Future Walmart API work should keep PO/order-style sales data separate from settlement financial data rather than using Item Performance sales summaries.
- Last verified on August 12, 2026: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run prisma:validate` completed successfully after Walmart API sync hardening.

## Completed Milestones

### Milestone 1: Initial App Scaffold

- Created the Next.js App Router project.
- Added TypeScript, Tailwind CSS, Prisma, PostgreSQL, TanStack Table, and `xlsx`.
- Created base pages for connections, COGS, P&L, and settings.

### Milestone 2: Marketplace-Neutral Foundation

- Added generic organization, product, listing, cost, order, fee, and advertising models.
- Added a local organization resolver and scoped application queries/writes by `organizationId`.
- Kept marketplace source identity as data, such as `marketplace = "walmart"`.
- Kept Walmart-specific parsing inside the Walmart connector folder.

### Milestone 3: Full COGS Upload and Audit

- Implemented `.xlsx` COGS upload.
- Added required column validation for `sku`, `effective_date`, and `unit_cogs`.
- Kept parent product, variation, shipment, freight, prep, packaging, and notes fields optional for richer imports.
- Added client-side row preview.
- Added row-level validation errors.
- Created/updated parent product, SKU product, listing, COGS batch, and cost record data.
- Preserved history unless the same SKU, resolved shipment batch, and effective date already exists.
- Added current COGS export for latest active SKU costs.
- Added COGS audit table, upload history, row issue display, filters, sorting, and active-now highlighting.

### Milestone 4: Database-Driven P&L

- Removed fallback/demo analytics data.
- Connected P&L to sales order items, categorized fees, advertising costs, and effective COGS.
- Added missing COGS flags.
- Added SKU P&L and Parent P&L database views.
- Added parent row expansion to child SKUs.
- Added date and period filters for Parent P&L.
- Added parent SKU filter that narrows period tiles and table data.
- Added Parent P&L monthly comparison, CSV export, source indicators, and selected-SKU detail inside expanded parent rows.

### Milestone 5: Walmart Report Import Foundation

- Retired competing Walmart sales-summary/account-summary imports and reconciliation/fallback logic from P&L sales.
- Adopted the new Walmart sales architecture: PO reports provide order-date sales, settlement reports provide refunds, fees, and payout, and Seller Center SEM uses a separate advertising report.
- Implemented Walmart PO report parser/committer for sales, including preview, validation, cancelled-row preservation, missing SKU reporting, import diagnostics, and duplicate-safe updates by PO number plus line number.
- Implemented Walmart Item Sales mapping-only import for SKU-to-parent hierarchy, while keeping Item Sales GMV, orders, units, refunds, and other financial columns out of P&L.
- Added generic import framework with report detection, preview, validation, duplicate file detection, import history, and commit dispatch.
- Added `/imports/sales`, `/imports/settlements`, `/imports/advertising`, and `/imports/inventory`.
- Added marketplace-neutral refund storage for sales uploads.
- Implemented direct `/ad-spend/upload` preview and import flow for Walmart Connect Item Performance spend.
- Implemented Walmart Payments New settlement import for refunds, marketplace commission, WFS fulfillment fees, and classified Other Walmart Fees & Adjustments. Settlement SEM is excluded from active P&L.
- Implemented Walmart Seller Center SEM campaign-level daily import through `/imports/advertising`.
- Implemented `/imports/audit` as the read-only Walmart data-quality and P&L readiness screen.
- Implemented `pnpm run validate:product-pnl` as the read-only command-line validation report for Marketplace P&L, Product P&L, marketplace-only/unallocated amounts, and data coverage.

### Milestone 6: Project Documentation and Local Development Workflow

- Added project roadmap, architecture notes, import format documentation, backlog, and contribution conventions.
- Established these docs as the source of truth for future feature work.
- Added VS Code workspace settings, recommended extensions, reusable tasks, and debug launch profiles.
- Added Prettier configuration plus `format`, `format:check`, and `prisma:validate` scripts.
- Confirmed the local quality gate passes from PowerShell.

## Current Milestone

### Milestone 7: Stabilize the Data Foundation

Current focus:

- Use VS Code as the normal local development home while continuing feature work.
- Verify the generic import framework migration is applied in Supabase.
- Verify `/imports/sales` end-to-end with live Walmart Seller Fulfilled and WFS PO reports.
- Track successful PO sales coverage and settlement report coverage so day/week/month/quarter/year/custom views can show incomplete ranges when expected data is missing.
- Keep COGS assignment trustworthy by continuing to flag missing COGS.
- Verify Walmart API credentials from `/connections` once Client ID and Client Secret are added to `.env`.
- Design the next Walmart API path around PO/order data and settlement data rather than Item Performance sales summaries.
- Decide whether legacy `/advertising/upload` should be retired now that `/ad-spend/upload` exists.

Definition of done:

- A user can import Walmart PO reports through `/imports/sales` as the Walmart sales source.
- Duplicate imports are blocked.
- Import history shows the source of imported numbers.
- Parent and SKU P&L update from imported data.
- Missing PO sales or settlement financial coverage is visible in P&L.
- Walmart API credential testing remains available.
- Obsolete competing sales-summary/account-summary and reconciliation paths are retired.
- Walmart Connect item-performance spend can be imported through `/ad-spend/upload` without creating duplicate monthly ad cost rows.
- Walmart Payments New reports can be imported through `/imports/settlements` and contribute posted-date settlement refunds, commission, fulfillment fees, other Walmart fees, and payout context to P&L.
- Walmart Seller Center SEM campaign-level daily reports can be imported through `/imports/advertising` and contribute Seller Center SEM Advertising to P&L.
- Overall Walmart Marketplace P&L uses the approved sources only: PO sales by order date, settlement refunds/fees by posted timestamp, historical COGS by PO order date, daily Seller Center SEM by campaign report date, daily Walmart Connect advertising by ad report date, and Settlement Payout as a separate cash-flow metric outside Profit.
- Displayed Sales is now `Gross Sales - Refunds`, where Gross Sales is valid non-cancelled PO sales and Refunds are settlement product-price refunds by posted timestamp. Profit starts from Sales and does not subtract refunds again.
- Campaign-level Seller Center SEM is included in overall marketplace Profit but excluded from Parent/SKU product allocation rows because the report has no SKU or item identifiers.
- Parent/SKU product P&L now includes only deterministically attributable financial components: PO sales, historical COGS, attributable settlement refunds, attributable marketplace commission, attributable fulfillment fees, and SKU-attributed Walmart Connect advertising.
- Marketplace-only costs remain outside Parent/SKU product Profit and are surfaced through attribution diagnostics instead of being allocated.
- `/imports/audit` shows source coverage, missing data, attribution gaps, and P&L readiness for a selected period without comparing against Item Sales financial columns, Overview, Item Performance sync, or settlement sale sources.
- The read-only validation command prints Marketplace P&L, Product P&L aggregate, marketplace-only/unallocated amounts, and data coverage for a selected date range.

## Upcoming Milestones

### Milestone 8: Import Consolidation

- Move all sales upload usage to `/imports/sales`.
- Harden Walmart PO import after testing both Seller Fulfilled and WFS files from the current Seller Center export.
- Harden Walmart Payments New settlement import as a separate financial source without changing PO sales rows.
- Harden the Seller Center SEM parser after more campaign report samples are collected.
- Expand settlement import audit and repair workflows.
- Add clearer import status messaging and repair/retry affordances.
- Add tests for report detection and parser normalization.

### Milestone 9: Walmart Profit Audit

- Use `/imports/audit` after each import cycle to confirm PO sales, settlement fees/refunds/payout, Seller Center SEM, Walmart Connect advertising, and COGS coverage.
- Validate product-level Profit against overall marketplace Profit with the read-only `validate:product-pnl` report after database connectivity is stable.
- Add exportable report-level audit output if the on-screen audit proves useful.
- Keep documenting that PO reports are authoritative for sales and order date; settlement reports are authoritative for refunds, commission, fulfillment fees, other Walmart fees, and payout; advertising reports are authoritative for Walmart Connect and Seller Center SEM spend; and COGS imports are authoritative for SKU costs.
- Add a repeatable real-data sanity report once local database reads are stable from Windows.

### Milestone 10: P&L Completeness

- Expand settlement parser coverage as additional Walmart settlement formats are collected.
- Continue mapping settlement-specific fee names into existing generic fee categories.
- Add richer refund-source imports when a refund-specific report is available.
- Add profit validation reports that explain Profit, Profit Margin %, and Profit / Unit.
- Add exportable validation reports.

### Milestone 11: Quality and Maintainability

- Add unit tests for parsers and P&L engine.
- Add integration tests for import preview and commit paths.
- Add database seed fixtures for repeatable development.
- Remove or archive one-off cleanup scripts once no longer needed.
- Improve build reliability on Windows.

## Future SaaS Roadmap

The app is not SaaS yet, but the architecture should keep that path open.

Future SaaS capabilities:

- Authentication and user accounts.
- Organization membership and roles.
- Multiple workspaces per user.
- Billing and plan limits.
- Per-organization data isolation and RLS strategy.
- Hosted Postgres environment with migration workflow.
- Marketplace API connections alongside manual imports.
- Background jobs for report processing and scheduled syncs.
- Import file storage and download links.
- Audit logs for imports, settings, and data changes.
- Multi-marketplace support beyond Walmart.
- Dashboards, charts, alerts, and saved reports.
- Production observability, error monitoring, and backups.

SaaS design rule:

Do not bake local-only assumptions into the P&L engine or marketplace connector contracts. Local single-user mode is the first deployment shape, not the final architecture.
