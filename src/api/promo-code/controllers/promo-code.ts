import { factories } from "@strapi/strapi";

// Коды акции СТАРТАП — зашиты в коде, не меняются
const STARTUP_CODES = ["STARTCD20", "STARTTIRED20", "STARTBARMSK20", "STARTBARCOM20"];
const STARTUP_MIN_AMOUNT = 20000;
const STARTUP_DISCOUNT_PERCENT = 20;

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

    // Проверяем — это СТАРТАП?
    if (STARTUP_CODES.includes(code)) {
      // Проверяем минимальную сумму заказа
      if (totalPrice < STARTUP_MIN_AMOUNT) {
        ctx.status = 400;
        ctx.body = { ok: false, error: "min_amount_not_reached", minAmount: STARTUP_MIN_AMOUNT };
        return;
      }

      const discountAmount = Math.round((totalPrice * STARTUP_DISCOUNT_PERCENT) / 100);

      ctx.body = {
        ok: true,
        discountType: "startup",
        discountValue: STARTUP_DISCOUNT_PERCENT,
        discountAmount,
        finalPrice: totalPrice - discountAmount,
        // Флаг — не суммируется с объёмной скидкой
        replacesVolumeDiscount: true,
        // Плашка для фронта
        bonusMessage:
          "+ бесплатная доставка\n+ подарок на выбор: клише / гравировка / изделие CD / 10% на след заказ\nМенеджер свяжется с вами для согласования доставки и подарка",
      };
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
      // Увеличиваем счётчик использований
      await promoQuery.update({
        where: { id: promo.id },
        data: { usageCount: promo.usageCount + 1 },
      });

      ctx.body = {
        ok: true,
        discountType: "inventory",
        discountAmount: 0,
        finalPrice: totalPrice,
        // Плашка для фронта
        bonusMessage: "Для вас подарок! Менеджер свяжется с вами для уточнения деталей",
        giftDescription: promo.giftDescription,
      };
      return;
    }

    // Считаем скидку
    let discountAmount = 0;
    // Флаг — заменяет ли промокод объёмную скидку
    let replacesVolumeDiscount = false;

    if (promo.discountType === "percent") {
      // Процентная скидка не суммируется с объёмной — берём выгоднее для клиента на фронте
      discountAmount = Math.round((totalPrice * promo.discountValue) / 100);
      replacesVolumeDiscount = true;
    } else if (promo.discountType === "fixed") {
      // Фиксированная скидка — суммируется с объёмной
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
    };
  },
}));
