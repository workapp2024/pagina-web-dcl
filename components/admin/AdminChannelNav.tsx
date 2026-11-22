import Link from "next/link";
import type { AdminChannel } from "@/lib/admin-channels";

const labels = { all: "Todos", retail: "Minorista", wholesale: "Mayorista" };
export function AdminChannelNav({ path, selected, channels, query = {}, description }: { path: string; selected: AdminChannel; channels: AdminChannel[]; query?: Record<string, string>; description?: string }) {
  return <div className="mb-6 min-w-0 space-y-3">
    {channels.length > 1 ? <nav aria-label="Canal comercial" className="flex flex-wrap gap-2">{channels.map(channel => <Link key={channel} prefetch={false} href={`${path}?${new URLSearchParams({ ...query, canal: channel })}`} aria-current={selected === channel ? "page" : undefined} className={`inline-flex min-h-12 items-center rounded-full border px-5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-red-400 ${selected === channel ? "border-red-500 bg-red-600/15 text-red-200" : "border-white/15 text-zinc-300"}`}>{labels[channel]}</Link>)}</nav> : <p className="text-sm text-zinc-400">Canal minorista</p>}
    {description && <p className="text-sm text-zinc-400">{description}</p>}
  </div>;
}
