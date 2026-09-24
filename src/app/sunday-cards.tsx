import Link from "next/link";
import type { SavedThisWeek } from "./api/edition/today/route";
import type { SundayTip } from "@/lib/generate-sunday";

const TIP_STYLE = {
  game: { label: "Game tip", card: "bg-[#c8ff3c] text-black", chip: "border-black/40", muted: "text-black/60" },
  series: { label: "Series tip", card: "bg-[#b0121c] text-white", chip: "border-white/40", muted: "text-white/65" },
};

export function TipCard({ tip, feedHref }: { tip: SundayTip; feedHref: string }) {
  const style = TIP_STYLE[tip.kind];
  return (
    <Link
      href={{ pathname: `/article/${tip.article_id}`, query: { from: feedHref } }}
      className={`relative flex h-full snap-start flex-col overflow-hidden px-5 pb-6 pt-8 select-none md:h-[48vh] md:min-h-[420px] md:px-8 md:pb-8 ${style.card}`}
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <span className="metadata-caps">{style.label}</span>
      <div className="mt-auto">
        <h2 className="break-words text-[3rem] font-extrabold uppercase leading-[0.92] tracking-[-0.04em] md:text-[3.6rem]">
          {tip.name}
        </h2>
        {(tip.platforms.length > 0 || tip.when) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {tip.platforms.map((p) => (
              <span key={p} className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${style.chip}`}>
                {p}
              </span>
            ))}
            {tip.when && (
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${style.chip}`}>
                {tip.when}
              </span>
            )}
          </div>
        )}
        <p className="mt-5 text-lg leading-snug md:text-xl">{tip.text}</p>
        <p className={`mt-5 text-xs leading-relaxed ${style.muted}`}>
          Source: {tip.article_title} · {tip.source}
        </p>
      </div>
    </Link>
  );
}

export function SavedThisWeekCard({ saved }: { saved: SavedThisWeek[] }) {
  return (
    <div className="relative flex min-h-full snap-start flex-col justify-center bg-black px-6 py-10 md:col-span-2 md:h-auto md:px-8">
      <span className="metadata-caps text-white/50">Saved this week</span>
      <ul className="mt-5 space-y-4">
        {saved.map((item) => (
          <li key={item.id}>
            <Link href={`/article/${item.id}`} className="block hover:underline underline-offset-4">
              <span className="block text-lg font-semibold leading-snug">{item.title}</span>
              <span className="mt-1 block text-xs uppercase tracking-wide text-white/40">{item.source}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
