export type WholesalePaymentMethod =
  | ""
  | "full_before_delivery"
  | "deposit_balance"
  | "pay_on_delivery"
  | "other";

export type WholesalePaymentTermsDraft = {
  method: WholesalePaymentMethod;
  advanceChoice: "20" | "30" | "50" | "other";
  customAdvancePercent: string;
  otherText: string;
};

export function parseWholesalePaymentTerms(value: string): WholesalePaymentTermsDraft {
  const terms = value.trim();
  if (terms === "Pago total antes de la entrega") {
    return { method: "full_before_delivery", advanceChoice: "30", customAdvancePercent: "", otherText: "" };
  }
  if (terms === "Pago al momento de la entrega") {
    return { method: "pay_on_delivery", advanceChoice: "30", customAdvancePercent: "", otherText: "" };
  }
  const deposit = /^Entrega a cuenta y saldo pendiente: anticipo del (\d+(?:[.,]\d+)?)%$/.exec(terms);
  if (deposit) {
    const percent = deposit[1].replace(",", ".");
    const advanceChoice = ["20", "30", "50"].includes(percent)
      ? percent as "20" | "30" | "50"
      : "other";
    return {
      method: "deposit_balance",
      advanceChoice,
      customAdvancePercent: advanceChoice === "other" ? percent : "",
      otherText: "",
    };
  }
  const otherPrefix = "Otra condición acordada: ";
  if (terms.startsWith(otherPrefix)) {
    return { method: "other", advanceChoice: "30", customAdvancePercent: "", otherText: terms.slice(otherPrefix.length) };
  }
  return terms
    ? { method: "other", advanceChoice: "30", customAdvancePercent: "", otherText: value }
    : { method: "", advanceChoice: "30", customAdvancePercent: "", otherText: "" };
}

export function getWholesaleAdvancePercent(draft: WholesalePaymentTermsDraft): number | null {
  if (draft.advanceChoice !== "other") return Number(draft.advanceChoice);
  const percent = Number(draft.customAdvancePercent);
  return Number.isFinite(percent) && percent > 0 && percent < 100 ? percent : null;
}

export function serializeWholesalePaymentTerms(draft: WholesalePaymentTermsDraft): string | null {
  switch (draft.method) {
    case "full_before_delivery":
      return "Pago total antes de la entrega";
    case "pay_on_delivery":
      return "Pago al momento de la entrega";
    case "deposit_balance": {
      const percent = getWholesaleAdvancePercent(draft);
      return percent === null ? null : `Entrega a cuenta y saldo pendiente: anticipo del ${percent}%`;
    }
    case "other": {
      const text = draft.otherText.trim();
      return text && text.length <= 300 ? `Otra condición acordada: ${text}` : null;
    }
    default:
      return null;
  }
}

export function getWholesaleAdvancePreview(total: number, percent: number) {
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
  const advance = Math.round(total * percent) / 100;
  return { advance, balance: Math.round((total - advance) * 100) / 100 };
}
