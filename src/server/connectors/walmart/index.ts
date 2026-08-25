import {
  parseGenericCogsWorkbook,
  type CogsParseOptions
} from "@/server/cogs/parser";
import type { MarketplaceConnector } from "@/server/connectors/types";
import { walmartItemSalesMappingParser } from "./item-sales-mapping";
import { walmartPoReportParser } from "./po-reports";
import { walmartSellerCenterSemParser } from "./sem-advertising";
import { walmartSettlementImportParsers } from "./settlements";

const WALMART_MARKETPLACE = "walmart";

const walmartCogsAliases: CogsParseOptions["headerAliases"] = {
  sellerSku: ["sku", "seller sku", "partner sku", "item sku"],
  parentSku: ["product id", "product id type", "variant group id"],
  unitCost: ["wfs cost", "unit cost", "cost", "item cost"],
  effectiveDate: ["effective date", "start date", "cost effective date"]
};

export const walmartConnector: MarketplaceConnector = {
  marketplace: WALMART_MARKETPLACE,
  displayName: "Walmart Seller Center",
  capabilities: {
    cogsUpload: true,
    orderImport: true,
    settlementImport: true,
    apiConnection: true
  },
  parseCogsWorkbook(buffer, options = {}) {
    return parseGenericCogsWorkbook(buffer, {
      ...options,
      marketplace: WALMART_MARKETPLACE,
      headerAliases: walmartCogsAliases
    });
  },
  importParsers: [
    walmartPoReportParser,
    walmartItemSalesMappingParser,
    ...walmartSettlementImportParsers,
    walmartSellerCenterSemParser
  ]
};
