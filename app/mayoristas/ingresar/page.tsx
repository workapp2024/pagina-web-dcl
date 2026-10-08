import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WholesaleAccessForm } from "@/components/wholesale/WholesaleAccessForm";
import { isWholesaleSessionValid } from "@/lib/wholesale-server";

export const metadata: Metadata = {
  title: "Acceso mayorista | DCL Cree LED",
  robots: { index: false, follow: false },
};

export default async function IngresarMayoristasPage() {
  if (await isWholesaleSessionValid()) redirect("/mayoristas");
  return <div className="min-h-screen bg-black text-white">
    <header className="border-b border-white/10"><div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"><Link href="/" className="text-sm font-black uppercase tracking-[0.2em]">DCL CREE LED</Link><Link href="/" className="min-h-11 content-center text-sm text-zinc-300 hover:text-white">Volver a DCL</Link></div></header>
    <WholesaleAccessForm />
  </div>;
}
