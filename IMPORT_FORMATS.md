# Import Formats

This document is the source of truth for supported and planned import formats. Read it before changing parsers, upload pages, or import committers.

## Import System Overview

There are two import paths in the project today:

- Current COGS import path: `/cogs/upload`
- Generic import framework: `/imports/sales`, `/imports/settlements`, `/imports/advertising`, `/imports/inventory`

Direct and legacy upload paths also still exist:

- `/sales/upload`
- `/ad-spend/upload`
- `/advertising/upload`

Future work should prefer the generic import framework unless there is a clear reason not to.

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

## Walmart Daily Item Sales Report

Status: active through `/imports/sales`.

Daily Walmart Item Sales Reports are the sales source of truth for P&L. Upload one Item Sales report per calendar day. Month, week, quarter, and custom ranges are calculated by summing imported daily Item Sales rows whose report dates fall inside the selected range.

### Expected File

- `.csv`, `.xlsx`, or workbook-readable file.
- Detected when headers include:
  - `Item Name`
  - `SKU`
  - `GMV`
  - `Units Sold`
  - `Orders`

Detection and row parsing normalize headers by lowercasing and treating underscores/hyphens/spaces as equivalent. For example, `Units Sold`, `Units_Sold`, and `units-sold` are treated as the same column.

### Important Columns

Required for import:

- `SKU`
- `Item_id`
- `GMV` greater than zero
- `Units_Sold` greater than zero

Required by detection:

- `Item Name`
- `SKU`
- `GMV`
- `Units Sold`
- `Orders`

Required outside the file:

- `reportDate` from the upload form, formatted as `YYYY-MM-DD`.

Saved when present:

- `Item_Name`
- `Base_Item_Id`
- `Brand`
- `Department`
- `Orders`
- `AUR`
- `GMV_Minus_Commission`
- `Auth_Sales`
- `Cancelled_Sales`
- `Refund_Sales`

### Normalization Rules

- `SKU` becomes `sellerSku`.
- `Base_Item_Id` becomes `parentSku`.
- `Item_Name` becomes product/listing title.
- `Brand` becomes product brand.
- `Item_id` becomes marketplace item ID.
- `GMV` becomes `itemRevenue`.
- `Units_Sold` becomes quantity.
- `AUR` becomes unit price when present; otherwise unit price is `GMV / Units_Sold`.
- `GMV_Minus_Commission` is retained as audit metadata. It does not create a commission fee row because marketplace commission should come from Walmart Payments New settlement reports.
- Each row is imported as a daily aggregate sales line.
- If Walmart repeats the same `reportDate + SKU + Item_id` inside one file, those rows are aggregated into one daily sales line instead of being skipped. GMV, units, orders, auth sales, cancelled sales, refund sales, and GMV minus commission are summed; AUR is recalculated from total GMV divided by total units.
- `orderDate` is the selected report date.
- `status` is `daily_summary`.
- The optimized payload only keeps the useful normalized fields listed above plus `reportDate`, `reportMonth`, and `marketplace = walmart`.
- Item Sales row issues store row numbers and reasons without saving full raw source rows.
- Rows are validated in memory before commit.
- The preview shows only the first 50 valid rows.
- Summary data includes total rows read, skipped rows, valid rows, rows to import, skipped blank rows, skipped zero-sales rows, skipped missing item ID rows, skipped summary rows, skipped invalid numeric rows, aggregated duplicate rows, aggregated duplicate groups, imported rows, updated rows, and errors.

### Duplicate Detection

Generic import framework:

- Blocks duplicate committed files by file hash, organization, marketplace, import kind, and report type.
- Parser fixes may define a new duplicate version. The Walmart Item Sales parser currently uses `walmart-item-sales-daily-v3`, allowing files imported before daily report-date support to be reprocessed once with the corrected parser.

Sales commit:

- Sales orders are unique by `organizationId + marketplace + externalOrderId`.
- The generated Item Sales external order ID is based on `reportDate + SKU + Item_id`.
- The logical row duplicate key is `organizationId + marketplace + reportDate + sku + itemId`.
- Matching rows are updated during commit instead of creating duplicates.
- Repeated rows inside the same file are aggregated by the same `reportDate + SKU + Item_id` key before commit, because Walmart can split a single logical SKU/item day into multiple rows that still count toward Sales Insights GMV.
- Database writes are batched in chunks of up to 1,000 rows.
- Product/listing creation uses batch inserts where possible; sales orders are batch-updated/created, then items and zero-dollar metadata marker rows are recreated for matching daily summary rows.

### Validation Rules

Skipped when:

- Report date is missing or invalid.
- `SKU` is blank.
- `Item_id` is blank.
- `GMV` is blank, zero, or invalid.
- `Units_Sold` is blank, zero, or invalid.
- The row appears to be a total, subtotal, summary, or grand total row.
- Any saved numeric field is present but cannot be parsed.

Blank, zero-sales, missing-item-ID, and summary rows are stored as warning issues. Invalid numeric rows and missing report date are stored as error issues. Repeated `reportDate + SKU + Item_id` rows are valid rows and are aggregated, not rejected.

### P&L Behavior

- Daily Item Sales rows are the sales source for all day, week, month, quarter, year, and custom P&L ranges.
- PO/order reports are audit-only for P&L sales and are not mixed into dashboard GMV.
- Product catalog / SKU mapping can be enriched by Item Sales parent, brand, department, item ID, and item name fields.

## Walmart Overview Report

Status: unsupported.

Overview reports are no longer part of the import or reconciliation workflow. They do not include SKU-level sales detail, and the application uses Walmart daily Item Sales reports as the sales source for P&L.

If an Overview file is uploaded, the Walmart sales connector returns an unsupported-file message and does not save `MarketplaceDailyTotal` rows.

Use these reports instead:

- Walmart daily Item Sales reports for sales, units, orders, SKU rollups, and day/week/month/quarter/custom ranges.
- Walmart Seller Fulfilled/WFS order reports for optional order-level audit detail.
- Walmart Payments New settlement reports for settlement-derived fees and Seller Center SEM.

## Walmart Order Report

Status: implemented through `/imports/sales` and direct `/sales/upload`.

This importer supports Walmart Seller Center order exports for both Seller Fulfilled and WFS-style reports.

### Expected File

- `.xlsx`, `.xls`, or workbook-readable CSV
- Parser prefers the `Po Details` worksheet when present.
- Detected when the file has usable aliases for order ID, order date, SKU, quantity, and price.

### Important Columns

Required:

- `Order ID`, `PO#`, `Order#`, `Purchase Order ID`, or `Customer Order ID`
- `Order Date`
- `SKU`
- `Qty` or `Quantity`
- `Item Cost`, `Price`, `Item Price`, `Unit Price`, or another supported sales/line-total field

Optional but used when present:

- `Customer Order ID`
- `Line#`
- `Shipping` or `Shipping Cost`
- `Tax`
- `Refunds`, `Refund`, or `Refund Amount`
- `Discount`
- `Original Referral Fee`
- `Reduced Referral Fee Discount`
- `Item Description`
- `Fulfillment Entity`
- `UPC`
- `Condition`
- `Shipping Method`
- `Shipping Tier`
- `Carrier`
- `Replacement Order`
- `Original Customer Order Id`
- `Ship Node ID`
- `Ship Node`

### Normalization Rules

- `Order ID`, `PO#`, `Order#`, or purchase order ID becomes `externalOrderId`.
- `Customer Order ID` is stored in metadata and can be used as a fallback order ID.
- `Order Date` becomes `orderDate`.
- `SKU` becomes `sellerSku`.
- `Qty` or `Quantity` becomes quantity.
- `Item Cost` is treated as the unit item price for Walmart PO exports.
- PO/order line sales are calculated as:

```text
Item Cost x Qty
```

- Other line-total fields such as `Item Total`, `Line Total`, `Gross Sales`, `Product Sales`, `Item Revenue`, or `Line Amount` become `itemRevenue` directly when present.
- Unit-price fields such as `Price`, `Item Price`, or `Unit Price` become `unitPrice`, with `itemRevenue = unitPrice * quantity`.
- `Shipping Cost` becomes `shippingRevenue`.
- `Tax` becomes `taxCollected`.
- `Refunds` becomes refund sales stored as a generic `Refund` row linked to the imported order line.
- `Discount` is stored as an absolute discount amount for audit, but the core PO sales formula does not subtract it.
- `Original Referral Fee - Reduced Referral Fee Discount` becomes referral fee when positive.
- Referral fee is stored as a negative marketplace fee.
- Canceled rows are skipped.
- If a report month is selected, rows outside that month are skipped.
- Status is stored on the order.
- Missing SKU products and marketplace listings are created or updated during commit.

### Duplicate Detection

Generic import framework:

- Blocks duplicate committed files by file hash, organization, marketplace, import kind, and report type.

Sales commit:

- Orders are upserted by `organizationId + marketplace + externalOrderId`.
- Existing imported order lines and fees for matching orders are replaced during commit.
- Existing refunds for matching orders are replaced during commit.
- Duplicate rows inside one report are skipped when they share the same order plus line ID, or the same order plus SKU when no line ID exists.
- Direct `/sales/upload` replaces matching lines by `organizationId + marketplace + externalOrderId + sellerSku`.

### Validation Rules

Rejected when:

- Order ID and Customer Order ID are both missing.
- `Order Date` is missing or invalid.
- `SKU` is blank.
- Quantity is missing, invalid, or less than or equal to zero.
- Price or line total is missing or invalid.

Duplicate order lines are skipped with a warning.

## Direct Sales / Order Upload

Status: implemented through `/sales/upload`.

Purpose:

- Upload marketplace sales/order exports.
- Preview parsed rows before saving.
- Commit normalized data into marketplace-neutral order tables.
- Create missing SKU products/listings.
- Link SKU products to parent products when parent SKU data is present.
- Store fees as `MarketplaceFee`.
- Store refunds as `Refund`.

### Expected Columns

Required normalized fields:

- `marketplace`
- `externalOrderId`
- `orderDate`
- `sku`
- `quantity`
- `itemPrice` or `grossSales`

Optional normalized fields:

- `externalOrderLineId`
- `parentSku`
- `productName`
- `brand`
- `marketplaceItemId`
- `shippingRevenue`
- `taxCollected`
- `discountAmount`
- `orderStatus`
- `currency`

Accepted generic column aliases include:

- `order id`, `external order id`, `purchase order id`, `order number`
- `line id`, `line number`, `order line id`
- `order date`, `purchase date`, `date`
- `sku`, `seller sku`, `partner sku`, `item sku`
- `quantity`, `qty`, `units`
- `item price`, `unit price`, `price`
- `gross sales`, `item revenue`, `sales`, `product sales`, `item total`

Optional:

- `parent sku`
- `product name`
- `item description`
- `brand`
- `marketplace item id`
- `shipping revenue`
- `tax collected`
- `discount amount`
- `currency`
- `status` or `order status`

Walmart direct upload aliases include:

- `PO#` or `Order#` as order ID.
- `Line#` as line ID.
- `Order Date` as order date.
- `SKU` as SKU.
- `Qty` as quantity.
- `Item Cost` as item price, with gross sales calculated as `Item Cost x Qty`.
- `Shipping Cost` as shipping revenue.
- `Tax` as tax collected.
- `Discount` as discount amount.
- `Status` as order status.
- `Item Description` as product name.
- `UPC` as marketplace item ID.

### Normalization Rules

- Header aliases are normalized by lowercasing and treating underscores/hyphens/spaces as equivalent.
- `.xlsx`, `.xls`, and `.csv` are read through the workbook parser.
- Walmart uploads prefer the `Po Details` worksheet when present.
- `grossSales` can be derived from `itemPrice * quantity`.
- For Walmart PO uploads, `Item Cost` is treated as item price. The core sales formula is `Item Cost x Qty`.
- `itemPrice` can be derived from `grossSales / quantity`.
- `discountAmount` is stored as a positive discount value.
- Currency defaults to `USD`.
- The preview shows the first 50 valid rows.

Fee fields when present:

- `marketplaceFee`
- `fulfillmentFee`
- `shippingFee`
- `storageFee`
- `returnFee`
- `adjustmentAmount`

Fee normalization:

- Marketplace, fulfillment, shipping, storage, and return fees are stored as negative `MarketplaceFee` amounts.
- Adjustment amounts preserve their sign.
- Walmart `Original Referral Fee` maps to `marketplace_fee`.
- Walmart `Reduced Referral Fee Discount` maps to `adjustment`.

Refund fields when present:

- `refundAmount`
- `refundDate`

Refund normalization:

- `refundAmount` is stored as a positive amount in `Refund` and reduces displayed Sales / GMV.
- `refundDate` defaults to order date when refund amount exists and no refund date is provided.

### Duplicate Detection

- Rows are committed by `organizationId + marketplace + externalOrderId + sku`.
- If a matching order/SKU line already exists, the old line, fees, and refunds are replaced.
- Duplicate `externalOrderId + sku` rows inside the same upload are skipped with a warning.
- The generic import framework file-hash duplicate blocking does not apply to `/sales/upload`.

### Validation Rules

Rejected when:

- Order ID is missing.
- Order date is missing or invalid.
- SKU is missing.
- Quantity is missing, invalid, or less than or equal to zero.
- Both gross sales and item price are missing.
- Any present money field cannot be parsed.
- Refund date is present but invalid.

## Walmart Connect Advertising Upload

Status: implemented through `/ad-spend/upload`.

This importer is for daily Walmart Connect Item Performance reports. Seller Center SEM spend should be imported from Walmart Payments New settlement reports instead.

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

- Walmart Connect Advertising and SEM Advertising are displayed separately in P&L.
- Product Profit subtracts both Walmart Connect and SEM advertising.
- The P&L engine includes `AdvertisingCost` rows from `walmart_connect_item_performance`, settlement-imported `walmart_seller_center_sem`, and legacy `seller_center_sem` rows without knowing report formats.
- Walmart Connect daily ad rows are included by actual `costDate` for day, week, custom, and monthly P&L.
- Older monthly/cumulative Walmart Connect rows are ignored by P&L so cumulative uploads cannot inflate month, week, day, or custom reports.
- New Seller Center SEM spend should come from Walmart Payments New settlement rows with `Amount Type = SEM Marketing Fee`.

## Current Legacy Advertising Upload

Status: implemented through `/advertising/upload`, but legacy. New Seller Center SEM spend should be imported from Walmart Payments New settlement reports. Generic `/imports/advertising` is scaffolded but does not yet have a parser/committer.

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
- Use `/imports/settlements` with Walmart Payments New reports for Seller Center SEM imports.
- Future generic advertising import should use `ImportRun` file hash duplicate detection and a row-level natural key.

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

- `Transaction Posted Timestamp` becomes the fee/ad posted date and remains available for audit and fallback reporting.
- `Period Start Date` and `Period End Date` are stored in row metadata as the actual settlement payout period.
- If a transaction row is missing period dates, the importer inherits the overall payout period from the file's `PaymentSummary` row when that row provides `Period Start Date` and `Period End Date`.
- Metadata stores `periodDateSource` as `row`, `payment_summary`, or `missing` so diagnostics can distinguish row-level dates from inherited payout-period dates.
- `Partner Item Id` becomes seller SKU when available.
- `Purchase Order #` and `Purchase Order line #` are stored in metadata for audit.
- Rows are normalized into generic `MarketplaceFee` or `AdvertisingCost`; raw settlement rows are not used directly by the P&L engine.
- Settlement-derived fee rows store `amountSignConvention = negative_expense_positive_credit` in metadata. In P&L, negative settlement amounts are expenses and positive settlement amounts are credits/reimbursements.
- `WFS Fulfillment fee` becomes `MarketplaceFee.feeType = "fulfillment_fee"`.
- Negative refund transaction rows such as product-price refunds and refunded shipping become standalone `Refund` rows and reduce displayed Sales / GMV.
- Return processing and Walmart return shipping charge rows remain settlement fees.
- `WFS Refund` inventory reimbursement rows are classified as `adjustment` credits, not `other_fee`, so they do not inflate Other Settlement Fees.
- WFS return processing and return shipping fees become `return_fee`.
- WFS storage and long-term storage fees become `storage_fee`.
- Lost/found/damaged inventory, WFS refunds, and refund adjustments become `adjustment`.
- WFS inbound, prep, review, item fee, and unclassified fee/reimbursement rows become `other_fee`.
- `SEM Marketing Fee` becomes `AdvertisingCost` with `source = "walmart_seller_center_sem"`.
- `Commission on Product` becomes `MarketplaceFee.feeType = "commission"` and is allocated by settlement period for day/week/custom reporting.
- Non-refund product price, product tax, tax withheld, promo, extra savings, and Walmart-funded savings rows are skipped for product profitability.

### Duplicate Detection

Generic file-level duplicate detection:

- `organizationId + marketplace + importKind + reportType + fileHash`

Within a file:

- Duplicate settlement rows are skipped when they share posted date, transaction type, amount type, transaction description, order ID, order line ID, seller SKU, and amount.

### Validation Rules

Skipped when:

- Transaction type or amount type is blank.
- Amount is blank or invalid.
- Posted date is blank or invalid.
- Row is product price, tax, promo, Walmart-funded savings, or commission.
- Row cannot be mapped to a supported fee or advertising category.

### P&L Behavior

- Settlement fees are standalone `MarketplaceFee` adjustments.
- Settlement fee signs are respected: negative rows increase fees, positive rows reduce fees.
- Settlement product-price refund rows are standalone `Refund` rows. They appear as Refund Sales and reduce displayed Sales / GMV instead of appearing in Other Settlement Fees.
- Seller Center SEM rows are standalone `AdvertisingCost` rows.
- For reporting only, settlement-derived fees and settlement-derived Seller Center SEM are allocated across the inclusive `Period Start Date` through `Period End Date` range.
- Day, week, month, quarter, year, and custom P&L ranges include only the portion of each settlement row whose settlement period overlaps the selected range.
- Allocation is performed in cents so the allocated daily amounts reconcile exactly to the original settlement row.
- Rounding remainders are assigned deterministically to the earliest days in the settlement period.
- If a row has no row-level period dates and no `PaymentSummary` period can be found, the row falls back to its posted date and the P&L UI displays a fallback notice.
- The importer and P&L engine do not guess a 14-day period when both row-level dates and the `PaymentSummary` payout period are missing.
- Daily Item Sales reports are the sales source for all reporting ranges. PO/order rows remain audit-only for P&L sales.
- Settlement commission is imported as `commission` and allocated across the inclusive settlement period for reporting ranges.

## Future Settlement Reports

Status: planned for additional marketplace or Walmart settlement formats.

Future settlement parsers should follow the same rule: normalize rows into generic fee, refund, adjustment, or advertising models before P&L uses them.

## Future Advertising Reports

Status: planned for `/imports/advertising`. Direct `/ad-spend/upload` currently imports Walmart Connect spend. Seller Center SEM now comes from Walmart Payments New settlement reports.

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
(PO Sales - refund sales) - marketplace commission - fulfillment fees - COGS - ad spend
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
