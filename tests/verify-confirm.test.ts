import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/verify/confirm with Firebase, the DB, the queue and rate limits mocked.
// The real firebase-admin is exercised in the token tests at the bottom (no network needed:
// it rejects malformed and wrong-project tokens before fetching Google's keys).

const mocks = vi.hoisted(() => ({
  verifyPhoneIdToken: vi.fn(),
  findScan: vi.fn(),
  upsertLead: vi.fn(),
  enqueuePdf: vi.fn(),
  enqueueLeadWebhook: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/firebase-admin")>()),
  verifyPhoneIdToken: mocks.verifyPhoneIdToken,
}));
vi.mock("@/lib/db", () => ({ db: { scan: { findUnique: mocks.findScan }, lead: { upsert: mocks.upsertLead } } }));
vi.mock("@/lib/queue", () => ({ enqueuePdf: mocks.enqueuePdf, enqueueLeadWebhook: mocks.enqueueLeadWebhook }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimits: vi.fn(async () => null) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.setCookie }) }));

const { POST } = await import("@/app/api/verify/confirm/route");
const { VerifyError, checkPhoneClaims, verifyPhoneIdToken: realVerify } =
  await vi.importActual<typeof import("@/lib/firebase-admin")>("@/lib/firebase-admin");
const { verifyUnlock } = await import("@/lib/unlock");

const SCAN_ID = "AbCdEfGhIjKlMnOpQrStU";
const TOKEN = "x".repeat(900);

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/verify/confirm", { method: "POST", body: JSON.stringify(body) }));
const valid = { scanId: SCAN_ID, role: "owner", idToken: TOKEN };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findScan.mockResolvedValue({ id: SCAN_ID });
  mocks.upsertLead.mockResolvedValue({ id: "lead_1" });
  mocks.enqueuePdf.mockResolvedValue({});
  mocks.enqueueLeadWebhook.mockResolvedValue({});
  mocks.verifyPhoneIdToken.mockResolvedValue({ uid: "uid_1", phoneE164: "+919876543210" });
});

describe("POST /api/verify/confirm", () => {
  it("sets the unlock cookie, upserts the lead and queues the PDF", async () => {
    const res = await call(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [name, value, opts] = mocks.setCookie.mock.calls[0];
    expect(name).toBe(`unlock_${SCAN_ID}`);
    expect(verifyUnlock(value, SCAN_ID)).toMatchObject({ scanId: SCAN_ID, leadId: "lead_1" });
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax" });

    expect(mocks.upsertLead).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scanId_phoneE164: { scanId: SCAN_ID, phoneE164: "+919876543210" } },
        create: expect.objectContaining({ channel: "firebase_sms", countryCode: "IN", role: "owner", firebaseUid: "uid_1" }),
      }),
    );
    expect(mocks.enqueuePdf).toHaveBeenCalledWith(SCAN_ID, "lead_1");
  });

  it("keys the lead on scan + phone, so a second unlock reuses it", async () => {
    await call(valid);
    await call({ ...valid, role: "marketing" });
    const wheres = mocks.upsertLead.mock.calls.map(([arg]) => JSON.stringify(arg.where));
    expect(new Set(wheres).size).toBe(1);
  });

  it("rejects a bad, stale or non-phone token with 401 and no cookie", async () => {
    mocks.verifyPhoneIdToken.mockRejectedValue(new VerifyError("sign-in too old"));
    const res = await call(valid);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "VERIFY_FAILED" });
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.upsertLead).not.toHaveBeenCalled();
  });

  it("rejects a number outside PHONE_COUNTRIES with 403", async () => {
    mocks.verifyPhoneIdToken.mockResolvedValue({ uid: "uid_2", phoneE164: "+4930123456789" }); // DE
    const res = await call(valid);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "COUNTRY_NOT_SUPPORTED" });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("validates input and the scan", async () => {
    expect((await call({ ...valid, scanId: "nope" })).status).toBe(400);
    expect((await call({ ...valid, role: "ceo" })).status).toBe(400);
    expect((await call({ ...valid, idToken: "short" })).status).toBe(400);
    mocks.findScan.mockResolvedValue(null);
    expect((await call(valid)).status).toBe(404);
    expect(mocks.verifyPhoneIdToken).not.toHaveBeenCalled();
  });

  it("still unlocks when the PDF can't be queued", async () => {
    mocks.enqueuePdf.mockRejectedValue(new Error("redis down"));
    expect((await call(valid)).status).toBe(200);
  });
});

describe("phone ID token checks", () => {
  const now = Date.UTC(2026, 9, 23, 12);
  const claims = (over: object = {}) => ({
    uid: "u",
    auth_time: now / 1000 - 30,
    phone_number: "+16505550100",
    firebase: { sign_in_provider: "phone", identities: {} },
    ...over,
  });

  it("accepts a fresh phone sign-in", () => {
    expect(checkPhoneClaims(claims(), now)).toEqual({ uid: "u", phoneE164: "+16505550100" });
  });

  it("rejects other providers, a missing number and an old sign-in", () => {
    expect(() => checkPhoneClaims(claims({ firebase: { sign_in_provider: "password", identities: {} } }), now)).toThrow(VerifyError);
    expect(() => checkPhoneClaims(claims({ phone_number: undefined }), now)).toThrow(VerifyError);
    expect(() => checkPhoneClaims(claims({ auth_time: now / 1000 - 6 * 60 }), now)).toThrow(VerifyError);
  });

  it("firebase-admin rejects garbage and tokens for another project", async () => {
    await expect(realVerify("not-a-jwt")).rejects.toBeInstanceOf(VerifyError);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const t = Math.floor(Date.now() / 1000);
    const forged = [
      b64({ alg: "RS256", kid: "abc", typ: "JWT" }),
      b64({ aud: "other-project", iss: "https://securetoken.google.com/other-project", sub: "u", iat: t - 10, exp: t + 3000, auth_time: t - 10 }),
      "sig",
    ].join(".");
    await expect(realVerify(forged)).rejects.toBeInstanceOf(VerifyError);
  });
});
