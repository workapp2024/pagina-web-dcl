import type { WhyUsIcon as IconName } from "@/lib/why-us";

export function WhyUsIcon({ icon }: { icon: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    car: <><path d="m15 24 5-12h24l5 12M12 43V29l4-5h32l4 5v14M12 37h40M18 43v5m28-5v5M20 31h3m18 0h3M27 37h10" /><path stroke="#ff282e" d="m5 26-4-2m4 9H1m4 7-4 2m58-17 4-2m-4 9h4m-4 7 4 2" /></>,
    bulb: <><path d="M23 43c0-9-9-10-9-22a18 18 0 0 1 36 0c0 12-9 13-9 22Zm1 7h16m-12 6h8M26 27l6 6 6-6m-6 6v10" /><path stroke="#ff282e" d="M4 20H1m62 0h-3M9 6 6 3m49 3 3-3" /></>,
    chat: <><path d="M38 40H22l-12 9 2-15a19 19 0 0 1-5-13C7 9 17 5 29 5s23 6 23 18" /><path stroke="#ff282e" d="M41 27c11-2 19 4 19 13a13 13 0 0 1-4 10l2 10-11-6c-13 1-19-4-20-13h15" /><circle cx="19" cy="23" r="1.5" /><circle cx="29" cy="23" r="1.5" /><circle cx="39" cy="23" r="1.5" /></>,
    package: <><path d="m24 18 18-10 19 11v27L42 57 23 46V19l19 11 19-11M42 30v27M33 13l19 11v12" /><path stroke="#ff282e" d="M15 28H8m8 10H3m13 10H9" /></>,
    truck: <><path d="M5 15h32v31H5Zm32 13h12l10 11v7H37M49 28v11h10" /><circle cx="17" cy="47" r="6" /><circle cx="48" cy="47" r="6" /><path stroke="#ff282e" d="M12 23h17m-17 8h11" /></>,
    shield: <><path d="M32 5 54 14v18c0 13-12 21-22 27C22 53 10 45 10 32V14Z" /><path stroke="#ff282e" d="m21 31 8 8 15-17" /></>,
    tool: <><path d="M39 8a15 15 0 0 0-17 19L7 43a8 8 0 0 0 11 11l16-16a15 15 0 0 0 20-18L43 31 33 21Z" /><path stroke="#ff282e" d="m12 48 4-4M49 7l8 8" /></>,
  };
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[icon] ?? paths.car}</svg>;
}
