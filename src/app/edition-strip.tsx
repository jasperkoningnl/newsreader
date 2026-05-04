import Link from "next/link";

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatLabel(activeDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayStr = ymdLocal(today);
  const yesterdayStr = ymdLocal(yesterday);

  if (activeDate === todayStr) return "Today";
  if (activeDate === yesterdayStr) return "Yesterday";

  const dt = new Date(`${activeDate}T00:00:00`);
  return dt.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

export default function EditionStrip({
  dates,
  activeDate,
}: {
  dates: string[];
  activeDate: string;
}) {
  if (dates.length < 2 && dates.includes(activeDate)) return null;

  const activeIdx = dates.indexOf(activeDate);
  const newer = activeIdx > 0 ? dates[activeIdx - 1] : null;
  const older = activeIdx >= 0 && activeIdx < dates.length - 1 ? dates[activeIdx + 1] : null;

  const todayStr = ymdLocal(new Date());
  const newerHref = newer === todayStr ? "/" : newer ? `/?date=${newer}` : null;
  const olderHref = older ? `/?date=${older}` : null;

  const chevronClass =
    "flex h-8 w-8 items-center justify-center rounded-full border text-base transition-colors";
  const enabled = "border-white/25 text-white/85 hover:bg-white/10";
  const disabled = "border-white/10 text-white/20";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 via-black/35 to-transparent">
      <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between px-5 py-3 md:max-w-xl md:px-8 md:py-4">
        {newerHref ? (
          <Link href={newerHref} aria-label="Newer edition" className={`${chevronClass} ${enabled}`}>
            ‹
          </Link>
        ) : (
          <span aria-hidden className={`${chevronClass} ${disabled}`}>‹</span>
        )}
        <span className="metadata-caps text-white/85">{formatLabel(activeDate)}</span>
        {olderHref ? (
          <Link href={olderHref} aria-label="Older edition" className={`${chevronClass} ${enabled}`}>
            ›
          </Link>
        ) : (
          <span aria-hidden className={`${chevronClass} ${disabled}`}>›</span>
        )}
      </div>
    </div>
  );
}
