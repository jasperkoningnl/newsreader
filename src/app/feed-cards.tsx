"use client";

import type { EditionItem } from "./api/edition/today/route";
import { useState } from "react";

function Card({ item, index }: { item: EditionItem; index: number }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative flex flex-col h-full snap-start overflow-hidden select-none"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {item.image_url && !imgFailed ? (
        <img
          src={item.image_url}
          alt=""
          onError={() => setImgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `hsl(${(index * 47) % 360}, 30%, 12%)`,
          }}
        />
      )}

      {/* gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/10" />

      {/* scroll hint — top */}
      {index > 0 && (
        <div className="relative flex justify-center pt-3 opacity-30">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </div>
      )}

      {/* content */}
      <div className="relative mt-auto px-5 pb-6 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">
            {item.source}
          </span>
          {item.category && (
            <>
              <span className="text-white/25">·</span>
              <span className="text-xs text-white/35 uppercase tracking-wide">
                {item.category}
              </span>
            </>
          )}
        </div>
        <h2 className="text-[1.6rem] font-bold leading-tight text-white">
          {item.title}
        </h2>
        {item.description && (
          <p className="mt-2 text-sm text-white/60 line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        )}
        <div className="mt-4 flex items-center gap-1 text-xs text-white/40">
          <span>Lees verder</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </div>
      </div>

      {/* scroll hint — bottom */}
      <div className="relative flex justify-center pb-3 opacity-30">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </a>
  );
}

function EndCard({ createdAt }: { createdAt: string | null }) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="relative flex flex-col h-full snap-start items-center justify-center px-8 text-center bg-black">
      <div className="text-5xl mb-6">🌿</div>
      <h2 className="text-2xl font-bold mb-2">Dat was het voor vandaag</h2>
      <p className="text-white/40 text-sm">
        Volgende editie {tomorrowStr}
      </p>
      {createdAt && (
        <p className="mt-8 text-xs text-white/20">
          Editie van{" "}
          {new Date(createdAt).toLocaleDateString("nl-NL", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      )}
    </div>
  );
}

export default function FeedCards({
  items,
  createdAt,
}: {
  items: EditionItem[];
  createdAt: string | null;
}) {
  return (
    <div className="h-full overflow-y-scroll snap-y snap-mandatory">
      {items.map((item, i) => (
        <Card key={item.id} item={item} index={i} />
      ))}
      <EndCard createdAt={createdAt} />
    </div>
  );
}
