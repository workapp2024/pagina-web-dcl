"use client";

import { usePathname } from "next/navigation";

import { AdminSidebar } from "@/components/admin/AdminSidebar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-8 lg:flex-row lg:gap-6 lg:px-8">
        <AdminSidebar />
        <main className="flex-1 rounded-[2rem] border border-white/10 bg-zinc-950/70 p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6">{children}</main>
      </div>
    </div>
  );
}
