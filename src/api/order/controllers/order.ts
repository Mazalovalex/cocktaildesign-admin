import type { Context } from "koa";
import orderService from "../services/order";

type ValidationErrorCode =
  | "invalid_payload"
  | "invalid_item_code"
  | "invalid_quantity"
  | "too_many_items"
  | "order_validation_failed";

type SanitizedItem = {
  code: string;
  quantity: number;
  engraving: boolean;
};

function sendValidationError(ctx: Context, code: ValidationErrorCode) {
  ctx.status = 400;
  ctx.body = { ok: false, error: code };
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function ensureMaxLength(value: string, max: number): boolean {
  return value.length <= max;
}

function sanitizeOrderPayload(body: unknown): {
  buyerType: "individual" | "legal";
  fullName?: string;
  contactName?: string;
  phone: string;
  telegram?: string;
  inn?: string;
  address: string;
  comment?: string;
  promoCode?: string;
  items: SanitizedItem[];
} | { error: ValidationErrorCode } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid_payload" };
  }

  const data = body as Record<string, unknown>;
  const buyerType = data.buyerType;
  if (buyerType !== "individual" && buyerType !== "legal") {
    return { error: "invalid_payload" };
  }

  const phoneRaw = getString(data.phone)?.trim() ?? "";
  const addressRaw = getString(data.address)?.trim() ?? "";
  if (!phoneRaw || !addressRaw) {
    return { error: "order_validation_failed" };
  }
  if (!ensureMaxLength(phoneRaw, 32) || !ensureMaxLength(addressRaw, 500)) {
    return { error: "order_validation_failed" };
  }

  const telegramRaw = getString(data.telegram);
  const innRaw = getString(data.inn);
  const commentRaw = getString(data.comment);
  const fullNameRaw = getString(data.fullName);
  const contactNameRaw = getString(data.contactName);

  if (telegramRaw !== null && !ensureMaxLength(telegramRaw.trim(), 64)) {
    return { error: "order_validation_failed" };
  }
  if (innRaw !== null && !ensureMaxLength(innRaw.trim(), 16)) {
    return { error: "order_validation_failed" };
  }
  if (commentRaw !== null && !ensureMaxLength(commentRaw.trim(), 1000)) {
    return { error: "order_validation_failed" };
  }
  if (fullNameRaw !== null && !ensureMaxLength(fullNameRaw.trim(), 200)) {
    return { error: "order_validation_failed" };
  }
  if (contactNameRaw !== null && !ensureMaxLength(contactNameRaw.trim(), 200)) {
    return { error: "order_validation_failed" };
  }

  const fullName = fullNameRaw?.trim();
  const contactName = contactNameRaw?.trim();
  if (buyerType === "individual" && !fullName) {
    return { error: "order_validation_failed" };
  }
  if (buyerType === "legal" && !contactName) {
    return { error: "order_validation_failed" };
  }

  const items = data.items;
  if (!Array.isArray(items)) {
    return { error: "invalid_payload" };
  }
  if (items.length === 0) {
    return { error: "order_validation_failed" };
  }
  if (items.length > 100) {
    return { error: "too_many_items" };
  }

  const sanitizedItems: SanitizedItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "invalid_payload" };
    }

    const itemData = item as Record<string, unknown>;
    const code = getString(itemData.code)?.trim() ?? "";
    if (!code) {
      return { error: "invalid_item_code" };
    }

    const quantity = itemData.quantity;
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 100) {
      return { error: "invalid_quantity" };
    }

    const engraving = typeof itemData.engraving === "boolean" ? itemData.engraving : false;

    sanitizedItems.push({
      code,
      quantity: quantity as number,
      engraving,
    });
  }

  const promoCode = getString(data.promoCode)?.trim();
  if (promoCode && !ensureMaxLength(promoCode, 128)) {
    return { error: "order_validation_failed" };
  }

  return {
    buyerType,
    fullName: fullName || undefined,
    contactName: contactName || undefined,
    phone: phoneRaw,
    telegram: telegramRaw?.trim() || undefined,
    inn: innRaw?.trim() || undefined,
    address: addressRaw,
    comment: commentRaw?.trim() || undefined,
    promoCode: promoCode || undefined,
    items: sanitizedItems,
  };
}

export default {
  async create(ctx: Context) {
    const sanitizedPayload = sanitizeOrderPayload(ctx.request.body);
    if ("error" in sanitizedPayload) {
      sendValidationError(ctx, sanitizedPayload.error);
      return;
    }

    const { buyerType, fullName, contactName, phone, telegram, inn, address, comment, promoCode, items } =
      sanitizedPayload;
    const name = buyerType === "individual" ? fullName : contactName;

    if (!name) {
      sendValidationError(ctx, "order_validation_failed");
      return;
    }

    try {
      // 1. Создаём контрагента
      const agentHref = await orderService.createCounterparty(name, phone);

      // 2. Ищем товары по коду и берём только trusted server-side поля
      const positions: {
        productHref: string;
        productType: string;
        quantity: number;
        price: number;
        engraving: boolean;
        discountExcluded: boolean;
        name: string;
      }[] = [];

      let trustedSubtotal = 0;

      for (const item of items) {
        try {
          const resolved = await orderService.resolveOrderItemByCode(item.code);

          positions.push({
            productHref: resolved.href,
            productType: resolved.type,
            quantity: item.quantity,
            price: resolved.trustedPriceRub,
            engraving: item.engraving,
            discountExcluded: resolved.trustedDiscountExcluded,
            name: resolved.trustedName,
          });

          trustedSubtotal += resolved.trustedPriceRub * item.quantity;
        } catch (error) {
          const errorCode = (error as { code?: string })?.code;
          if (
            errorCode === "invalid_item_code" ||
            errorCode === "item_not_found" ||
            errorCode === "item_price_missing" ||
            errorCode === "item_price_invalid"
          ) {
            ctx.status = 400;
            ctx.body = { ok: false, error: errorCode };
            return;
          }
          throw error;
        }
      }

      if (positions.length === 0) {
        sendValidationError(ctx, "order_validation_failed");
        return;
      }

      // 3. Серверный пересчёт процента скидки за объём (клиентское поле игнорируем)
      const trustedVolumeDiscountPercent = await orderService.resolveVolumeDiscountPercent(trustedSubtotal);

      // 3. Формируем комментарий к заказу
      const engravingItems = positions.filter((i) => i.engraving).map((i) => i.name);

      const descriptionParts = [
        buyerType === "legal" ? "Юрлицо" : "Физлицо",
        engravingItems.length > 0 ? `Гравировка: ${engravingItems.join(", ")}` : null,
        telegram ? `Telegram: ${telegram}` : null,
        inn ? `ИНН: ${inn}` : null,
        trustedVolumeDiscountPercent > 0 ? `Скидка за объём ${trustedVolumeDiscountPercent}%` : null,
        promoCode ? `Промокод: ${promoCode}` : null,
        comment ? `Комментарий: ${comment}` : null,
      ].filter(Boolean);

      // 4. Создаём заказ
      const order = await orderService.createCustomerOrder({
        agentHref,
        positions,
        description: descriptionParts.join(" | "),
        shipmentAddress: address,
        volumeDiscountPercent: trustedVolumeDiscountPercent,
      });

      ctx.body = { ok: true, orderId: order.id, orderName: order.name };
    } catch (err) {
      strapi.log.error("Ошибка создания заказа в МойСклад");
      ctx.status = 500;
      ctx.body = { ok: false, error: "order_validation_failed" };
    }
  },
};
