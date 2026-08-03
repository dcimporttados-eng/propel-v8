// ============================================================================
// Configuração central da campanha promocional e da comissão da agência.
// FONTE DA VERDADE — o frontend (src/config/campaign.ts) só espelha o que é
// exibido; qualquer valor cobrado é sempre recalculado aqui, no servidor.
// ============================================================================

export interface CampaignTier {
  /** Quantidade EXATA de aulas no pedido */
  items: number;
  /** Percentual de desconto sobre o subtotal */
  percent: number;
}

export interface CampaignConfig {
  id: string;
  active: boolean;
  /** Início (inclusive), formato YYYY-MM-DD. null = sem data inicial */
  startDate: string | null;
  /** Fim (inclusive), formato YYYY-MM-DD. null = sem data final */
  endDate: string | null;
  /** Desconto só se a quantidade bater EXATAMENTE com um tier */
  tiers: CampaignTier[];
}

export const CAMPAIGN: CampaignConfig = {
  id: "pacotes-2026",
  active: true,
  startDate: "2026-08-03",
  endDate: null,
  tiers: [
    { items: 3, percent: 5 },
    { items: 5, percent: 10 },
    { items: 10, percent: 15 },
  ],
};

/** Preço padrão por aula quando a turma não tem preço próprio cadastrado. */
export const DEFAULT_PRICE_CENTS = 2990;

/** Máximo de aulas por pedido. */
export const MAX_ITEMS_PER_ORDER = 10;

/** Janela de pagamento — alinhada com o minutesToExpire do checkout Asaas. */
export const ORDER_TTL_MINUTES = 30;

// ===== Comissão da agência =====
/** Comissão da agência POR RESERVA (aula), em centavos. Não varia com desconto. */
export const AGENCY_FEE_CENTS_PER_ITEM = 70;

/**
 * Estimativa da taxa que a Asaas retém ANTES de aplicar os splits.
 * A taxa real só é conhecida quando o cliente escolhe o meio de pagamento,
 * depois do checkout já criado — então reservamos o pior caso entre os meios
 * habilitados. O que sobrar da reserva fica com a agência.
 */
export const ASAAS_FEE_MODEL = {
  /** Pix: taxa fixa. */
  pixFixedCents: 99,
  /** Cartão: percentual sobre o valor + parcela fixa. */
  cardPercent: 0.0299,
  cardFixedCents: 49,
  /** Margem extra de segurança sobre a estimativa. */
  safetyMarginCents: 30,
};

/** Pior caso de taxa (em centavos) para um total de pedido. */
export function estimateWorstCaseFeeCents(totalCents: number): number {
  const pix = ASAAS_FEE_MODEL.pixFixedCents;
  const card = Math.ceil(totalCents * ASAAS_FEE_MODEL.cardPercent) + ASAAS_FEE_MODEL.cardFixedCents;
  return Math.max(pix, card) + ASAAS_FEE_MODEL.safetyMarginCents;
}

/**
 * Valor do split destinado à conta da cliente (academia), em centavos.
 * O restante (comissão + sobra da taxa estimada) permanece na conta dona da
 * API key, que é a da agência.
 */
export function computeClientSplitCents(totalCents: number, itemsCount: number, feeInflation = 0): number {
  const agencyFee = AGENCY_FEE_CENTS_PER_ITEM * itemsCount;
  const feeReserve = estimateWorstCaseFeeCents(totalCents) + feeInflation;
  return Math.max(0, totalCents - agencyFee - feeReserve);
}

/** Limite da Asaas para description de item/cobrança. */
export const ASAAS_DESCRIPTION_MAX = 150;

/**
 * Monta a descrição da cobrança respeitando o limite da Asaas.
 * Com muitas aulas a lista de datas estoura 150 caracteres, então caímos para
 * uma forma compacta antes de truncar — o cliente sempre entende o que comprou.
 */
export function buildChargeDescription(
  schedule: string[],
  opts: { customerName?: string; itemsCount: number; discountPercent?: number } = { itemsCount: 0 },
): string {
  const prefix = "Reserva Pavilhão 8";
  const who = opts.customerName ? ` — ${opts.customerName}` : "";
  const off = opts.discountPercent && opts.discountPercent > 0
    ? ` (${opts.itemsCount} aulas — ${opts.discountPercent}% OFF)`
    : "";

  const full = `${prefix}${who}${schedule.length ? ` — ${schedule.join(", ")}` : ""}${off}`;
  if (full.length <= ASAAS_DESCRIPTION_MAX) return full;

  // Sem o nome do cliente
  const noName = `${prefix}${schedule.length ? ` — ${schedule.join(", ")}` : ""}${off}`;
  if (noName.length <= ASAAS_DESCRIPTION_MAX) return noName;

  // Só a contagem e o período
  const first = schedule[0] || "";
  const last = schedule[schedule.length - 1] || "";
  const compact = `${prefix} — ${opts.itemsCount} aulas${first ? ` (${first} a ${last})` : ""}${off}`;
  if (compact.length <= ASAAS_DESCRIPTION_MAX) return compact;

  return compact.slice(0, ASAAS_DESCRIPTION_MAX);
}

/** A campanha está valendo nesta data? */
export function isCampaignActive(today = new Date()): boolean {
  if (!CAMPAIGN.active) return false;
  const iso = today.toISOString().slice(0, 10);
  if (CAMPAIGN.startDate && iso < CAMPAIGN.startDate) return false;
  if (CAMPAIGN.endDate && iso > CAMPAIGN.endDate) return false;
  return true;
}

/**
 * Percentual de desconto para uma quantidade de aulas.
 * Só há desconto em quantidades EXATAS configuradas (3, 5, 10) — 4, 6, 7, 8, 9
 * seguem com preço cheio.
 */
export function getDiscountPercent(itemsCount: number, today = new Date()): number {
  if (!isCampaignActive(today)) return 0;
  const tier = CAMPAIGN.tiers.find((t) => t.items === itemsCount);
  return tier ? tier.percent : 0;
}

export interface PriceBreakdown {
  itemsCount: number;
  subtotalCents: number;
  discountPercent: number;
  discountCents: number;
  totalCents: number;
  campaignId: string | null;
}

/**
 * Cálculo do pedido — SOMENTE aritmética inteira em centavos.
 * O desconto é truncado (nunca arredondado pra cima), então o cliente jamais
 * paga a mais por causa de arredondamento.
 */
export function computeOrderPrice(
  itemPricesCents: number[],
  today = new Date(),
): PriceBreakdown {
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
    campaignId: discountPercent > 0 ? CAMPAIGN.id : null,
  };
}
