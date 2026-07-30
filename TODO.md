# TODO

This backlog is the working source of truth for project priorities. Read it before starting future feature work.

## Completed

- Created Next.js 14 TypeScript app with App Router.
- Added Tailwind CSS, Prisma, PostgreSQL, TanStack Table, and `xlsx`.
- Added local single-organization resolver with `Local Workspace`.
- Added global marketplace selector in the app header with cookie-backed persistence.
- Removed page-level marketplace selectors from upload, import, P&L, connection, and settings workflows.
- Scoped relevant pages and exports to the active global marketplace without changing organization logic.
- Added organization-scoped models and application queries/writes.
- Added marketplace-neutral data model for products, listings, costs, orders, fees, advertising costs, connections, and settings.
- Added Walmart connector under `src/server/connectors/walmart`.
- Kept P&L engine generic and marketplace-neutral.
- Added `/connections` CRUD-style form and table.
- Added `/settings` CRUD-style form.
- Added COGS upload with `.xlsx` parsing, preview, validation, import summary, and database save.
- Simplified normal COGS upload to require only `sku`, `effective_date`, and `unit_cogs`.
- Added current COGS export for downloading the latest active SKU costs before updating them.
- Added COGS row-level errors.
- Added COGS upload history.
- Added COGS duplicate row detection.
- Added parent product, SKU product, listing, COGS batch, and effective-dated COGS record creation/update.
- Added COGS audit page with database-backed cost history.
- Added active-now COGS highlighting.
- Added COGS audit filtering by SKU and parent product.
- Added P&L engine connected to database sales, fees, COGS, and advertising costs.
- Added effective-date SKU COGS assignment.
- Extracted effective-date SKU COGS assignment into reusable `EffectiveCogsService`.
- Added focused effective COGS service tests.
- Completed core P&L engine refund handling for imported `Refund` rows.
- Added fee category handling for commission, fulfillment, shipping, storage, return, adjustment, and other fees.
- Added standalone settlement-style fee and refund adjustment support through generic `MarketplaceFee` and `Refund` rows.
- Added consistent product Profit, Profit Margin %, and Profit / Unit calculations while preserving internal compatibility fields.
- Added focused P&L engine math tests.
- Added missing COGS flags.
- Removed demo fallback analytics data.
- Added SKU P&L page.
- Enhanced SKU P&L with date, parent, brand, and department filters plus global marketplace scoping.
- Added SKU P&L source indicators, CSV export, order drill-down, and loading state.
- Added Parent P&L page.
- Added parent rollup table with expandable SKU rows.
- Added Parent P&L date filter, parent SKU filter, and day/week/month/quarter period tiles.
- Added Parent P&L monthly comparison using the same daily Item Sales source as other reporting ranges.
- Added Parent P&L CSV export.
- Added Parent P&L source labels, reconciliation indicators, and selected-SKU order history inside expanded parent rows.
- Added focused Parent P&L page helper tests.
- Added ad spend model as `AdvertisingCost`.
- Added legacy ad spend upload path.
- Added `/ad-spend/upload` for Walmart Connect Item Performance CSV/XLSX uploads with reporting-period selection, preview, duplicate prevention, import summary, and daily ad spend metadata.
- Updated `/ad-spend/upload` to use the Walmart Connect report Date column and skip rows outside the selected period so ad spend can support day/week/custom/yesterday P&L.
- Updated Walmart Connect ad import so Sponsored Video and Sponsored Brands rows with blank SKU ID import as unassigned ad spend instead of being skipped.
- Added Walmart Payments New settlement parser and committer for `/imports/settlements`, including WFS fulfillment fees, return/storage/adjustment/other settlement fees, and Seller Center SEM spend.
- Updated Walmart Payments New settlement parsing so product-price refund rows save as `Refund` rows, show as Refund Sales, and reduce displayed Sales / GMV instead of being treated as other settlement fees.
- Updated Walmart Payments New settlement parsing to inherit missing transaction-level payout dates from the file's `PaymentSummary` row, improving commission and fee allocation across overlapping months.
- Updated settlement fee math so signed settlement rows treat negative amounts as expenses and positive amounts as credits/reimbursements.
- Added daily settlement-period allocation for P&L reporting so settlement-derived fees and settlement-derived SEM are prorated across actual payout periods for day/week/month/quarter/year/custom ranges.
- Added settlement allocation UI notices when P&L uses period allocation or posting-date fallback.
- Added focused settlement period allocator tests for daily, weekly, monthly, quarterly, yearly, custom overlap, negative values, and cent reconciliation.
- Added shared daily-grain P&L service for day, week, and partial custom ranges.
- Daily P&L now uses daily Item Sales by report date, effective COGS by report date, settlement-period allocation, and daily-capable Walmart Connect advertising only.
- Added compact data-quality labels and diagnostics for daily P&L views.
- Added focused daily P&L tests for one-day ranges, seven-day ranges, partial custom ranges, inclusive boundaries, settlement allocation, daily Walmart Connect spend, missing daily ads, missing settlement dates, and Parent/SKU reconciliation.
- Reactivated Walmart Item Sales Report parser as the active daily P&L sales source.
- Added daily report-date handling for Item Sales imports.
- Standardized Walmart PO/order sales as `Item Cost x Qty` for non-canceled rows.
- Removed Walmart Overview Report from the active import/reconciliation workflow. Overview uploads now return an unsupported-file message.
- Added Walmart Seller Fulfilled/WFS order report parser with shipping, tax, refunds, status, SKU linking, and duplicate-line handling.
- Implemented `/sales/upload` with preview, validation, flexible column mapping, and confirm import.
- Added generic `Refund` storage for sales upload refund rows.
- Added Walmart Seller Center direct-upload aliases for PO/order exports.
- Added generic import framework with preview, validation issues, duplicate file detection, history, and commit dispatch.
- Added `/imports/sales`, `/imports/settlements`, `/imports/advertising`, and `/imports/inventory`.
- Added reusable sales import committer.
- Added Supabase helper for `_prisma_migrations` RLS advisor.
- Added pooled Supabase fallback helper for the generic import framework migration.
- Added validation seed script and generated COGS validation report.
- Added project documentation files.
- Added VS Code workspace settings, recommended extensions, tasks, and debug launch profiles.
- Added Prettier configuration and package scripts for formatting and Prisma schema validation.
- Verified local development quality gate on June 29, 2026: `pnpm install`, `pnpm run prisma:validate`, `pnpm run typecheck`, and `pnpm run lint`.
- Verified Step 10 Parent P&L quality gate on July 7, 2026: `pnpm run test`, `pnpm run typecheck`, and `pnpm run lint`.
- Verified global marketplace selector refactor on July 8, 2026: `pnpm run typecheck` and `pnpm run lint`.
- Split Walmart advertising display into Walmart Connect Advertising, SEM Advertising, and Total Advertising.
- Ignored legacy monthly/cumulative Walmart Connect rows across all P&L paths so only daily Item Performance rows affect ad spend.
- Added compact Other Settlement Fees breakdown on Parent P&L tiles.

## In Progress

- Use VS Code as the normal project workspace for local development and future Codex sessions.
- Stabilize Supabase migration workflow when the direct host is unreachable.
- Verify generic import framework tables are applied in Supabase.
- Apply the `20260629163000_add_refunds` migration in the active database. If direct Prisma deploy cannot reach Supabase, run `pnpm run supabase:apply-refund-migration`.
- Verify `/imports/sales` end-to-end with daily Walmart Item Sales reports in the running app.
- Verify optional PO/order imports do not affect dashboard P&L sales.
- Decide how to phase out legacy `/sales/upload`.
- Decide whether to retire legacy `/advertising/upload` or keep it as a date-based fallback.
- Re-import any missing Walmart Connect daily Item Performance reports for dates where ad spend should appear in day/week/custom P&L.

## Next

- Install the recommended VS Code extensions if prompted.
- Start local development from the VS Code terminal with `pnpm run dev`.
- Use VS Code tasks for typecheck, lint, Prisma validation, formatting, and Prisma Studio.
- Run `pnpm run supabase:apply-import-migration` if direct Prisma deploy cannot reach Supabase.
- Run `pnpm run prisma:generate` after the import framework migration is applied.
- Run `pnpm run prisma:generate` after the refund migration is applied. If Windows blocks Prisma generation with `spawn EPERM`, run it from PowerShell with permission allowed.
- Restart the dev server after Prisma generation.
- Upload daily Walmart Item Sales reports through `/imports/sales`, preview them, and confirm import.
- Upload Walmart Seller Fulfilled and WFS order reports only when order-level audit detail is needed.
- Verify duplicate file blocking works.
- Add more parser tests for Walmart PO/order reports.
- Add import framework tests for detection, preview storage, duplicate detection, and commit dispatch.
- Mark legacy upload pages as legacy in the UI or redirect them to current import pages.

## Future

- Implement generic advertising parser and committer for `/imports/advertising`.
- Implement Walmart Connect parser in `/imports/advertising` if direct `/ad-spend/upload` is retired.
- Verify Walmart Payments New settlement imports end-to-end with January payout-cycle files.
- Reconcile Walmart Payments New settlement fees against January Parent/SKU P&L after confirming all imported rows include payout period metadata.
- Add a daily operating checklist or dashboard note showing which reports are needed for yesterday's P&L.
- Add inventory parser for `/imports/inventory`.
- Add audit page for PO/order, settlement, advertising, COGS, and P&L totals.
- Add richer refund source imports if Walmart provides refund-specific reports beyond PO/order refunds.
- Map settlement-specific WFS/storage/other fee names into the existing generic fee categories.
- Add richer profit exports and validation reports using the simplified Profit and Profit Margin terminology.
- Add configurable cost method behavior for `WEIGHTED_AVERAGE`.
- Add exportable audit reports.
- Add charting after the data foundation is stable.
- Add saved report presets.
- Add API connection foundations after manual imports are reliable.

## Nice To Have

- Better Windows build troubleshooting notes.
- Local fixture library for Walmart sample reports.
- Import progress indicators for large files.
- Retry/repair workflow for failed imports.
- Downloadable normalized import payloads.
- Better file hash and natural-key duplicate explanations in the UI.
- More compact mobile import preview tables.
- Inline documentation links from upload pages to `IMPORT_FORMATS.md`.
- CLI script to print current database/import health.
- Cleanup scripts for stale failed imports.
- Design polish for dashboard tables and import pages.
- Keyboard-friendly table navigation.
- More granular marketplace connector capability labels.
