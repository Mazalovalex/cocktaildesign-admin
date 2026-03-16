import { factories } from "@strapi/strapi";

export default factories.createCoreController("api::promo-code.promo-code", ({ strapi }) => ({
  /**
   * POST /api/promo-code/apply
   * Body: { code: string, totalPrice: number }
   */
  async apply(ctx) {
    const body = ctx.request.body as { code?: string; totalPrice?: number };

    const code = String(body.code ?? "")
      .trim()
      .toUpperCase();
    const totalPrice = Number(body.totalPrice ?? 0);

    // Проверяем что код не пустой
    if (!code) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "code_required" };
      return;
    }

    // Ищем промокод в базе
    const promoQuery = strapi.db.query("api::promo-code.promo-code");

    const promo = await promoQuery.findOne({
      where: { code },
    });

    // Промокод не найден
    if (!promo) {
      ctx.status = 404;
      ctx.body = { ok: false, error: "not_found" };
      return;
    }

    // Промокод неактивен
    if (!promo.isActive) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "not_active" };
      return;
    }

    // Проверяем лимит использований
    // usageLimit = null означает безлимитный промокод
    if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "limit_reached" };
      return;
    }

    // Считаем скидку
    let discountAmount = 0;

    if (promo.discountType === "percent") {
      // Процентная скидка: например 10% от 5000 = 500
      discountAmount = Math.round((totalPrice * promo.discountValue) / 100);
    } else if (promo.discountType === "fixed") {
      // Фиксированная скидка: например 500 рублей
      discountAmount = promo.discountValue;
    }

    // Скидка не может быть больше суммы заказа
    discountAmount = Math.min(discountAmount, totalPrice);

    // Увеличиваем счётчик использований
    await promoQuery.update({
      where: { id: promo.id },
      data: { usageCount: promo.usageCount + 1 },
    });

    ctx.body = {
      ok: true,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      discountAmount,
      finalPrice: totalPrice - discountAmount,
    };
  },
}));
