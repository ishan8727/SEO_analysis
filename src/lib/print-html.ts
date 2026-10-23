// Makes the print page self-contained for Moli, which can't reach our app (--block-private-networks):
// stylesheets become <style> blocks with their fonts as data URIs; external scripts, preloads and
// icons are dropped. Inline scripts stay: Next streams the page body in and moves it into place with them.

/** The worker sends INTERNAL_TOKEN to the print page in this header (never the URL, which gets logged). */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

export interface Fetchers {
  text: (url: string) => Promise<string>;
  bytes: (url: string) => Promise<{ mime: string; data: Buffer }>;
}

const STYLESHEET_RE = /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi;
const DROP_LINK_RE = /<link\b[^>]*\brel=["']?(?:preload|modulepreload|icon|shortcut icon|apple-touch-icon)["']?[^>]*>/gi;
const EXTERNAL_SCRIPT_RE = /<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi;
const HREF_RE = /\bhref=["']([^"']+)["']/i;
const CSS_URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/** Resolves a path from the page against the app's internal origin; only same-origin assets are fetched. */
function sameOrigin(ref: string, base: string): string | null {
  try {
    const url = new URL(ref, base);
    return url.origin === new URL(base).origin ? url.toString() : null;
  } catch {
    return null;
  }
}

async function inlineCssUrls(css: string, cssUrl: string, base: string, f: Fetchers): Promise<string> {
  const refs = [...new Set([...css.matchAll(CSS_URL_RE)].map((m) => m[2]).filter((r) => !r.startsWith("data:")))];
  const replacements = new Map<string, string>();
  await Promise.all(
    refs.map(async (ref) => {
      const abs = sameOrigin(new URL(ref, cssUrl).toString(), base);
      if (!abs) return;
      const { mime, data } = await f.bytes(abs);
      replacements.set(ref, `data:${mime};base64,${data.toString("base64")}`);
    }),
  );
  return css.replace(CSS_URL_RE, (whole, _q: string, ref: string) =>
    replacements.has(ref) ? `url("${replacements.get(ref)}")` : whole,
  );
}

export async function inlineForPrint(html: string, base: string, f: Fetchers): Promise<string> {
  const links = [...new Set(html.match(STYLESHEET_RE) ?? [])];
  const styles = new Map<string, string>();
  await Promise.all(
    links.map(async (tag) => {
      const href = tag.match(HREF_RE)?.[1];
      const url = href && sameOrigin(href, base);
      if (!url) return;
      styles.set(tag, `<style>${await inlineCssUrls(await f.text(url), url, base, f)}</style>`);
    }),
  );
  return html
    .replace(STYLESHEET_RE, (tag) => styles.get(tag) ?? "")
    .replace(DROP_LINK_RE, "")
    .replace(EXTERNAL_SCRIPT_RE, "");
}
