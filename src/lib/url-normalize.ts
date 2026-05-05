const TRACKING_PARAM_PREFIXES = ["utm_", "mc_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "ref_url",
  "s",
  "share",
  "shareid",
  "cmpid",
  "ncid",
  "spm",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.hostname.startsWith("www.")) url.hostname = url.hostname.slice(4);
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  const cleaned = new URLSearchParams();
  const keys = [...url.searchParams.keys()];
  for (const key of keys) {
    if (!isTrackingParam(key)) {
      for (const value of url.searchParams.getAll(key)) cleaned.append(key, value);
    }
  }
  cleaned.sort();
  url.search = cleaned.toString() ? `?${cleaned.toString()}` : "";

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}
