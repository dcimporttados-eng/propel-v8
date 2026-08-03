// ============================================================================
// Espelho da campanha para EXIBIÇÃO no site.
// A fonte da verdade é supabase/functions/_shared/campaign.ts — o valor cobrado
// é sempre recalculado no servidor. Ao mudar a campanha, altere os dois.
// ============================================================================

export interface CampaignTier {
  items: number;
  percent: number;
}

export const CAMPAIGN = {
  id: "pacotes-2026",
  active: true,
  startDate: "2026-08-03" as string | null,
  endDate: null as string | null,
  tiers: [
    { items: 3, percent: 5 },
    { items: 5, percent: 10 },
    { items: 10, percent: 15 },
  ] as CampaignTier[],
};

export const DEFAULT_PRICE_CENTS = 2990;
export const MAX_ITEMS_PER_ORDER = 10;

export function isCampaignActive(today = new Date()): boolean {
  if (!CAMPAIGN.active) return false;
  const iso = today.toISOString().slice(0, 10);
  if (CAMPAIGN.startDate && iso < CAMPAIGN.startDate) return false;
  if (CAMPAIGN.endDate && iso > CAMPAIGN.endDate) return false;
  return true;
}

/** Desconto apenas em quantidades EXATAS (3, 5, 10). */
export function getDiscountPercent(itemsCount: number, today = new Date()): number {
  if (!isCampaignActive(today)) return 0;
  return CAMPAIGN.tiers.find((t) => t.items === itemsCount)?.percent ?? 0;
}

export interface PriceBreakdown {
  itemsCount: number;
  subtotalCents: number;
  discountPercent: number;
  discountCents: number;
  totalCents: number;
}

/** Mesma aritmética inteira do servidor (desconto truncado). */
export function computeOrderPrice(itemPricesCents: number[], today = new Date()): PriceBreakdown {
  const itemsCount = itemPricesCents.length;
  const subtotalCents = itemPricesCents.reduce((a, b) => a + b, 0);
  const discountPercent = getDiscountPercent(itemsCount, today);
  const discountCents = discountPercent > 0
    ? Math.trunc((subtotalCents * discountPercent) / 100)
    : 0;
  return {
    itemsCount,
    subtotalCents,
    discountPercent,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

/** Próximo tier que o cliente alcançaria adicionando mais aulas. */
export function getNextTier(itemsCount: number, today = new Date()): CampaignTier | null {
  if (!isCampaignActive(today)) return null;
  return CAMPAIGN.tiers.find((t) => t.items > itemsCount) ?? null;
}

/** "3 aulas: 5% OFF | 5 aulas: 10% OFF | 10 aulas: 15% OFF" */
export function tiersLabel(): string {
  return CAMPAIGN.tiers.map((t) => `${t.items} aulas: ${t.percent}% OFF`).join(" | ");
}
