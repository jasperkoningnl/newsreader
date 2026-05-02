export default function FeedPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 text-center">
      <p className="text-4xl mb-4">📰</p>
      <h1 className="text-2xl font-bold mb-2">Geen editie vandaag</h1>
      <p className="text-white/50 text-sm max-w-xs">
        De curator genereert straks automatisch je dagelijkse feed. Voeg eerst bronnen toe via het tabblad hieronder.
      </p>
    </div>
  );
}
