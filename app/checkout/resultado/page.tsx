import type { Metadata } from "next";
import { CheckoutResult } from "@/components/store/CheckoutResult";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Resultado({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const params = await searchParams;
  return <CheckoutResult orderNumber={params.pedido || ""} publicKey={process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY || ""} />;
}
