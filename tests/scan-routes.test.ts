import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUnlock } from "@/lib/unlock";

// GET /api/scans/:id and /api/scans/:id/assets/:kind with the DB and rate limits mocked: a script
// calling the API without the unlock cookie (phone not verified) gets no results.

const mocks = vi.hoisted(() => ({ findScan: vi.fn(), findAsset: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { scan: { findUnique: mocks.findScan }, asset: { findUnique: mocks.findAsset } } }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimits: vi.fn(async () => null) }));

const { GET: getScan } = await import("@/app/api/scans/[id]/route");
const { GET: getAsset } = await import("@/app/api/scans/[id]/assets/[kind]/route");

const SCAN_ID = "AbCdEfGhIjKlMnOpQrStU";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
const unlockCookie = `unlock_${SCAN_ID}=${signUnlock(SCAN_ID, "lead_1")}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findScan.mockResolvedValue({
    id: SCAN_ID,
    status: "done",
    progress: { gbp: "done", finalize: "done" },
    placeSnapshot: null,
    gbp: null,
    competitors: { radiusM: 3000, primaryType: "dentist", items: [{ placeId: "c1", name: "Secret Rival Dental" }] },
    psi: null,
    domAudit: null,
    sentiment: null,
    score: { total: 62, grade: "C", pillars: { gbp: 80 }, rank: null, fixes: [{ key: "k", pillar: "gbp", text: "FIX_TEXT", pointsLost: 5, effort: 1 }] },
    error: null,
    business: { mode: "local", name: "Sharma Dental", address: null, websiteUrl: null, lat: 1, lng: 2 },
    assets: [{ kind: "screenshot_mobile" }],
  });
  mocks.findAsset.mockResolvedValue({ mime: "image/jpeg", bytes: Buffer.from("jpeg") });
});

describe("GET /api/scans/:id", () => {
  const call = (cookie?: string) => getScan(request(`/api/scans/${SCAN_ID}`, cookie), { params: Promise.resolve({ id: SCAN_ID }) });

  it("returns status only without the unlock cookie", async () => {
    const res = await call();
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ verification: "not_verified", status: "done" });
    for (const secret of ['"score"', "62", "FIX_TEXT", "Secret Rival Dental", "screenshot"]) expect(text).not.toContain(secret);
  });

  it("ignores a forged or other scan's cookie", async () => {
    const other = `unlock_${SCAN_ID}=${signUnlock("ZZZZZZZZZZZZZZZZZZZZZ", "lead_1")}`;
    expect(await (await call(other)).json()).toMatchObject({ verification: "not_verified" });
    expect(await (await call(`unlock_${SCAN_ID}=garbage.sig`)).json()).toMatchObject({ verification: "not_verified" });
  });

  it("returns the results once verified", async () => {
    const body = await (await call(unlockCookie)).json();
    expect(body).toMatchObject({ verification: "verified", score: { total: 62 }, fixes: [{ text: "FIX_TEXT" }] });
  });
});

describe("GET /api/scans/:id/assets/:kind", () => {
  const call = (kind: string, cookie?: string) =>
    getAsset(request(`/api/scans/${SCAN_ID}/assets/${kind}`, cookie), {
      params: Promise.resolve({ id: SCAN_ID, kind }),
    });

  it("refuses screenshots and the PDF without the unlock cookie", async () => {
    for (const kind of ["screenshot_mobile", "screenshot_desktop", "pdf"]) expect((await call(kind)).status).toBe(401);
    expect(mocks.findAsset).not.toHaveBeenCalled();
  });

  it("serves a screenshot once verified", async () => {
    const res = await call("screenshot_mobile", unlockCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});
