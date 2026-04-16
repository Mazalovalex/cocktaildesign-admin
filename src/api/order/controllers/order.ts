import type { Context } from "koa";
import orderService from "../services/order";

export default {
  async create(ctx: Context) {
    const {
      buyerType,
      fullName,
      contactName,
      phone,
      telegram,
      inn,
      address,
      comment,
      items,
      promoCode,
      promoDiscount,
      volumeDiscount,
      volumeDiscountPercent,
    } = ctx.request.body as {
      buyerType: "individual" | "legal";
      fullName?: string;
      contactName?: string;
      phone: string;
      telegram?: string;
      inn?: string;
      address: string;
      comment?: string;
      items: { code: string; name: string; quantity: number; price: number; engraving: boolean }[];
      promoCode?: string;
      promoDiscount?: number;
      volumeDiscount?: number;
      volumeDiscountPercent?: number;
    };

    const name = buyerType === "individual" ? fullName : contactName;

    if (!name || !phone || !address || !items?.length) {
      ctx.status = 400;
      ctx.body = { error: "Не заполнены обязательные поля" };
      return;
    }

    try {
      // 1. Создаём контрагента
      const agentHref = await orderService.createCounterparty(name, phone);

      // 2. Ищем товары по артикулу
      const positions: { productHref: string; quantity: number; price: number; engraving: boolean }[] = [];

      for (const item of items) {
        const productHref = await orderService.findProductHref(item.code);

        if (!productHref) {
          strapi.log.warn(`Товар не найден в МойСклад: ${item.code} (${item.name})`);
          continue;
        }

        positions.push({
          productHref,
          quantity: item.quantity,
          price: item.price,
          engraving: item.engraving,
        });
      }

      if (positions.length === 0) {
        ctx.status = 400;
        ctx.body = { error: "Ни один товар не найден в МойСклад" };
        return;
      }

      // 3. Формируем комментарий к заказу
      const engravingItems = items.filter((i) => i.engraving).map((i) => i.name);

      const descriptionParts = [
        buyerType === "legal" ? "Юрлицо" : "Физлицо",
        engravingItems.length > 0 ? `Гравировка: ${engravingItems.join(", ")}` : null,
        telegram ? `Telegram: ${telegram}` : null,
        inn ? `ИНН: ${inn}` : null,
        volumeDiscount ? `Скидка за объём ${volumeDiscountPercent}%: −${volumeDiscount} ₽` : null,
        promoCode && promoDiscount ? `Промокод ${promoCode}: −${promoDiscount} ₽` : null,
        comment ? `Комментарий: ${comment}` : null,
      ].filter(Boolean);

      // 4. Создаём заказ
      const order = await orderService.createCustomerOrder({
        agentHref,
        positions,
        description: descriptionParts.join(" | "),
        shipmentAddress: address,
        // Передаём процент скидки за объём — проставится в каждую позицию
        volumeDiscountPercent: volumeDiscountPercent,
      });

      ctx.body = { ok: true, orderId: order.id, orderName: order.name };
    } catch (err) {
      strapi.log.error("Ошибка создания заказа в МойСклад:", err);
      ctx.status = 500;
      ctx.body = { error: "Не удалось создать заказ" };
    }
  },
};
