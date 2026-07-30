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
- Walmart sales import parser for daily Item Sales reports and Seller Fulfilled/WFS PO/order reports.
- Walmart Overview Report reconciliation has been retired. Operational P&L uses daily Item Sales reports as the sales source of truth; PO/order reports are audit-only for P&L sales.
- Sales import commit path that creates/updates products, listings, sales imports, orders, order items, categorized fee rows, and refunds.
- Direct `/sales/upload` workflow for previewing and importing Walmart Seller Center order exports into generic orders, items, fees, and refunds for audit workflows.
- Marketplace-neutral `Refund` model for imported refund rows.
- Direct `/ad-spend/upload` workflow for previewing and importing monthly Walmart Connect Item Performance spend into `AdvertisingCost` rows.
- Walmart Payments New settlement import through `/imports/settlements` for WFS fulfillment fees, return/storage/adjustment/other settlement fees, and Seller Center SEM spend.
- SKU P&L and Parent P&L pages using database data, effective COGS lookup, marketplace commission, fulfillment fees, ad spend, missing COGS flags, and product profit metrics.
- P&L engine support for imported refunds, categorized fee rows, standalone settlement-style fee/refund adjustments, Profit, Profit Margin %, and Profit / Unit.
- SKU P&L filters for date, parent SKU, brand, and department, plus global marketplace scoping, source indicators, CSV export, loading state, and order drill-down.
- Parent P&L date filters, parent SKU filter, day/week/month/quarter period tiles, monthly comparison, source/reconciliation indicators, CSV export, and expandable parent rows with SKU-level order history.
- Settings and connections CRUD-style forms for local configuration.
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
- Added Parent P&L monthly comparison, CSV export, source/reconciliation indicators, and selected-SKU order history inside expanded parent rows.

### Milestone 5: Walmart Report Import Foundation

- Added Walmart daily Item Sales Report parsing as the active P&L sales source.
- Retired Walmart Overview Report import/reconciliation. Overview uploads now show an unsupported-file message and do not create daily totals.
- Added Walmart Seller Fulfilled/WFS order report parsing with shipping, tax, refund, status, and duplicate-line handling.
- Added generic import framework with report detection, preview, validation, duplicate file detection, import history, and commit dispatch.
- Added `/imports/sales`, `/imports/settlements`, `/imports/advertising`, and `/imports/inventory`.
- Implemented direct `/sales/upload` preview and confirm-import flow for order exports.
- Added marketplace-neutral refund storage for sales uploads.
- Implemented direct `/ad-spend/upload` preview and import flow for Walmart Connect Item Performance spend.
- Implemented Walmart Payments New settlement import for WFS fulfillment fees, settlement fee categories, and Seller Center SEM spend.

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
- Apply the refund migration in the active database before using `/sales/upload` refund imports.
- Verify `/imports/sales` works end-to-end with daily Walmart Item Sales reports.
- Keep Walmart Seller Center PO/order exports available for optional audit detail, not dashboard sales.
- Keep COGS assignment trustworthy by continuing to flag missing COGS.
- Reduce duplication between legacy `/sales/upload` and the new `/imports/sales` path.
- Decide whether legacy `/advertising/upload` should be retired now that `/ad-spend/upload` exists.

Definition of done:

- A user can import Walmart sales reports through `/imports/sales`.
- A user can preview and import Walmart order exports through `/sales/upload`.
- Duplicate imports are blocked.
- Import history shows the source of imported numbers.
- Parent and SKU P&L update from imported data.
- The old upload paths are either retired or clearly marked as legacy.
- Walmart Connect item-performance spend can be imported through `/ad-spend/upload` without creating duplicate monthly ad cost rows.
- Walmart Payments New reports can be imported through `/imports/settlements` and contribute posted-date settlement fees plus SEM spend to P&L.

## Upcoming Milestones

### Milestone 8: Import Consolidation

- Move all sales upload usage to `/imports/sales`.
- Add a generic advertising report parser to `/imports/advertising`.
- Expand settlement import reconciliation and repair workflows.
- Add clearer import status messaging and repair/retry affordances.
- Add tests for report detection and parser normalization.

### Milestone 9: Walmart Profit Audit

- Audit PO/order reports, settlement fees, advertising, and COGS.
- Add report-level audit views.
- Document that daily Item Sales reports are authoritative for sales, settlement reports are authoritative for refunds and fees, advertising reports are authoritative for Walmart Connect spend, and COGS imports are authoritative for SKU costs.

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
