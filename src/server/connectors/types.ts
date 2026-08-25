import type {
  CogsParseOptions,
  ParsedCogsWorkbook
} from "@/server/cogs/parser";
import type {
  ParsedSalesWorkbook,
  SalesParseOptions
} from "@/server/sales/parser";
import type { ImportReportParser } from "@/server/imports/types";

export type MarketplaceConnector = {
  marketplace: string;
  displayName: string;
  capabilities: {
    cogsUpload: boolean;
    orderImport: boolean;
    settlementImport: boolean;
    apiConnection: boolean;
  };
  parseCogsWorkbook?: (
    buffer: Buffer,
    options?: CogsParseOptions
  ) => ParsedCogsWorkbook;
  parseSalesWorkbook?: (
    buffer: Buffer,
    options?: SalesParseOptions
  ) => ParsedSalesWorkbook;
  importParsers?: ImportReportParser[];
};
