/**
 * promo-code service
 */

import { factories } from "@strapi/strapi";

export type PromoDiscountType = "percent" | "fixed" | "inventory" | "startup";

export type PromoCodeResolveResult =
  | {
      ok: true;
      promoId: number;
      code: string;
      discountType: PromoDiscountType;
      discountValue: number;
      discountAmount: number;
      finalPrice: number;
      replacesVolumeDiscount: boolean;
      bonusMessage: string;
      giftDescription?: string;
    }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_active"
        | "limit_reached"
        | "min_amount_not_reached"
        | "invalid_promo_configuration";
      minAmount?: number;
    };

const PROMO_DISCOUNT_TYPES: PromoDiscountType[] = ["percent", "fixed", "inventory", "startup"];

const INVENTORY_DEFAULT_BONUS_MESSAGE =
  "Для вас подарок! Менеджер свяжется с вами для уточнения деталей";

function isPromoDiscountType(value: unknown): value is PromoDiscountType {
  return typeof value === "string" && PROMO_DISCOUNT_TYPES.includes(value as PromoDiscountType);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

export default factories.createCoreService("api::promo-code.promo-code", ({ strapi }) => ({
  async resolvePromoCode(
    rawCode: string,
    totalPrice: number,
    discountableTotal: number,
  ): Promise<PromoCodeResolveResult> {
    const code = rawCode.trim().toUpperCase();

    const promo = await strapi.db.query("api::promo-code.promo-code").findOne({
      where: { code },
    });

    if (!promo) {
      return { ok: false, error: "not_found" };
    }

    if (promo.isActive !== true) {
      return { ok: false, error: "not_active" };
    }

    if (!isPromoDiscountType(promo.discountType)) {
      return { ok: false, error: "invalid_promo_configuration" };
    }

    const discountType = promo.discountType;

    const usageCount = Number(promo.usageCount ?? 0);
    if (!isNonNegativeInteger(usageCount)) {
      return { ok: false, error: "invalid_promo_configuration" };
    }

    if (promo.usageLimit !== null && promo.usageLimit !== undefined) {
      const usageLimit = Number(promo.usageLimit);
      if (!isNonNegativeInteger(usageLimit)) {
        return { ok: false, error: "invalid_promo_configuration" };
      }
      if (usageCount >= usageLimit) {
        return { ok: false, error: "limit_reached" };
      }
    }

    let minOrderAmount = 0;
    if (promo.minOrderAmount !== null && promo.minOrderAmount !== undefined) {
      const parsedMinOrderAmount = Number(promo.minOrderAmount);
      if (!Number.isFinite(parsedMinOrderAmount) || parsedMinOrderAmount < 0) {
        return { ok: false, error: "invalid_promo_configuration" };
      }
      minOrderAmount = parsedMinOrderAmount;
    }

    if (totalPrice < minOrderAmount) {
      return { ok: false, error: "min_amount_not_reached", minAmount: minOrderAmount };
    }

    const rawBonusMessage = promo.bonusMessage;
    const bonusMessageFromDb = typeof rawBonusMessage === "string" ? rawBonusMessage : "";

    const rawGiftDescription = promo.giftDescription;
    const giftDescription =
      typeof rawGiftDescription === "string" && rawGiftDescription.trim() !== ""
        ? rawGiftDescription.trim()
        : undefined;

    if (discountType === "inventory") {
      const inventoryBonusMessage =
        bonusMessageFromDb.trim() !== "" ? bonusMessageFromDb : INVENTORY_DEFAULT_BONUS_MESSAGE;

      return {
        ok: true,
        promoId: promo.id,
        code,
        discountType: "inventory",
        discountValue: 0,
        discountAmount: 0,
        finalPrice: totalPrice,
        replacesVolumeDiscount: false,
        bonusMessage: inventoryBonusMessage,
        ...(giftDescription !== undefined ? { giftDescription } : {}),
      };
    }

    const discountValue = Number(promo.discountValue ?? 0);

    if (!Number.isFinite(discountValue)) {
      return { ok: false, error: "invalid_promo_configuration" };
    }

    let discountAmount = 0;
    let replacesVolumeDiscount = false;
    let resolvedDiscountValue = discountValue;

    if (discountType === "percent" || discountType === "startup") {
      if (discountValue < 0 || discountValue > 100) {
        return { ok: false, error: "invalid_promo_configuration" };
      }
      discountAmount = Math.round((discountableTotal * discountValue) / 100);
      replacesVolumeDiscount = true;
    } else if (discountType === "fixed") {
      if (discountValue < 0) {
        return { ok: false, error: "invalid_promo_configuration" };
      }
      discountAmount = Math.min(discountValue, totalPrice);
      replacesVolumeDiscount = false;
      resolvedDiscountValue = discountValue;
    }

    const finalPrice = Math.max(0, totalPrice - discountAmount);

    return {
      ok: true,
      promoId: promo.id,
      code,
      discountType,
      discountValue: resolvedDiscountValue,
      discountAmount,
      finalPrice,
      replacesVolumeDiscount,
      bonusMessage: bonusMessageFromDb,
    };
  },
}));
