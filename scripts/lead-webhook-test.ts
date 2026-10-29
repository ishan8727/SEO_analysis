// Sends one sample lead to the Make.com webhook, marked "test": true, with every field filled so
// Make can learn the data structure. Same payload builder as the real job (src/worker/jobs/lead-webhook.ts).
//   pnpm lead:test <webhook-url>     (or set LEAD_WEBHOOK_URL)
import { buildLeadPayload, postLead, type LeadRow } from "@/worker/jobs/lead-webhook";

const url = process.argv[2] ?? process.env.LEAD_WEBHOOK_URL;
if (!url) {
  console.error("Usage: pnpm lead:test <webhook-url>");
  process.exit(1);
}

const now = new Date();
const sample: LeadRow = {
  id: "test_lead",
  phoneE164: "+16505550100", // Firebase test number, not a real person
  countryCode: "US",
  role: "owner",
  verifiedAt: now,
  channel: "firebase_sms",
  scan: {
    id: "TestScan000000000000x",
    status: "done",
    createdAt: new Date(now.getTime() - 60_000),
    finishedAt: now,
    score: {
      total: 68,
      grade: "C",
      pillars: { gbp: 75, reputation: 70, competitive: 60, webTech: 55, onPage: 80 },
      rank: { position: 4, of: 10 },
      fixes: [
        { key: "gbp.photos", pillar: "gbp", text: "Add at least 10 photos to your Google profile", pointsLost: 4, effort: 1 },
        { key: "onPage.metaDescription", pillar: "onPage", text: "Write a meta description for your homepage", pointsLost: 3, effort: 1 },
        { key: "webTech.psiMobile", pillar: "webTech", text: "Make your homepage load faster on phones", pointsLost: 6, effort: 3 },
      ],
    },
    placeSnapshot: {
      internationalPhoneNumber: "+1 650-555-0199",
      googleMapsUri: "https://maps.google.com/?cid=0",
      countryCode: "US",
    },
    business: {
      name: "Test Dental Clinic (sample)",
      websiteUrl: "https://example.com",
      address: "1 Example Street, Mountain View, CA 94043, USA",
      primaryType: "dentist",
      placeId: "ChIJtest000000000000000",
      mode: "local",
    },
  },
};

const payload = buildLeadPayload(sample, process.env.APP_URL ?? "https://audit.example.com", now, true);
await postLead(url, payload);
console.log(`Sent a test lead (${payload.lead.phone}, ${payload.business.name}) to the webhook.`);
