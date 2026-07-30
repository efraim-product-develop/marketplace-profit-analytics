# Contributing

This document defines coding conventions for the project. Read it before implementing future features.

## Source of Truth

Before adding or changing product behavior, read:

- `PROJECT_ROADMAP.md`
- `ARCHITECTURE.md`
- `IMPORT_FORMATS.md`
- `TODO.md`
- `CONTRIBUTING.md`

Do not rely only on chat history. If behavior changes, update the relevant documentation in the same work batch.

## Local Development Workflow

Open the project folder directly in Visual Studio Code:

```powershell
code "C:\Users\Ebacher\Documents\Codex\2026-06-22\create-a-next-js-14-typescript"
```

Use the recommended workspace extensions when prompted. The workspace is configured for:

- Prettier formatting on save.
- ESLint fixes on save when available.
- Workspace TypeScript diagnostics.
- Prisma schema formatting and validation.
- Tailwind CSS class IntelliSense.

Normal local commands:

```bash
pnpm run dev
pnpm run prisma:validate
pnpm run typecheck
pnpm run lint
pnpm run format
```

After pulling dependency changes, run:

```bash
pnpm install
```

## Marketplace-Neutral Code

Core rule:

No Walmart-specific logic belongs in the P&L engine or generic business logic.

Use generic concepts in shared code:

- marketplace
- product
- listing
- seller SKU
- parent SKU
- order
- order item
- marketplace fee
- advertising cost
- cost record
- import run

Avoid generic-layer names like:

- Walmart order
- Walmart fee
- Walmart product
- Walmart COGS

Allowed Walmart-specific locations:

- `src/server/connectors/walmart`
- Walmart parser tests and fixtures when added
- User-facing labels that describe a selected Walmart report

If a Walmart report column needs special handling, normalize it in the Walmart connector before it reaches the generic P&L engine.

## Reusable Importers

Prefer the generic import framework for new report types.

New report parser checklist:

1. Add parser inside the marketplace connector folder.
2. Implement `detect`.
3. Implement `parse`.
4. Return normalized preview rows, issues, summary, and payload.
5. Reuse an existing committer when possible.
6. Add a new committer only when the report maps to a new kind of normalized data.
7. Document the format in `IMPORT_FORMATS.md`.
8. Add tests when the test framework exists.

Parser rules:

- Detection should be based on headers or report structure, not just filename.
- Validation errors should include row numbers and useful messages.
- Parsed payloads should use generic fields.
- Preview rows should be human-readable.
- File-level duplicate detection should remain in the generic framework.
- Row-level duplicate rules belong in parser or committer logic.

Do not rebuild the UI for each report type. The goal is that adding a Walmart report means writing a parser, not creating a new upload page.

## Prisma Best Practices

Always scope application queries and writes by `organizationId`.

Use:

- `getCurrentOrganization()`
- `getCurrentOrganizationId()`

Follow existing uniqueness rules:

- Product: `organizationId + internalSku`
- Listing: `organizationId + marketplace + sellerSku`
- COGS batch: `organizationId + marketplace + shipmentId`
- Cost record: `organizationId + marketplace + sellerSku + shipmentId + effectiveDate`
- Sales order: `organizationId + marketplace + externalOrderId`

Migration rules:

- Use Prisma migrations for schema changes.
- Keep migrations committed with schema changes.
- Run `pnpm run prisma:generate` after schema changes.
- For Supabase direct connection issues, use documented helper scripts instead of editing production data manually.
- Do not use destructive database cleanup scripts without documenting the purpose and scope.

Data rules:

- Store money as Prisma `Decimal` fields in database models.
- Convert Prisma decimals to numbers only at calculation/display boundaries.
- Store raw marketplace-specific detail in `metadata` when no generic field exists yet.
- Avoid adding marketplace-specific columns to generic tables unless there is a strong cross-marketplace reason.

## TypeScript Standards

- Keep `strict` TypeScript passing.
- Prefer explicit domain types in `src/server/*/types.ts`.
- Avoid `any`.
- Use `unknown` for raw parsed data and narrow it deliberately.
- Keep parser outputs typed.
- Keep server actions small; move reusable logic to `src/server`.
- Keep pure calculation logic separate from database queries.
- Use small helper functions for parsing money, dates, and normalized headers.

When adding a new function:

- Give it a domain-specific name.
- Keep inputs and outputs explicit.
- Avoid hidden global state.
- Return structured results instead of overloaded strings.

## UI Conventions

The app is an operational analytics tool. UI should be quiet, clear, and efficient.

Use:

- Tables for detailed operational data.
- Compact cards for KPIs.
- Forms for filters and imports.
- Tabs/sections only when they reduce scanning effort.
- Lucide icons for navigation and recognizable actions.
- Rounded corners around 6-8px, matching existing components.
- Clear status badges for `PENDING`, `IMPORTED`, `NEEDS_REVIEW`, and `FAILED`.

Avoid:

- Marketing-style landing pages.
- Decorative hero sections.
- Large visual flourishes unrelated to data work.
- Copy that explains obvious UI behavior.
- Nested cards inside cards.
- Marketplace-specific UI assumptions in reusable components.

Labels should match calculations. For example:

- `Gross Profit` means `Sales - marketplace fees - COGS`.
- Ad spend is displayed separately unless a view explicitly says profit after ads.

## Naming Conventions

Use consistent names across the app:

- `marketplace`: lowercase marketplace code, such as `walmart`.
- `sellerSku`: marketplace seller SKU.
- `parentSku`: parent grouping key.
- `internalSku`: internal product identifier.
- `externalOrderId`: marketplace order ID or generated aggregate order ID.
- `externalLineId`: marketplace line ID or generated aggregate line ID.
- `marketplaceItemId`: marketplace item/product ID.
- `importKind`: `sales`, `settlements`, `advertising`, or `inventory`.
- `reportType`: stable parser/report identifier, such as `walmart_item_sales`.
- `reportTypeLabel`: human-readable report label.
- `sourceRow`: original spreadsheet row number.

File naming:

- Use kebab-case for route folders where Next requires route structure.
- Use descriptive lowercase filenames for server modules.
- Keep connector-specific files under the connector folder.

## Testing and Validation

Before finishing code changes, run:

```bash
pnpm run typecheck
pnpm run lint
```

When schema changes are made, run:

```bash
pnpm run prisma:generate
```

When possible, also run:

```bash
pnpm run build
```

Known local caveat:

On this Windows environment, Next.js build or Prisma generation can fail with `EPERM` when worker processes are blocked. If that happens, document the failure and have the user run the command from PowerShell with the required permission approval.

## Documentation Rules

Update documentation when:

- A new report type is supported.
- A parser changes expected columns or validation.
- A database model changes.
- A P&L formula or label changes.
- A legacy path is removed or redirected.
- A new milestone starts or completes.

The docs should stay practical. Prefer clear current behavior and next steps over speculative detail.
