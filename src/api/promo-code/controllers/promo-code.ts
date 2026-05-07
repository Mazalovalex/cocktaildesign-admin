// backend/src/api/promo-code/controllers/promo-code.ts
import { factories } from "@strapi/strapi";

type PromoCodeApplyBody = {
  code?: string;
  totalPrice?: number;
};

const MAX_PROMO_CODE_LENGTH = 128;
const MAX_TOTAL_PRICE = 100_000_000;

function isValidTotalPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_TOTAL_PRICE;
}

export default factories.createCoreController("api::promo-code.promo-code", ({ strapi }) => ({
  /**
   * POST /api/promo-code/apply
   * Body: { code: string, totalPrice: number }
   *
   * Важно:
   * Этот endpoint только проверяет промокод и считает preview-скидку для frontend.
   * Он НЕ увеличивает usageCount.
   * Фактическое использование промокода должно фиксироваться при успешном создании заказа.
   */
  async apply(ctx) {
    const body = ctx.request.body as PromoCodeApplyBody;

    const code = String(body.code ?? "")
      .trim()
      .toUpperCase();

    const totalPrice = Number(body.totalPrice ?? 0);

    if (!code) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "code_required" };
      return;
    }

    if (code.length > MAX_PROMO_CODE_LENGTH) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "code_invalid" };
      return;
    }

    if (!isValidTotalPrice(totalPrice)) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "total_price_invalid" };
      return;
    }

    const promoQuery = strapi.db.query("api::promo-code.promo-code");

    const promo = await promoQuery.findOne({
      where: { code },
    });

    if (!promo) {
      ctx.status = 404;
      ctx.body = { ok: false, error: "not_found" };
      return;
    }

    if (!promo.isActive) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "not_active" };
      return;
    }

    // usageLimit = null означает безлимитный промокод.
    // apply только проверяет лимит, но не увеличивает usageCount.
    if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "limit_reached" };
      return;
    }

    if (promo.minOrderAmount && totalPrice < promo.minOrderAmount) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "min_amount_not_reached", minAmount: promo.minOrderAmount };
      return;
    }

    if (promo.discountType === "inventory") {
      ctx.body = {
        ok: true,
        discountType: "inventory",
        discountAmount: 0,
        finalPrice: totalPrice,
        bonusMessage: promo.bonusMessage || "Для вас подарок! Менеджер свяжется с вами для уточнения деталей",
        giftDescription: promo.giftDescription,
      };
      return;
    }

    let discountAmount = 0;
    let replacesVolumeDiscount = false;

    if (promo.discountType === "percent" || promo.discountType === "startup") {
      discountAmount = Math.round((totalPrice * promo.discountValue) / 100);
      replacesVolumeDiscount = true;
    } else if (promo.discountType === "fixed") {
      discountAmount = promo.discountValue;
      replacesVolumeDiscount = false;
    }

    discountAmount = Math.min(discountAmount, totalPrice);

    ctx.body = {
      ok: true,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      discountAmount,
      finalPrice: totalPrice - discountAmount,
      replacesVolumeDiscount,
      bonusMessage: promo.bonusMessage || "",
    };
  },
}));
