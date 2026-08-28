type SectionTitleProps = {
  eyebrow?: string;
  title: string;
  align?: "left" | "center";
  className?: string;
};

export function SectionTitle({
  eyebrow,
  title,
  align = "left",
  className = "",
}: SectionTitleProps) {
  const alignmentClass =
    align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl text-left";

  return (
    <div className={`${alignmentClass} ${className}`.trim()}>
      {eyebrow ? (
        <span className="mb-3 inline-block rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-red-400">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
        {title}
      </h2>
    </div>
  );
}
