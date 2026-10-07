"use client";
import { normalizeWhyUsCards, whyUsIcons, type WhyUsCard, type WhyUsIcon as IconName } from "@/lib/why-us";
import { WhyUsIcon } from "@/components/sections/WhyUsIcon";

export function WhyUsCardsEditor({ value, onChange }: { value?: WhyUsCard[]; onChange: (cards: WhyUsCard[]) => void }) {
  const cards = (value ? [...value] : normalizeWhyUsCards(undefined)).sort((a, b) => a.order - b.order);
  const input = "mt-2 block w-full min-w-0 rounded-xl border border-white/10 bg-zinc-900 p-3 text-white";
  function update(id: string, patch: Partial<WhyUsCard>) { onChange(cards.map(card => card.id === id ? { ...card, ...patch } : card)); }
  function reorder(id: string, order: number) {
    const previous = cards.find(card => card.id === id)!.order;
    onChange(cards.map(card => card.id === id ? { ...card, order } : card.order === order ? { ...card, order: previous } : card));
  }
  return <div className="grid min-w-0 gap-4">{cards.map(card => <fieldset key={card.id} className="min-w-0 space-y-4 rounded-2xl border border-white/15 p-4 sm:p-5">
    <legend className="px-2 font-bold">Tarjeta {card.order}</legend>
    <label className="flex items-center gap-3"><input type="checkbox" checked={card.enabled} onChange={e => update(card.id, { enabled: e.target.checked })} />Mostrar tarjeta</label>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="block text-sm">Ícono<select value={card.icon} onChange={e => update(card.id, { icon: e.target.value as IconName })} className={input}>{Object.entries(whyUsIcons).map(([icon, label]) => <option key={icon} value={icon}>{label}</option>)}</select></label>
      <label className="block text-sm">Orden<select value={card.order} onChange={e => reorder(card.id, Number(e.target.value))} className={input}>{[1, 2, 3].map(order => <option key={order} value={order}>{order}</option>)}</select></label>
    </div>
    <div className="h-12 w-12 text-white"><WhyUsIcon icon={card.icon} /></div>
    <label className="block text-sm">Título<input maxLength={120} required value={card.title} onChange={e => update(card.id, { title: e.target.value })} className={input} /></label>
    <label className="block text-sm">Descripción<textarea maxLength={600} rows={3} value={card.description} onChange={e => update(card.id, { description: e.target.value })} className={input} /></label>
  </fieldset>)}</div>;
}
