import { lookup } from "dns/promises";
import { isIP } from "net";

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
];

function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_IPV4.some((r) => r.test(ip));
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export async function assertSafePublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("Local addresses are not allowed");
  }

  if (isIP(url.hostname)) {
    if (isPrivateIpv4(url.hostname) || isPrivateIpv6(url.hostname)) {
      throw new Error("Private IP addresses are not allowed");
    }
    return url;
  }

  const resolved = await lookup(url.hostname, { all: true });
  for (const addr of resolved) {
    if ((addr.family === 4 && isPrivateIpv4(addr.address)) || (addr.family === 6 && isPrivateIpv6(addr.address))) {
      throw new Error("Resolved private network address is not allowed");
    }
  }

  return url;
}
