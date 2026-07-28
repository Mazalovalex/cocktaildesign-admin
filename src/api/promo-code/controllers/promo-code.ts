// backend/src/api/promo-code/controllers/promo-code.ts
import { factories } from "@strapi/strapi";

import type { PromoCodeResolveResult } from "../services/promo-code";

type PromoCodeApplyBody = {
  code?: string;
  totalPrice?: number;
  discountableTotal?: number;
};

const MAX_PROMO_CODE_LENGTH = 128;
const MAX_TOTAL_PRICE = 100_000_000;

function isValidTotalPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_TOTAL_PRICE;
}

function isValidDiscountableTotal(value: unknown, totalPrice: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_TOTAL_PRICE && value <= totalPrice
  );
}

export default factories.createCoreController("api::promo-code.promo-code", ({ strapi }) => ({
  /**
   * POST /api/promo-code/apply
   * Body: { code: string, totalPrice: number, discountableTotal?: number }
   *
   * Этот endpoint только проверяет промокод
   * и рассчитывает preview-скидку для frontend.
   *
   * usageCount здесь не увеличивается.
   */
  async apply(ctx) {
    const body = ctx.request.body as PromoCodeApplyBody;

    const code = String(body.code ?? "")
      .trim()
      .toUpperCase();

    const totalPrice = Number(body.totalPrice ?? 0);
    const discountableTotal = Number(body.discountableTotal ?? body.totalPrice ?? 0);

    if (!code) {
      ctx.status = 400;
      ctx.body = {
        ok: false,
        error: "code_required",
      };
      return;
    }

    if (code.length > MAX_PROMO_CODE_LENGTH) {
      ctx.status = 400;
      ctx.body = {
        ok: false,
        error: "code_invalid",
      };
      return;
    }

    if (!isValidTotalPrice(totalPrice)) {
      ctx.status = 400;
      ctx.body = {
        ok: false,
        error: "total_price_invalid",
      };
      return;
    }

    if (!isValidDiscountableTotal(discountableTotal, totalPrice)) {
      ctx.status = 400;
      ctx.body = {
        ok: false,
        error: "discountable_total_invalid",
      };
      return;
    }

    const promoCodeService = strapi.service("api::promo-code.promo-code") as {
      resolvePromoCode(rawCode: string, totalPrice: number, discountableTotal: number): Promise<PromoCodeResolveResult>;
    };

    const result = await promoCodeService.resolvePromoCode(code, totalPrice, discountableTotal);

    if (result.ok === false) {
      if (result.error === "not_found") {
        ctx.status = 404;
      } else {
        ctx.status = 400;
      }

      ctx.body = {
        ok: false,
        error: result.error,
        ...(result.error === "min_amount_not_reached" ? { minAmount: result.minAmount } : {}),
      };
      return;
    }

    if (result.discountType === "inventory") {
      ctx.body = {
        ok: true,
        discountType: result.discountType,
        discountAmount: result.discountAmount,
        finalPrice: result.finalPrice,
        bonusMessage: result.bonusMessage,
        giftDescription: result.giftDescription,
      };
      return;
    }

    ctx.body = {
      ok: true,
      discountType: result.discountType,
      discountValue: result.discountValue,
      discountAmount: result.discountAmount,
      finalPrice: result.finalPrice,
      replacesVolumeDiscount: result.replacesVolumeDiscount,
      bonusMessage: result.bonusMessage,
    };
  },
}));
