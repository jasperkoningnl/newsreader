const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.ADMIN_API_TOKEN ?? process.env.CRON_SECRET ?? "";

async function j(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (TOKEN && !headers.has("authorization")) headers.set("authorization", `Bearer ${TOKEN}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function run() {
  const createdSource = await j("/api/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Source",
      url: `https://example.com/${Date.now()}`,
      feed_url: "https://example.com/feed.xml",
      category: "tech",
    }),
  });

  await j(`/api/sources/${createdSource.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "nieuws", active: 1 }),
  });

  await j("/api/edition/today?force=true");

  await j(`/api/sources/${createdSource.id}`, { method: "DELETE" });

  console.log("Smoke e2e OK");
}

run().catch((err) => {
  console.error("Smoke e2e FAILED", err);
  process.exit(1);
});
