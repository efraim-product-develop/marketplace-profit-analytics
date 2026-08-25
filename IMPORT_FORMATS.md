# Import Formats

This document is the source of truth for supported and planned import formats. Read it before changing parsers, upload pages, or import committers.

## Import System Overview

There are two import paths in the project today:

- Current COGS import path: `/cogs/upload`
- Generic import framework: `/imports/sales`, `/imports/settlements`, `/imports/advertising`, `/imports/inventory`

Direct and legacy advertising upload paths also still exist:

- `/ad-spend/upload`
- `/advertising/upload`

Future work should prefer the generic import framework unless there is a clear reason not to.

`/imports/audit` is the read-only Data Quality / Import Audit. It does not import files and does not reconcile against retired sources. It checks whether the active Walmart P&L period has enough PO, settlement, SEM, Walmart Connect, and COGS data to be trusted.

Authoritative Walmart source rules:

- Sales / GMV / orders / units / order date: Walmart PO reports.
- SKU-to-parent product mapping: Walmart Item Sales reports, mapping only.
- Refunds / marketplace commission / fulfillment fees / other Walmart fees / payout: Walmart settlement reports.
- Seller Center SEM advertising: Seller Center SEM daily campaign reports.
- Walmart Connect advertising: daily Walmart Connect advertising rows only.
- COGS: effective-dated COGS records through `EffectiveCogsService`.

Retired sources must not be used for active P&L or audit completeness:

- Walmart Item Sales financial columns.
- Walmart Overview reports.
- Walmart Item Performance sales sync experiments.
- Settlement `Sale + Product Price` rows.
- PO-to-settlement sales finalization or matching queues.

## Shared Generic Import Framework Rules

For reports handled by `/imports/<kind>`:

- The active global marketplace connector provides report parsers.
- Each parser has a `detect` function.
- The highest scoring parser handles the file.
- The parser returns row previews, validation issues, summary data, and a normalized payload.
- The framework stores an `ImportRun`.
- The framework stores up to 100 preview rows.
- The framework stores row-level issues.
- Duplicate file detection uses SHA-256 file hash plus organization, marketplace, import kind, and report type.
- Duplicate imports are blocked when a matching file was already imported or marked needs review.
- A parser may include a `commit` function. Without a commit function, the report is saved as import history only.

## COGS Upload

Status: implemented through `/cogs/upload`.

### Expected File

- `.xlsx`
- First worksheet is used.
- Header row must include all required columns.

### Required Columns

- `sku`
- `effective_date`
- `unit_cogs`

### Optional Columns

- `parent_sku`
- `product_name`
- `variation_name`
- `shipment_id`
- `inbound_freight_per_unit`
- `prep_cost_per_unit`
- `packaging_cost_per_unit`
- `notes`
- `inbound_freight_per_unit`
- `prep_cost_per_unit`
- `packaging_cost_per_unit`
- `notes`

### Normalization Rules

- Header names are trimmed, lowercased, and normalized so spaces/hyphens become underscores.
- `sku`, `parent_sku`, `product_name`, `variation_name`, `shipment_id`, and `notes` are trimmed strings.
- `effective_date` accepts Excel dates, JavaScript `Date` values, or parseable date strings.
- Money fields accept numbers or strings with `$`, commas, or spaces.
- Blank optional freight, prep, and packaging cost fields default to `0`.
- If `shipment_id` is blank, the import uses `manual-cogs-YYYY-MM-DD` from the effective date.
- `unitCost` is calculated as:

```text
unit_cogs + inbound_freight_per_unit + prep_cost_per_unit + packaging_cost_per_unit
```

### Database Writes

For every valid row:

- Preserve existing parent/listing/product context when optional product fields are blank.
- Create or update the parent product using `parent_sku` when provided.
- Create or update the SKU product using `sku`.
- Create or update the marketplace listing using `marketplace + sku`.
- Create or update the COGS batch using `marketplace + shipment_id`.
- Create or update the cost record using `marketplace + sku + shipment_id + effective_date`.

### Duplicate Detection

Within a workbook:

- Duplicate rows are rejected when they share `sku + effective_date`.

In the database:

- Existing cost history is not overwritten unless the incoming row has the same `organizationId + marketplace + sellerSku + shipmentId + effectiveDate`.
- Matching rows are updated.
- New combinations create new effective-dated history.

### Validation Rules

Rejected when:

- `sku` is blank.
- `effective_date` is invalid.
- `unit_cogs` is blank or invalid.
- Any optional money field is invalid.
- A duplicate `sku + effective_date` appears in the same workbook.
- Marketplace is missing.

### Import History

Stored in:

- `CostUpload`
- `CostUploadIssue`
- `CogsBatch`
- `CostRecord`

### Current COGS Export

The upload page includes a current COGS download. It exports the latest active cost per SKU as an `.xlsx` workbook with:

- `sku`
- `effective_date`
- `unit_cogs`

The exported `unit_cogs` value is the current total unit cost stored for the SKU, so the file can be edited and uploaded again when costs change.

## Walmart PO Reports

Status: implemented through `/imports/sales` as the Walmart sales source.

Walmart PO reports are the sales source of truth for P&L. They provide the true order date, order/SKU context, units, product, fulfillment type, and sales values used for day, week, month, quarter, year, custom, SKU, and parent P&L reporting.

### Expected Files

- `.xlsx` or `.csv`
- Seller Fulfilled PO report
- WFS Fulfilled PO report

Both fulfillment types should normalize into the same marketplace-neutral sales tables.

### Expected Columns

The importer supports the current Walmart `Po Details` export columns:

- `PO#`
- `Line#`
- `Order#`
- `Order Date`
- `UPC`
- `Status`
- `Item Description`
- `Qty`
- `SKU`
- `Item Cost`
- `Shipping Cost`
- `Tax`
- `Discount`
- `Fulfillment Entity`

Alias support is included for clearer names such as Purchase Order #, Purchase Order Line #, Customer Order #, Quantity, Item Price, Unit Price, Price, Product Name, Item ID, and Fulfillment Type.

### Normalization Rules

- PO `Order Date` becomes the permanent `SalesOrder.orderDate`.
- PO rows create or update `SalesOrder` and `SalesOrderItem`.
- PO sales are order-date based.
- PO Gross Sales uses item cost/price multiplied by quantity unless a PO GMV/gross sales field is present.
- Shipping, tax, discount, fulfillment type, raw Walmart status, item ID, product name, original quantity, and original item revenue are preserved directly on the normalized order line for audit. They do not alter PO GMV unless the approved PO sales formula changes.
- PO Gross Sales / GMV calculation:
  - If the report supplies a unit-level product price column (`Item Cost`, `Item Price`, `Unit Price`, or `Price`), Gross Product Sales is `Unit Price x Active Quantity`.
  - If the report supplies an extended line amount column (`Gross Sales`, `Item Revenue`, `Sales`, `PO GMV`, or `GMV`), Gross Product Sales uses that extended amount and does not multiply it by quantity again.
  - Active Quantity is ordered quantity less any explicit cancelled quantity when present. Fully cancelled rows are retained for audit with zero active quantity and zero Gross Sales.
- Customer order number, customer order line number, purchase order number, purchase order line number, fulfillment type, item ID, product name, and Walmart order status are preserved in import preview/history and metadata.
- Rows whose Walmart status contains cancellation language are imported as cancelled audit rows, update any prior copy of the same PO line, and contribute zero GMV, zero units, and zero orders to P&L.
- PO rows do not create refund rows or settlement financial adjustments.
- Displayed Sales is calculated later by P&L as `Gross Sales - settlement product-price Refunds`.
- Do not use alternate Walmart sales-summary or account-summary files as fallback sales sources.

### Import Summary

Every PO import records:

- Rows read.
- Rows imported.
- Rows updated/upserted.
- Rows skipped.
- Cancelled rows.
- Duplicate rows within the uploaded file.
- Missing-SKU rows.
- Total PO GMV from non-cancelled rows.
- Units from non-cancelled rows.
- Unique PO orders from non-cancelled rows.
- Earliest and latest PO order date.
- WFS, seller-fulfilled, and unknown fulfillment breakdown where available.

### Duplicate Detection

Use a deterministic order-line key, expected to be:

```text
organizationId + marketplace + purchaseOrderNumber + purchaseOrderLineNumber
```

`SalesOrder.externalOrderId` stores the PO number and `SalesOrderItem.externalLineId` stores the PO line number. Explicit PO/customer-order fields are also stored on `SalesOrderItem`. Re-uploading the same PO line updates the existing order line instead of creating a duplicate.

### Validation Rules

Reject or flag rows when:

- Order ID is blank.
- Order Date is invalid.
- SKU is blank.
- Quantity is blank, zero, or invalid on a non-cancelled row.
- Sales amount is invalid on a non-cancelled row.
- Status indicates a cancelled row, which is preserved for audit but excluded from sales totals.
- A duplicate `PO# + Line#` appears in the same file.

## Walmart Item Sales - Product Mapping Only

Status: implemented through `/imports/inventory` as SKU-to-parent mapping only.

This importer exists only to maintain Walmart product hierarchy. It does not create sales rows, daily totals, fees, refunds, ad spend, or P&L values.

### Expected Files

- `.xlsx`, `.xls`, or `.csv`
- Walmart Item Sales report export

### Fields Used

The importer reads only these mapping/catalog fields:

- `SKU`, `SKU ID`, `Seller SKU`, `Partner SKU`, or `Item SKU` -> child SKU
- `Base Item ID`, `Parent SKU`, `Parent Item ID`, `Parent Item`, `Variant Group ID`, or `Group ID` -> parent identifier
- `Item ID` or `Walmart Item ID` -> marketplace item ID when available
- `Item Name`, `Product Name`, or `Description` -> listing/product title when available
- `Brand` -> product brand when available
- `Department` -> preview/import-history metadata only because there is not yet a dedicated catalog department column

### Financial Fields Ignored

The importer deliberately ignores Item Sales financial/operational fields, including:

- `GMV`
- `Units Sold`
- `Orders`
- `Auth Sales`
- `Cancelled Sales`
- `Refund Sales`
- `GMV Minus Commission`
- `AUR`

These values are not stored as P&L sales, not used for date filtering, and not used as reconciliation fallbacks.

### Normalization Rules

- SKU and parent identifiers are normalized with the shared marketplace SKU helper: trim, remove hidden formatting characters, collapse whitespace, and uppercase.
- One row maps one child SKU to one parent identifier.
- Parent records are represented as `Product.internalSku = parent identifier`.
- Child SKU records are represented as `Product.internalSku = SKU` with `Product.parentSku = parent identifier`.
- Marketplace listings are represented as `Listing.sellerSku = SKU` with `Listing.parentSku = parent identifier`.
- If PO data already created the SKU, the existing `Product` and `Listing` are updated rather than duplicated.
- Historical PO transactions are not rewritten. Parent P&L resolves the current catalog/listing parent mapping when it aggregates child SKU rows.

### Duplicate Detection

Within a file:

- The first mapping for a SKU is used.
- Later rows for the same normalized SKU are skipped with a duplicate mapping warning.

In the database:

- Re-uploading the same file is allowed and idempotent.
- Existing `Product` and `Listing` rows are updated using normalized SKU and parent identifiers.
- No duplicate SKUs or parent products are created because `Product` and `Listing` uniqueness rules are reused.

### Validation Rules

Rejected when:

- SKU is blank.
- Parent identifier is blank.

Skipped when:

- The row is blank.
- The row appears to be a total or summary row.
- The normalized SKU already appeared earlier in the same file.

### P&L Behavior

- SKU P&L continues to use PO sales and approved financial sources.
- Parent P&L groups child SKU results using the current catalog/listing parent mapping.
- Item Sales financial values never enter P&L.

## Walmart Payments New Settlement Report

Status: implemented through `/imports/settlements` as a separate Walmart financial source.

Settlement reports do not provide the P&L sales source. They provide refunds, marketplace commission, fulfillment fees, other Walmart fees and adjustments, and payout context. Seller Center SEM is intentionally excluded from settlement imports because SEM comes from `/imports/advertising`.

Rules:

- Settlement `Sale + Product Price` rows are skipped for P&L sales so they cannot double-count PO sales.
- Marketplace commission rows are stored as `MarketplaceFee` with `feeType = commission`.
- WFS fulfillment fee rows are stored as `MarketplaceFee` with `feeType = fulfillment_fee`.
- Storage, return processing, adjustments, credits, and other non-order settlement fees are stored as standalone `MarketplaceFee` adjustments.
- Seller Center SEM rows are skipped from active P&L and reported in import summary as excluded SEM rows.
- Only `Transaction Type = Refund` and `Amount Type = Product Price` rows are stored as standalone `Refund` rows.
- `Transaction Posted Timestamp` is the reporting date for settlement financial rows. Payout-period dates are retained only as audit metadata.
- `PaymentSummary` total payable is saved in import history for payout context.
- Settlement rows remain separate from PO sales rows. There is no PO-to-settlement sales matching or finalization workflow.

## Retired Walmart Sales Sources

Status: unsupported for P&L and removed from the normal sales workflow.

The following sales-source paths are intentionally retired:

- Walmart account-summary reports.
- Separate monthly sales-summary reports.
- Alternate sales performance summary reports.
- Reconciliation pages that compare competing sales totals.

Retired sales files should not be uploaded through `/imports/sales`, should not create dashboard sales, and should not be used as fallbacks. PO reports are the Walmart sales source. Walmart Item Sales is supported only through `/imports/inventory` for SKU-to-parent mapping.

## Walmart Connect Advertising Upload

Status: implemented through `/ad-spend/upload`.

This importer is for daily Walmart Connect Item Performance reports. Seller Center SEM spend uses the separate `/imports/advertising` SEM report importer instead of settlement rows.

### Expected File

- `.csv`, `.xlsx`, or `.xls`
- First worksheet is used for workbooks.
- Header row must include all required columns or supported aliases.

### Walmart Connect Item Performance Columns

Required:

- `SKU ID`
- `Ad Spend`

Optional:

- `Date`
- `Item ID`
- `Item Name`
- `Campaign Name`
- `Campaign Type`
- `Clicks`
- `Impressions`
- `Orders`
- `Total Attributed Sales`
- `Units Sold`
- `Average CPC`
- `ROAS`

### Walmart Connect Column Mapping

- `SKU ID` -> `sku`
- `Date` -> `costDate`
- `Item ID` -> `itemId`
- `Item Name` -> `itemName`
- `Campaign Name` -> `campaignName`
- `Campaign Type` -> `campaignType`
- `Ad Spend` -> `spend`
- `Clicks` -> `clicks`
- `Impressions` -> `impressions`
- `Orders` -> `attributedOrders`
- `Total Attributed Sales` -> `attributedSales`
- `Units Sold` -> `attributedUnits`
- `Average CPC` -> `averageCpc`
- `ROAS` -> `roas`

### Normalization Rules

- Header names are trimmed, lowercased, and normalized so spaces/hyphens become underscores.
- SKU, item fields, and campaign fields are trimmed strings.
- Rows with blank `SKU ID` are imported as unassigned Walmart Connect ad spend when they have non-zero spend. This is expected for some Sponsored Video and Sponsored Brands rows.
- The upload page requires a selected reporting period with From and To dates.
- If the report includes `Date`, each row uses its own daily date and rows outside the selected reporting period are skipped.
- If the report does not include `Date`, the selected period must be one day; that day becomes the row `costDate`.
- `reportMonth` is derived from `Date` as `YYYY-MM` for filtering and audit metadata only.
- `Ad Spend`, attributed sales, average CPC, and ROAS accept numbers or strings with `$`, `%`, commas, or spaces.
- Blank clicks, impressions, orders, units, attributed sales, average CPC, and ROAS default to `0`.
- Currency defaults to `USD`.
- Rows are stored as `AdvertisingCost`.
- `source` is always `walmart_connect_item_performance`.
- Item ID, item name, campaign type, clicks, impressions, attributed orders, attributed sales, attributed units, average CPC, ROAS, report date, report month, daily grain, original file name, source row, and duplicate key are stored in `metadata`.
- The importer tries to attach `parentSku` from existing listings/products for Parent P&L rollups.
- The preview shows the first 50 valid rows.

### Duplicate Detection

Within a file:

- Walmart Connect duplicate rows are combined when they share `reportDate + sku + campaignName + itemId`.
- Combined duplicate rows sum spend, clicks, impressions, attributed orders, attributed sales, and attributed units. Average CPC and ROAS are recalculated from the combined totals.

In the database:

- Walmart Connect rows are updated instead of duplicated when they share `organizationId + marketplace + source + reportDate + sku + campaignName + itemId`.
- New combinations create new `AdvertisingCost` rows.

### Validation Rules

Skipped when:

- `Ad Spend` is blank or `0`.
- The row date is outside the selected reporting period.

Rejected when:

- The selected reporting period is invalid.
- The selected reporting period spans multiple days and the report has no row-level `Date`.

Rejected when:

- Date is missing or invalid.
- Clicks or impressions are present but are not valid non-negative whole numbers.
- Orders or Units Sold are present but are not valid non-negative whole numbers.
- Total Attributed Sales, Average CPC, or ROAS is present but cannot be parsed.
- Marketplace is missing.

### P&L Behavior

- Overall Marketplace P&L can display Walmart Connect Advertising and Seller Center SEM separately.
- SKU/Parent product P&L subtracts only SKU-attributed Walmart Connect advertising. Seller Center SEM is campaign-level and remains marketplace-level.
- The P&L engine includes `AdvertisingCost` rows from `walmart_connect_item_performance`, `walmart_seller_center_sem`, and legacy `seller_center_sem` rows without knowing report formats.
- Walmart Connect daily ad rows are included by actual `costDate` for day, week, custom, and monthly P&L.
- Older monthly/cumulative Walmart Connect rows are ignored by P&L so cumulative uploads cannot inflate month, week, day, or custom reports.
- Seller Center SEM spend comes from the separate SEM report importer, not Walmart settlement rows.

## Walmart Seller Center SEM Campaign Daily Report

Status: implemented through `/imports/advertising`.

This importer supports the Walmart Seller Center `CAMPAIGN_LEVEL_DAILY_REPORT` export. The current report is campaign-level, not SKU-level, so SEM spend is stored at marketplace/campaign level and appears in P&L as Seller Center SEM Advertising without parent/SKU attribution.

### Expected Columns

Required:

- `Date`
- `Campaign Name`
- `Campaign ID`
- `Impressions`
- `Clicks`
- `Spend`
- `Sales`

Optional:

- `Average CTR`
- `ROAS`

### Normalization Rules

- `Date` becomes `AdvertisingCost.costDate`.
- `Spend` becomes `AdvertisingCost.amount`.
- `Sales` is stored as attributed sales in metadata.
- `Campaign ID` and `Campaign Name` are stored in first-class campaign fields and metadata.
- `Impressions`, `Clicks`, `Average CTR`, and `ROAS` are stored in metadata.
- `sellerSku` and `parentSku` are intentionally null because this report has no SKU column.
- `source` is always `walmart_seller_center_sem`.
- CSV/XLSX rows are parsed once, validated in memory, previewed, and written in chunks.

### Duplicate Detection

Row-level upsert key:

- `organizationId + marketplace + source + Date + Campaign ID`

If Campaign ID is unavailable in a future variant, campaign name can be used as the fallback natural key after parser validation is updated. Re-uploading the same file is allowed and updates matching campaign/day rows instead of creating duplicate ad spend.

### Validation Rules

Skipped when:

- The row is blank.
- `Spend` is blank or `0`.
- A duplicate campaign/date row appears inside the same file; duplicate rows are aggregated into one imported row.

Rejected when:

- `Date` is missing or invalid.
- `Campaign Name` is blank.
- `Campaign ID` is blank.
- `Spend` is invalid.
- `Impressions`, `Clicks`, `Average CTR`, `Sales`, or `ROAS` is present but cannot be parsed.

## Current Legacy Advertising Upload

Status: implemented through `/advertising/upload`, but legacy. Seller Center SEM should now use `/imports/advertising`; Walmart Connect should use `/ad-spend/upload`.

### Expected Columns

Required:

- `date` or `cost date` or `spend date` or `campaign date`
- `amount` or `spend` or `ad spend` or `sem spend` or `cost`
- `seller sku` or `parent sku`

Optional:

- `campaign id`
- `campaign name`
- `currency`

### Normalization Rules

- Date is parsed from Excel date, JavaScript date, or parseable string.
- Amount is parsed as money.
- Seller SKU and parent SKU are trimmed strings.
- Currency defaults to `USD`.
- Rows are saved as `AdvertisingCost`.
- `source` is always `seller_center_sem`.

### Duplicate Detection

- No duplicate blocking exists for the legacy advertising upload path.
- Do not use `/imports/settlements` with Walmart Payments New reports for Seller Center SEM imports.
- The generic `/imports/advertising` Seller Center SEM path uses import history plus row-level update behavior.

### Validation Rules

Rejected when:

- Cost date is missing or invalid.
- Amount is missing or invalid.
- Both seller SKU and parent SKU are missing.

## Walmart Payments New Settlement Report

Status: implemented through `/imports/settlements`.

### Expected Columns

Required for detection and import:

- `Period Start Date`
- `Period End Date`
- `Transaction Posted Timestamp`
- `Transaction Type`
- `Transaction Description`
- `Purchase Order #`
- `Purchase Order line #`
- `Amount`
- `Amount Type`
- `Partner Item Id`
- `Partner Item Name`
- `Currency`
- `Fulfillment Type`
- `Fulfillment Details`

### Normalization Rules

- `Transaction Posted Timestamp` becomes the reporting date for refund and fee rows.
- `Period Start Date` and `Period End Date` are stored in audit metadata only and do not drive day/week/custom P&L allocation when a transaction posted timestamp exists.
- If a transaction row is missing period dates, the importer still records whether the payout period was inherited from `PaymentSummary`, but this is audit context rather than active allocation logic.
- Metadata stores `periodDateSource` as `row`, `payment_summary`, or `missing` so diagnostics can distinguish row-level dates from inherited payout-period dates.
- `Partner Item Id` becomes seller SKU when available.
- `Purchase Order #`, `Purchase Order line #`, `Customer Order #`, and `Customer Order line #` are stored in metadata for audit.
- `Sale + Product Price` rows are skipped for P&L sales. PO reports remain the only Walmart sales source.
- Settlement-derived fee rows store `amountSignConvention = negative_expense_positive_credit` in metadata. In P&L, negative settlement amounts are expenses and positive settlement amounts are credits/reimbursements.
- `WFS Fulfillment fee` becomes `MarketplaceFee.feeType = "fulfillment_fee"`.
- `Refund + Product Price` rows become standalone `Refund` rows and are not included in Other Walmart Fees & Adjustments.
- Refunded shipping and Walmart return shipping charge rows are classified as marketplace-level Other Walmart Fees & Adjustments, not product-price refunds.
- `WFS Refund` inventory reimbursement rows are classified as `adjustment` credits and shown inside Other Walmart Fees & Adjustments with credit direction.
- WFS return processing and return shipping fees become `return_fee`.
- WFS storage and long-term storage fees become `storage_fee`.
- WFS inventory transfer, inbound transportation, prep service, inventory disposal, review accelerator, and item-fee rows become `other_fee`.
- Lost/found/damaged inventory, WFS refunds, excess refund adjustments, and WFS inventory fee/reimbursement rows become `adjustment`.
- Classified Other Walmart Fees & Adjustments store `classificationStatus`, `financialDirection`, `adjustmentCategory`, `adjustmentCategoryLabel`, `attributionScope`, and `productAttributionReliable` in metadata.
- Unknown non-tax financial rows are marked `unsupported` in the import summary and excluded from active profit until mapped.
- `SEM Marketing Fee` is excluded from active P&L in settlement imports. Seller Center SEM comes from `/imports/advertising`.
- `Commission on Product` becomes `MarketplaceFee.feeType = "commission"` as a settlement-derived financial row.
- Tax rows are ignored for this application's P&L and are not included in sales, refunds, commission, fulfillment, other fees, advertising, or profit.
- Non-refund product price rows are ignored because PO reports are the Walmart sales source. Promo, extra savings, and Walmart-funded savings rows are unsupported until their seller financial effect is intentionally mapped.
- `PaymentSummary.Total Payable` becomes the settlement payout/payable amount in `SettlementPayout`.
- `PaymentSummary.Period Start Date` and `PaymentSummary.Period End Date` become the payout settlement period.
- Payout date is stored only when the report contains an explicit payout/payment/deposit date field. The PaymentSummary transaction posted timestamp is retained as metadata, not treated as payout date by default.

### Duplicate Detection

Generic file-level duplicate detection:

- `organizationId + marketplace + importKind + reportType + fileHash`

Within a file:

- Duplicate settlement rows are skipped when they share transaction key, posted date, transaction type, amount type, transaction description, order ID, order line ID, seller SKU, and amount.
- Settlement payout rows upsert by `organizationId + marketplace + settlementReference`. The reference uses a PaymentSummary transaction key when present, otherwise payout period + currency + payable amount, with filename used only when the period is missing.

### Validation Rules

Skipped when:

- Transaction type or amount type is blank.
- Amount is blank or invalid.
- Posted date is blank or invalid.
- Row is tax or another ignored amount type.
- Row is promo, Walmart-funded savings, or another unsupported financial category that has not yet been deliberately mapped.
- Row cannot be mapped to a supported refund or fee category.
- Row is settlement SEM, which is intentionally excluded from this importer.

### P&L Behavior

- Settlement sale/product rows are skipped for P&L sales.
- Marketplace commission and WFS fulfillment fees are standalone settlement-derived `MarketplaceFee` records.
- Storage, return processing, refunded shipping, WFS inventory, adjustments, credits, and other classified non-order settlement fees remain standalone marketplace-level `MarketplaceFee` adjustments.
- Settlement fee signs are respected: negative rows increase fees, positive rows reduce fees.
- Settlement product-price refund rows are standalone `Refund` rows. They do not appear in Other Walmart Fees & Adjustments.
- Settlement product-price refund rows reduce displayed Sales in the period of their `Transaction Posted Timestamp`; they are not subtracted again from Profit.
- Unsupported financial rows are counted in import history and excluded from profit.
- Seller Center SEM rows are not imported from settlements and do not create `AdvertisingCost` rows.
- Day, week, month, quarter, year, and custom P&L ranges filter settlement financial rows by `Transaction Posted Timestamp`.
- Settlement totals are not evenly allocated across payout days when an actual transaction posted timestamp exists.
- PO report rows are the sales source. Settlement rows remain separate financial inputs.
- Settlement Payout is a separate cash-flow metric and is not included in Profit.

## Future Settlement Reports

Status: planned for additional marketplace or Walmart settlement formats.

Future settlement parsers should follow the same rule: normalize rows into generic fee, refund, adjustment, or advertising models before P&L uses them.

## Future Advertising Reports

Status: planned for additional Walmart or marketplace advertising report types. Direct `/ad-spend/upload` currently imports Walmart Connect spend, and `/imports/advertising` imports Walmart Seller Center SEM.

### Expected Columns

Future generic advertising parsers should support:

- date
- marketplace
- seller SKU
- parent SKU
- campaign ID
- campaign name
- ad group ID
- ad group name
- impressions
- clicks
- spend
- attributed sales
- attributed units
- currency

Minimum viable required columns:

- date
- spend
- seller SKU or parent SKU

### Normalization Rules

Future parser should normalize to `AdvertisingCost` rows:

- `marketplace`
- `source`, initially `seller_center_sem`
- `sellerSku`
- `parentSku`
- `campaignId`
- `campaignName`
- `costDate`
- `amount`
- `currency`
- `metadata`

Performance metrics such as impressions, clicks, attributed sales, and attributed units should go into metadata until dedicated ad performance models exist.

### Duplicate Detection

Generic file-level duplicate detection:

- `organizationId + marketplace + importKind + reportType + fileHash`

Recommended row-level duplicate key:

- `organizationId + marketplace + source + costDate + sellerSku + parentSku + campaignId + amount`

### Validation Rules

Future parser should reject rows when:

- Cost date is missing or invalid.
- Spend amount is missing or invalid.
- Both seller SKU and parent SKU are missing.
- Currency is missing and cannot default safely.

### P&L Behavior

Advertising reports should reduce product Profit and be displayed as a separate cost category. Current UI labels Profit as:

```text
Daily sales GMV - marketplace commission - fulfillment fees - COGS - ad spend
```

Additional fee categories such as storage, returns, shipping, adjustments, and other fees may still exist internally, but the main UI should stay focused on the primary profitability categories.

## Future Inventory Reports

Status: scaffolded through `/imports/inventory`, but no parser or committer is implemented yet.

Inventory reports should eventually normalize:

- seller SKU
- parent SKU
- marketplace item ID
- available quantity
- reserved quantity
- inbound quantity
- fulfillment channel
- report date
- warehouse/node when available
- metadata

Inventory data should not be mixed into P&L math until explicit inventory valuation behavior is designed.
