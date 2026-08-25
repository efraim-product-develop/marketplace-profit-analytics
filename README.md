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
   - `DIRECT_URL`: Prisma migration/CLI connection.

   For local Docker Postgres, both values can match `.env.example`. For Supabase,
   use the app/runtime connection for `DATABASE_URL` and the Supavisor Session
   pooler on port `5432` for `DIRECT_URL`.

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

For Supabase, keep `DATABASE_URL` pointed at the app/runtime connection and set
`DIRECT_URL` to the Supavisor Session pooler connection on port `5432` for Prisma
migrations. This avoids relying on the direct `db.PROJECT_REF.supabase.co` host,
which may be unreachable from local Windows development.

If your `.env` already has the Supabase pooled `DATABASE_URL`, run:

```bash
pnpm run supabase:session-url
pnpm run prisma:deploy
```

The helper derives `DIRECT_URL` from the existing Supabase pooler URL without
printing the password. It writes a Session pooler URL in this general shape:

```text
postgresql://postgres.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:5432/postgres?sslmode=require
```

If the helper cannot determine your project reference, copy the Session pooler
connection string from Supabase Database settings into `DIRECT_URL`.

The older `pnpm run supabase:direct-url` command is still available as a
backward-compatible alias, but it now writes the Session pooler URL as well.

If the direct host is not reachable from your local network and Supabase reports
`RLS Disabled in Public` for `public._prisma_migrations`, apply only that advisor
fix through the pooled app connection:

```bash
pnpm run supabase:fix-rls-advisor
```

## Walmart API Connection Setup

The app can test Walmart Marketplace API credentials from `/connections`.

Open `/connections` and use the Walmart Marketplace API form to save these
values locally:

```env
WALMART_MARKETPLACE_CLIENT_ID="your-client-id"
WALMART_MARKETPLACE_CLIENT_SECRET="your-client-secret"
WALMART_MARKET="us"
WALMART_SERVICE_NAME="Walmart Marketplace"
WALMART_API_BASE_URL="https://marketplace.walmartapis.com"
```

Optional values:

```env
WALMART_CONSUMER_CHANNEL_TYPE=""
WALMART_SELLER_ID=""
```

Then click `Test API connection`.

Real secrets stay in `.env`. The database stores only connection status, the
credential reference, and non-secret test metadata. The first API test requests a
short-lived Walmart token; it does not import or sync reports yet.

## Pages

- `/connections`
- `/cogs/upload`
- `/cogs/audit`
- `/imports/sales`
- `/imports/settlements`
- `/imports/advertising`
- `/imports/inventory`
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

Use `/imports/sales` for the reusable import framework. It automatically detects the supported Walmart sales report, previews rows, validates data, blocks duplicate file imports, saves import history, and commits importable rows to the P&L tables.

The current Walmart sales architecture is:

- PO reports provide the Walmart sales source using Walmart's true order date.
- Settlement reports provide refunds, marketplace commission, fulfillment fees, other Walmart fees and adjustments, and payout as separate financial inputs.
- Settlement sale/product rows do not replace PO sales rows.
- Retired Walmart sales summary/account summary files are not used for P&L or reconciliation.

The normal sales workflow supports Walmart PO uploads through `/imports/sales`.

The PO sales uploader accepts Excel or CSV files with order-line fields such as:

- SKU
- PO number
- PO line number
- Customer order number
- Customer Order ID
- Order Date
- Quantity
- Item Price
- Order Status
- Fulfillment type when present

PO rows use the true PO order date. Re-uploading the same PO number and line updates the existing row instead of duplicating it. The app does not substitute another sales source when PO or settlement data is missing.

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
