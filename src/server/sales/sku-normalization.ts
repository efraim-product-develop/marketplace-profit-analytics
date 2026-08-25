export function normalizeMarketplaceSku(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeOptionalMarketplaceSku(value: string | null | undefined) {
  const normalized = normalizeMarketplaceSku(value);
  return normalized || null;
}
