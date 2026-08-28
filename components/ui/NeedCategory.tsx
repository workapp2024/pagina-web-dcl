type NeedCategoryProps = {
  title: string;
  description: string;
  icon: string;
  href: string;
};

export function NeedCategory({ title, description, icon, href }: NeedCategoryProps) {
  return (
    <a
      href={href}
      className="group flex h-full flex-col rounded-2xl border border-white/10 bg-zinc-900/80 p-5 transition hover:border-red-500/50 hover:bg-zinc-900"
    >
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-red-600/15 text-xl text-red-400">
        {icon}
      </div>
      <h3 className="text-xl font-black uppercase tracking-[-0.04em] text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{description}</p>
      <span className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-red-400 transition group-hover:text-red-300">
        VER MÁS
      </span>
    </a>
  );
}
