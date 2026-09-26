"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { lastOrderNumber } from "@/lib/store/checkout-attempt";
export function BuyerOrderLink() {
  const [number, setNumber] = useState<string | null>(null);
  useEffect(() => { void Promise.resolve().then(() => { try { setNumber(lastOrderNumber(localStorage)); } catch { /* Storage may be disabled. */ } }); }, []);
  return number ? <p className="mb-6 rounded-xl border border-white/15 p-4 text-white">Ya tenés un pedido registrado. <Link className="font-bold text-red-300 underline" href={`/checkout/resultado?pedido=${number}`}>Ver pedido {number}</Link></p> : null;
}
