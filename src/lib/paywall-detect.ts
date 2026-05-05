import { assertSafePublicUrl } from "./net-safety";

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 256 * 1024;

const HOST_MARKERS: Array<{ host: RegExp; markers: RegExp[] }> = [
  { host: /(^|\.)nrc\.nl$/i, markers: [/data-paywall/i, /class="[^"]*\bnrc-piano\b/i] },
  { host: /(^|\.)volkskrant\.nl$/i, markers: [/data-temptation-id/i, /paywall-blocker/i] },
  { host: /(^|\.)parool\.nl$/i, markers: [/data-temptation-id/i, /paywall-blocker/i] },
  { host: /(^|\.)trouw\.nl$/i, markers: [/data-temptation-id/i, /paywall-blocker/i] },
  { host: /(^|\.)ad\.nl$/i, markers: [/data-temptation-id/i, /paywall-blocker/i] },
  { host: /(^|\.)fd\.nl$/i, markers: [/class="[^"]*\bfd-paywall\b/i] },
  { host: /(^|\.)nytimes\.com$/i, markers: [/data-testid="paywall"/i, /class="[^"]*\bcss-[a-z0-9]+ paywall\b/i] },
  { host: /(^|\.)wsj\.com$/i, markers: [/wsj-snippet-login/i, /class="[^"]*\bsnippet-promotion\b/i] },
  { host: /(^|\.)ft\.com$/i, markers: [/n-messaging-banner/i, /barrier-app/i] },
  { host: /(^|\.)bloomberg\.com$/i, markers: [/paywall-inline-tout/i] },
  { host: /(^|\.)economist\.com$/i, markers: [/subscriber-only/i, /data-test-id="paywall"/i] },
  { host: /(^|\.)theinformation\.com$/i, markers: [/article-locked/i] },
];

export type PaywallVerdict = {
  is_paywall: boolean | null;
  reason: string;
};

async function fetchHtmlSnippet(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsreaderBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok || !res.body) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let html = "";
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function checkJsonLd(html: string): boolean | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  let sawSignal = false;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const verdict = scanJsonLd(parsed);
    if (verdict === true) return true;
    if (verdict === false) sawSignal = true;
  }
  return sawSignal ? false : null;
}

function scanJsonLd(node: unknown): boolean | null {
  if (Array.isArray(node)) {
    let sawFalse = false;
    for (const child of node) {
      const v = scanJsonLd(child);
      if (v === true) return true;
      if (v === false) sawFalse = true;
    }
    return sawFalse ? false : null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("isAccessibleForFree" in obj) {
      const v = obj.isAccessibleForFree;
      if (v === false || v === "False" || v === "false") return true;
      if (v === true || v === "True" || v === "true") return false;
    }
    let sawFalse = false;
    for (const key of Object.keys(obj)) {
      const v = scanJsonLd(obj[key]);
      if (v === true) return true;
      if (v === false) sawFalse = true;
    }
    return sawFalse ? false : null;
  }
  return null;
}

function checkContentTier(html: string): boolean | null {
  const meta = html.match(
    /<meta[^>]+property=["']article:content_tier["'][^>]+content=["']([^"']+)["']/i
  );
  if (!meta) return null;
  const value = meta[1].toLowerCase();
  if (value === "locked" || value === "metered") return true;
  if (value === "free") return false;
  return null;
}

function checkHostMarkers(host: string, html: string): boolean | null {
  const entry = HOST_MARKERS.find((e) => e.host.test(host));
  if (!entry) return null;
  return entry.markers.some((re) => re.test(html)) ? true : null;
}

export async function detectPaywall(rawUrl: string): Promise<PaywallVerdict> {
  let url: URL;
  try {
    url = await assertSafePublicUrl(rawUrl);
  } catch (err) {
    return { is_paywall: null, reason: err instanceof Error ? err.message : "unsafe_url" };
  }

  const html = await fetchHtmlSnippet(url.toString());
  if (!html) return { is_paywall: null, reason: "fetch_failed" };

  const jsonLd = checkJsonLd(html);
  if (jsonLd !== null) return { is_paywall: jsonLd, reason: jsonLd ? "jsonld_locked" : "jsonld_free" };

  const tier = checkContentTier(html);
  if (tier !== null) return { is_paywall: tier, reason: tier ? "meta_tier_locked" : "meta_tier_free" };

  const hostMatch = checkHostMarkers(url.hostname, html);
  if (hostMatch !== null) return { is_paywall: hostMatch, reason: "host_marker" };

  return { is_paywall: null, reason: "no_signal" };
}
