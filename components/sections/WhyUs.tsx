"use client";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { normalizeWhyUsCards } from "@/lib/why-us";
import { WhyUsIcon } from "./WhyUsIcon";
import styles from "./WhyUs.module.css";
import { publicText, publicPresentationDefaults } from "@/lib/public-site-content";

export function WhyUs() {
  const { content } = useSiteContent();
  const settings = content.siteSettings;
  if (settings.whyUsEnabled === false) return null;
  const cards = normalizeWhyUsCards(settings.whyUsCards).filter(card => card.enabled).sort((a, b) => a.order - b.order);
  const title = publicText(settings.whyUsSectionTitle, publicPresentationDefaults.whyUsSectionTitle);
  return <section id="nosotros" aria-labelledby="why-us-title" className={styles.section}>
    <div className={styles.inner}>
      <header className={styles.header}>
        <span className={styles.accent} aria-hidden="true" />
        <h2 id="why-us-title" className={styles.title}>{title.split(/(\bDCL\b)/gi).map((part, index) => /^DCL$/i.test(part) ? <span key={index}>{part}</span> : part)}</h2>
      </header>
      {cards.length > 0 && <div className={styles.grid} data-count={cards.length}>
        {cards.map(card => <article key={card.id} className={styles.card}>
          <div className={styles.icon}><WhyUsIcon icon={card.icon} /></div>
          <h3>{card.title}</h3><span className={styles.rule} aria-hidden="true" />
          {card.description && <p>{card.description}</p>}
        </article>)}
      </div>}
    </div>
  </section>;
}
