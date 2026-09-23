import SaveUrl from "./save-url";

export default async function SavePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; text?: string; title?: string }>;
}) {
  const { url, text, title } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-14">
      <h1 className="text-5xl font-bold tracking-[-0.03em]">Save</h1>
      <SaveUrl initialUrl={url ?? null} initialText={text ?? null} initialTitle={title ?? null} />
    </div>
  );
}
