# Marketplace Profit Analytics

A local Next.js 14 TypeScript app for marketplace P&L analytics. The first connector is for Walmart Seller Center file workflows, but the data model and profit engine are marketplace-neutral.

## Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL
- TanStack Table
- `xlsx` for Excel uploads

## Architecture Notes

- Core P&L logic lives in `src/server/pnl` and accepts generic marketplace line inputs.
- Marketplace source identity is stored as data, for example `marketplace = "walmart"`.
- Generic entities are modeled in Prisma: organizations, marketplace connections, products, listings, costs, orders, order items, and fees.
- Walmart advertising is modeled as `AdvertisingCost` records, with Walmart Connect uploaded directly and Seller Center SEM imported from settlement reports.
- Walmart-specific parsing and connector metadata are isolated under `src/server/connectors/walmart`.
- Generic report import history, preview rows, duplicate detection, and commit dispatch live under `src/server/imports`.
- New Walmart reports should be added as parsers in `src/server/connectors/walmart`; the `/imports` UI does not need to be rebuilt for each report type.
- There is no authentication, billing, or charting yet. The Prisma schema includes an organization boundary so SaaS ownership can be added later.

## Local Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

   Required variables:

   - `DATABASE_URL`: app database connection.
   - `DIRECT_URL`: direct database connection used by Prisma migrations.

   For local Docker Postgres, both values can match `.env.example`. For Supabase,
   use the pooled connection for `DATABASE_URL` and the direct connection for
   `DIRECT_URL`.

3. Start PostgreSQL:

   ```bash
   docker compose up -d
   ```

4. Create the database schema and Prisma client:

   ```bash
   pnpm run prisma:migrate
   pnpm run prisma:generate
   ```

5. Run the app:

   ```bash
   pnpm run dev
   ```

6. Open `http://localhost:3000`.

## Visual Studio Code Workflow

This project includes workspace settings under `.vscode/` for long-term local
development.

Recommended first VS Code steps:

1. Open the project folder directly:

   ```powershell
   code "C:\Users\Ebacher\Documents\Codex\2026-06-22\create-a-next-js-14-typescript"
   ```

2. When VS Code prompts for recommended extensions, install them.
3. Run `pnpm install` from the VS Code terminal after package changes.
4. Use the workspace TypeScript version if VS Code asks.

VS Code is configured to:

- Format on save with Prettier.
- Run ESLint fixes on save when available.
- Show TypeScript errors in the editor.
- Use the Prisma extension for `schema.prisma`.
- Hide generated folders such as `.next` and `node_modules` from the file explorer.

Useful VS Code commands:

- `Terminal: Run Task` -> `dev`
- `Terminal: Run Task` -> `typecheck`
- `Terminal: Run Task` -> `lint`
- `Terminal: Run Task` -> `prisma validate`
- `Run and Debug` -> `Next.js: debug full stack`

## Supabase Connection Setup

For Supabase, keep `DATABASE_URL` pointed at the pooled connection for the app and set
`DIRECT_URL` to the direct database connection for Prisma migrations. This avoids
session-pool exhaustion during `prisma migrate deploy`.

If your `.env` already has the Supabase pooled `DATABASE_URL`, run:

```bash
pnpm run supabase:direct-url
pnpm run prisma:deploy
```

The helper derives `DIRECT_URL` from the existing Supabase pooler URL without
printing the password. If your Supabase project blocks direct connections, copy
the direct connection string from Supabase Database settings into `DIRECT_URL`.

If the direct host is not reachable from your local network and Supabase reports
`RLS Disabled in Public` for `public._prisma_migrations`, apply only that advisor
fix through the pooled app connection:

```bash
pnpm run supabase:fix-rls-advisor
```

## Pages

- `/connections`
- `/cogs/upload`
- `/cogs/audit`
- `/imports/sales`
- `/imports/settlements`
- `/imports/advertising`
- `/imports/inventory`
- `/sales/upload`
- `/advertising/upload`
- `/pnl/sku`
- `/pnl/parent`
- `/settings`

## COGS Upload Format

The COGS uploader accepts `.xlsx` files with these required columns:

- `sku`
- `parent_sku`
- `product_name`
- `variation_name`
- `shipment_id`
- `effective_date`
- `unit_cogs`
- `inbound_freight_per_unit`
- `prep_cost_per_unit`
- `packaging_cost_per_unit`
- `notes`

Rows are previewed before import. The import creates or updates the parent product, SKU product, listing, COGS shipment batch, and effective-dated COGS record. Existing history is preserved unless the incoming row has the same `sku`, `shipment_id`, and `effective_date`.

## Sales Upload Format

Use `/imports/sales` for the reusable import framework. It automatically detects supported Walmart report types, previews rows, validates data, blocks duplicate file imports, saves import history, and then commits importable reports to the P&L tables.

The sales uploader accepts Excel or CSV files with columns such as:

- `order id`
- `order date`
- `seller sku`
- `quantity`
- `item revenue` or `unit price`
- `fee amount`
- `fee type`
- `parent sku`

Re-importing the same order replaces that order's existing imported lines and fees.

For Walmart, `/sales/upload` supports Seller Center PO/order reports from the `Po Details` sheet. These are the preferred sales source because they include real order dates, PO numbers, line numbers, SKUs, quantities, item cost, shipping, tax, status, and fulfillment entity. Canceled rows are skipped so they do not inflate P&L.

The importer also supports the Walmart Item Sales Report CSV. Choose the report month on the upload form; each SKU row is imported as a monthly aggregate sales line, using `Base_Item_Id` as the parent grouping key and `GMV_Minus_Commission` to create commission fees.

Walmart `Overview.csv` is no longer supported for import or reconciliation. Use Item Sales reports for monthly Seller Center totals and PO/order reports for order-level audit.

Use `/sales/upload` for direct Walmart Seller Center sales/order exports when you want a simple preview-and-import workflow. It supports `.xlsx`, `.xls`, and `.csv`, previews parsed rows before saving, and imports into generic orders, order items, categorized fee rows, and refunds.

Direct sales upload normalizes:

- order ID
- optional order line ID
- order date
- SKU
- quantity
- item price or gross sales
- shipping revenue
- tax collected
- discount amount
- order status
- marketplace, fulfillment, shipping, storage, return, and adjustment fees
- refund amount and refund date

Direct sales upload upserts by `organizationId + marketplace + externalOrderId + sku`. If a matching order/SKU line already exists, the existing line, fees, and refunds are replaced.

After pulling schema changes, apply migrations and regenerate Prisma:

```bash
pnpm run prisma:deploy
pnpm run prisma:generate
```

If Supabase direct host access fails with `P1001`, apply supported missing migrations through the pooled app connection:

```bash
pnpm run supabase:apply-refund-migration
pnpm run prisma:generate
```

## Generic Import Framework

The shared import UI lives at:

- `/imports/sales`
- `/imports/settlements`
- `/imports/advertising`
- `/imports/inventory`

Each parser can provide automatic detection, row previews, validation errors, duplicate prevention, summary data, and an optional commit step. If a parser has no commit step yet, the framework still saves the preview and import history for audit.

After pulling schema changes for the import framework, update the database and Prisma client:

```bash
pnpm run prisma:deploy
pnpm run prisma:generate
```

Then restart `pnpm run dev` so the running app sees the new Prisma client.

## Walmart Advertising Upload Format

The ad spend uploader stores monthly Walmart Connect Item Performance rows as `AdvertisingCost`. Select Reporting Month and Reporting Year on the upload page.

Walmart Connect files use columns such as:

- `SKU ID`
- `Item ID`
- `Item Name`
- `Campaign Name`
- `Campaign Type`
- `Ad Spend`
- `Clicks`
- `Impressions`
- `Orders`
- `Total Attributed Sales`
- `Units Sold`
- `Average CPC`
- `ROAS`

Seller Center SEM spend should come from Walmart Payments New settlement reports through `/imports/settlements`, where `SEM Marketing Fee` rows are stored with `source = "walmart_seller_center_sem"`.

## Validation

After dependencies are installed:

```bash
pnpm run prisma:validate
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
```

Format the project with:

```bash
pnpm run format
```

To create the COGS effective-date validation dataset and report:

```bash
pnpm run seed:validation
```

This creates two parent products, five SKUs, three historical COGS batches, test orders, and `outputs/cogs-validation-report.md`. The report verifies that older orders use older COGS, newer orders use newer COGS, parent aggregation works, and missing COGS are flagged.
