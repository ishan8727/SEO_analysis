import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";

// Every outbound request to a user-supplied URL goes through this module (SPEC.md section 10).

export class SsrfError extends Error {
  constructor(
    public readonly reason:
      | "INVALID_URL"
      | "BLOCKED_HOST"
      | "PRIVATE_ADDRESS"
      | "TOO_MANY_REDIRECTS"
      | "TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

export const MAX_URL_LENGTH = 2048;
export const MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Hosts we never audit or fetch (exact match or any subdomain). */
export const DENIED_HOSTS = [
  "google.com",
  "facebook.com",
  "localhost",
  "local",
  "internal",
  "railway.internal",
];

/** True only for globally routable unicast addresses (rejects private, loopback, link-local, metadata, CGNAT, NAT64...). */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) addr = addr.toIPv4Address();
  return addr.range() === "unicast";
}

function isDeniedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return DENIED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Synchronous checks on a user-supplied URL: http(s) only, default ports, no credentials,
 * no IP literals, not a denied host. Throws SsrfError; returns the parsed URL.
 */
export function parsePublicUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH) throw new SsrfError("INVALID_URL", "URL is too long");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("INVALID_URL", "Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("INVALID_URL", "Only http and https URLs are allowed");
  }
  if (url.username || url.password) throw new SsrfError("INVALID_URL", "Credentials in URL are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new SsrfError("INVALID_URL", "Only ports 80 and 443 are allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) throw new SsrfError("BLOCKED_HOST", "IP addresses are not allowed");
  if (!host.includes(".") || isDeniedHost(host)) throw new SsrfError("BLOCKED_HOST", "This host can't be audited");
  return url;
}

type LookupFn = typeof dns.lookup;

/**
 * A dns.lookup replacement that fails when any resolved address is not public.
 * Used at socket-connect time, so redirects and DNS rebinding are covered too.
 */
export function createGuardedLookup(resolve: LookupFn = dns.lookup) {
  return function guardedLookup(
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ) {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "");
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
        return callback(new SsrfError("PRIVATE_ADDRESS", `Blocked non-public address for ${hostname}`), "");
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

/** Resolves the host and throws unless every address is public. For pre-checks (e.g. before Moli navigates). */
export async function assertPublicUrl(raw: string, resolve: LookupFn = dns.lookup): Promise<URL> {
  const url = parsePublicUrl(raw);
  const lookup = createGuardedLookup(resolve);
  await new Promise<void>((ok, fail) =>
    lookup(url.hostname, {}, (err) => (err ? fail(err) : ok())),
  );
  return url;
}

let agent: Agent | undefined;
function guardedAgent(): Agent {
  agent ??= new Agent({ connect: { lookup: createGuardedLookup(), timeout: 10_000 } });
  return agent;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface SafeResponse {
  url: string; // final URL after redirects
  status: number;
  headers: Headers;
  body: Buffer; // empty for HEAD
}

/** Fetches a user-supplied URL with SSRF protection, manual redirect checks, a timeout and a body cap. */
export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { method = "GET", timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = options;
  const signal = AbortSignal.timeout(timeoutMs);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  let url = parsePublicUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      signal,
      dispatcher: guardedAgent(),
      headers: { "user-agent": `LocalSEOAudit/1.0 (+${appUrl})`, ...options.headers },
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = parsePublicUrl(new URL(location, url).toString());
      continue;
    }

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new SsrfError("TOO_LARGE", "Response is too large");
    }

    const chunks: Buffer[] = [];
    let size = 0;
    if (method !== "HEAD" && res.body) {
      for await (const chunk of res.body) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          await res.body.cancel().catch(() => {});
          throw new SsrfError("TOO_LARGE", "Response is too large");
        }
        chunks.push(Buffer.from(chunk));
      }
    }
    return { url: url.toString(), status: res.status, headers: res.headers as unknown as Headers, body: Buffer.concat(chunks) };
  }

  throw new SsrfError("TOO_MANY_REDIRECTS", `More than ${MAX_REDIRECTS} redirects`);
}
