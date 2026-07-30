import {
  parseGenericCogsWorkbook,
  type CogsParseOptions
} from "@/server/cogs/parser";
import type { MarketplaceConnector } from "@/server/connectors/types";
import { parseWalmartSalesUploadWorkbook } from "./sales-upload";
import { parseWalmartSalesWorkbook, walmartSalesImportParsers } from "./sales";
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
    apiConnection: false
  },
  parseCogsWorkbook(buffer, options = {}) {
    return parseGenericCogsWorkbook(buffer, {
      ...options,
      marketplace: WALMART_MARKETPLACE,
      headerAliases: walmartCogsAliases
    });
  },
  parseSalesWorkbook(buffer, options = {}) {
    return parseWalmartSalesWorkbook(buffer, options);
  },
  parseSalesUploadWorkbook(buffer) {
    return parseWalmartSalesUploadWorkbook(buffer);
  },
  importParsers: [...walmartSalesImportParsers, ...walmartSettlementImportParsers]
};
