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

    // Проверяем минимальную сумму заказа
    if (promo.minOrderAmount && totalPrice < promo.minOrderAmount) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "min_amount_not_reached", minAmount: promo.minOrderAmount };
      return;
    }

    // Промокод на инвентарь — скидку не даёт, только подарок
    if (promo.discountType === "inventory") {
      await promoQuery.update({
        where: { id: promo.id },
        data: { usageCount: promo.usageCount + 1 },
      });

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

    // Считаем скидку
    let discountAmount = 0;
    let replacesVolumeDiscount = false;

    if (promo.discountType === "percent" || promo.discountType === "startup") {
      // Процентная скидка и СТАРТАП не суммируются с объёмной
      discountAmount = Math.round((totalPrice * promo.discountValue) / 100);
      replacesVolumeDiscount = true;
    } else if (promo.discountType === "fixed") {
      // Фиксированная скидка суммируется с объёмной
      discountAmount = promo.discountValue;
      replacesVolumeDiscount = false;
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
      replacesVolumeDiscount,
      // Плашка с бонусами — если заполнена в админке
      bonusMessage: promo.bonusMessage || "",
    };
  },
}));
