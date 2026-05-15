const WINDOWS_1252_REFERENCES: Record<number, string> = {
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ",
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  bdquo: "„",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  para: "¶",
  sect: "§",
  iquest: "¿",
  iexcl: "¡",
  szlig: "ß",
  AElig: "Æ",
  aelig: "æ",
  OElig: "Œ",
  oelig: "œ",
  Scaron: "Š",
  scaron: "š",
  Yuml: "Ÿ",
  fnof: "ƒ",
  circ: "ˆ",
  tilde: "˜",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "",
  zwj: "",
  lrm: "",
  rlm: "",
  Aacute: "Á",
  aacute: "á",
  Agrave: "À",
  agrave: "à",
  Acirc: "Â",
  acirc: "â",
  Auml: "Ä",
  auml: "ä",
  Atilde: "Ã",
  atilde: "ã",
  Aring: "Å",
  aring: "å",
  Ccedil: "Ç",
  ccedil: "ç",
  Eacute: "É",
  eacute: "é",
  Egrave: "È",
  egrave: "è",
  Ecirc: "Ê",
  ecirc: "ê",
  Euml: "Ë",
  euml: "ë",
  Iacute: "Í",
  iacute: "í",
  Igrave: "Ì",
  igrave: "ì",
  Icirc: "Î",
  icirc: "î",
  Iuml: "Ï",
  iuml: "ï",
  Ntilde: "Ñ",
  ntilde: "ñ",
  Oacute: "Ó",
  oacute: "ó",
  Ograve: "Ò",
  ograve: "ò",
  Ocirc: "Ô",
  ocirc: "ô",
  Ouml: "Ö",
  ouml: "ö",
  Otilde: "Õ",
  otilde: "õ",
  Oslash: "Ø",
  oslash: "ø",
  Uacute: "Ú",
  uacute: "ú",
  Ugrave: "Ù",
  ugrave: "ù",
  Ucirc: "Û",
  ucirc: "û",
  Uuml: "Ü",
  uuml: "ü",
  Yacute: "Ý",
  yacute: "ý",
  yuml: "ÿ",
};

function codePointFromNumericReference(value: number): string | null {
  if (!Number.isInteger(value) || value <= 0) return null;
  if (WINDOWS_1252_REFERENCES[value]) return WINDOWS_1252_REFERENCES[value];
  if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null;
  return String.fromCodePoint(value);
}

export function decodeHtmlEntities(input: string): string {
  let decoded = input;

  for (let i = 0; i < 3; i++) {
    const next = decoded
      .replace(/&#(\d+);?/g, (whole, dec: string) => {
        const char = codePointFromNumericReference(Number.parseInt(dec, 10));
        return char ?? whole;
      })
      .replace(/&#x([0-9a-f]+);?/gi, (whole, hex: string) => {
        const char = codePointFromNumericReference(Number.parseInt(hex, 16));
        return char ?? whole;
      })
      .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (whole, name: string) => NAMED_ENTITIES[name] ?? whole);

    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
}

export function stripHtmlTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/p\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function cleanHtmlText(input: string): string {
  return decodeHtmlEntities(stripHtmlTags(decodeHtmlEntities(input)))
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
