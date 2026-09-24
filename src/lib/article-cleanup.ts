import { parseHTML } from "linkedom";

const CLUTTER_TOKEN =
  /(^|[-_])(newsletters?|subscribe|subscription|signup|sign-up|share|sharing|social|related|recommended|recommendations|promo|promos|sponsored|advert|advertisement|ad|ads|avatar|author-bio|follow|comments?|popular|most-read|read-more|more-from|outbrain|taboola|toast|tooltip|clipboard|cta|paywall|recirc|recirculation)([-_]|$)/i;

const CLUTTER_LABEL =
  /^(follow|following|share|copy link|sign up|sign in|subscribe|advertisement|ad|read more|related|recommended|more from|most popular|see more|see all|continue reading)\b/i;
const CLUTTER_PHRASE = /(link copied|copied to clipboard|newsletter|free sign ?up|sign up for|subscribe to|advertisement)/i;
// Specific enough to also remove somewhat longer blocks without hitting normal article sentences.
const CALL_TO_ACTION = new RegExp(
  [
    "(sign[ -]?up|subscribe|register)\\b[^.!?]{0,60}\\b(newsletter|mailing list|inbox|updates)",
    "free (sign[ -]?up|newsletter)",
    "\\b(join|follow|find) us on\\b",
    "\\b(telegram|whatsapp|discord|signal) (channel|group|community)",
    "download (our|the) app",
    "support (our|independent) journalism",
    "become a (member|subscriber|supporter)",
    "(delivered|straight) (to|into) your inbox",
    "meld je aan voor (de|onze) nieuwsbrief",
    "volg ons op",
  ].join("|"),
  "i"
);

const AUTHOR_BIO =
  /^([A-Z][\p{L}'.-]+ ){1,3}(is|was) (a|an|the|our)\b.{0,160}\b(writer|reporter|editor|journalist|critic|correspondent|contributor|columnist|author|freelancer|host|redacteur|verslaggever)s?\b/u;
const AUTHOR_BIO_EDGE_BLOCKS = 3;

const SMALL_IMAGE_PX = 200;
const LOOSE_IMAGE_MIN_PX = 600;
const IMAGE_HINT = /(avatar|author|headshot|profile|logo|icon|badge|sprite|placeholder)/i;
const IMAGE_FILE = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;

function tokensOf(el: Element): string[] {
  return `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""} ${el.getAttribute("data-component") ?? ""}`
    .split(/\s+/)
    .filter(Boolean);
}

function text(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isSmallImage(img: Element): boolean {
  const w = Number(img.getAttribute("width"));
  const h = Number(img.getAttribute("height"));
  return (w > 0 && w < SMALL_IMAGE_PX) || (h > 0 && h < SMALL_IMAGE_PX);
}

function imageKey(src: string | null): string | null {
  if (!src) return null;
  try {
    const url = new URL(src, "https://x.invalid");
    return url.pathname.split("/").filter(Boolean).pop()?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// Before Readability: drop widgets that sites put inside the article body.
// Large blocks are kept even when a class matches, so a wrapper like "article-body share-enabled" survives.
export function stripPageClutter(document: Document): void {
  document
    .querySelectorAll("script, style, noscript, iframe, form, button, svg, dialog, aside, nav, footer, [role=complementary], [role=dialog]")
    .forEach((el) => el.remove());

  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (!el.isConnected) continue;
    if (!tokensOf(el).some((t) => CLUTTER_TOKEN.test(t))) continue;
    if (text(el).length > 1000 || el.querySelectorAll("p").length >= 3) continue;
    el.remove();
  }
}

// After Readability: remove leftovers that only make sense on the original site.
function squash(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function cleanArticleContent(
  html: string,
  heroImageUrl: string | null,
  meta: { byline: string | null; siteName: string | null }
): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const heroKey = imageKey(heroImageUrl);

  for (const link of Array.from(document.querySelectorAll("a"))) {
    const img = link.querySelector("img");
    if (!img) continue;
    const href = link.getAttribute("href") ?? "";
    const opensImage = IMAGE_FILE.test(href) || imageKey(href) === imageKey(img.getAttribute("src"));
    if (!opensImage && text(link).length < 120) link.remove();
  }

  for (const img of Array.from(document.querySelectorAll("img"))) {
    const hints = `${img.getAttribute("class") ?? ""} ${img.getAttribute("alt") ?? ""} ${img.getAttribute("src") ?? ""}`;
    const inByline = img.closest("[class*=byline], [class*=author], [class*=contributor]");
    const duplicateHero = heroKey !== null && imageKey(img.getAttribute("src") ?? img.getAttribute("data-src")) === heroKey;
    if (isSmallImage(img) || IMAGE_HINT.test(hints) || inByline || duplicateHero) {
      (img.closest("figure") ?? img).remove();
    }
  }

  // Editorial photos sit in their own <figure>; a bare <img> is kept only when it declares a large size.
  for (const img of Array.from(document.querySelectorAll("img"))) {
    if (img.closest("figure")) continue;
    if (Number(img.getAttribute("width")) >= LOOSE_IMAGE_MIN_PX) continue;
    img.remove();
  }

  for (const el of Array.from(document.querySelectorAll("p, li, div, section, blockquote, span, h2, h3, h4, h5, h6, figcaption"))) {
    if (!el.isConnected) continue;
    const t = text(el);
    if (
      (t.length < 40 && CLUTTER_LABEL.test(t)) ||
      (t.length < 160 && CLUTTER_PHRASE.test(t)) ||
      (t.length < 300 && CALL_TO_ACTION.test(t))
    ) {
      el.remove();
    }
  }

  for (const list of Array.from(document.querySelectorAll("ul, ol"))) {
    const items = Array.from(list.querySelectorAll("li"));
    const allLinks = items.length > 0 && items.every((li) => {
      const links = Array.from(li.querySelectorAll("a"));
      return links.length > 0 && links.map(text).join(" ") === text(li);
    });
    if (allLinks) list.remove();
  }

  // Author bios ("Jane Doe is a movie and TV writer at …") sit at the very end of the piece, or at the
  // very start. A real lead can read the same ("Sally Rooney is a writer who…"), so at the start the
  // paragraph must also name the site or the article's own author.
  const paragraphs = Array.from(document.querySelectorAll("p"));
  const site = meta.siteName ? squash(meta.siteName) : "";
  const author = meta.byline ? squash(meta.byline.replace(/^(by|door)\s+/i, "")) : "";
  for (const [i, p] of paragraphs.entries()) {
    const atStart = i < AUTHOR_BIO_EDGE_BLOCKS;
    const atEnd = i >= paragraphs.length - AUTHOR_BIO_EDGE_BLOCKS;
    if (!atStart && !atEnd) continue;
    const t = text(p);
    if (t.length >= 400 || !AUTHOR_BIO.test(t)) continue;
    const flat = squash(t);
    const namesSource = (site.length > 2 && flat.includes(site)) || (author.length > 2 && flat.startsWith(author));
    if ((atEnd && !atStart) || namesSource) p.remove();
  }

  return document.body.innerHTML;
}
