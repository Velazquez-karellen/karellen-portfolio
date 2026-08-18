export function canonicalLocale(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    return Intl.getCanonicalLocales(value.trim())[0]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

export function parseAcceptLanguage(value: string | null) {
  if (!value) return [];
  return value.split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const q = quality ? Number(quality.trim().slice(2)) : 1;
      return { locale: canonicalLocale(tag), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.locale && entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.locale);
}

export function resolveLocale(
  requested: unknown,
  acceptLanguage: string | null,
  supported: string[],
  defaultLocale: string,
) {
  const exact = (candidate: string) => supported.find((locale) => locale === candidate);
  const base = (candidate: string) => supported.find((locale) => locale.split("-")[0] === candidate.split("-")[0]);
  const candidates = [canonicalLocale(requested), ...parseAcceptLanguage(acceptLanguage)].filter(Boolean);
  for (const candidate of candidates) {
    const match = exact(candidate) ?? base(candidate);
    if (match) return match;
  }
  return supported.includes(defaultLocale) ? defaultLocale : supported[0] ?? defaultLocale;
}

export function slugify(title: string, id: string) {
  const base = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "content";
  return `${base}-${id.slice(0, 6)}`;
}

export function optionalHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
