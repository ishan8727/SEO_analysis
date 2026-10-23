import { withPage } from "@/lib/browser";

// Dev check: Moli prints HTML handed over with setContent() (how the PDF job works; Moli can't
// load our app itself). Usage: pnpm pdf:smoke
const html = `<!doctype html><html><head><style>body{font-family:sans-serif;background:#eef}h1{color:#c00}</style></head>
<body><div hidden id="S:0"><h1>Streamed in</h1></div><script>document.body.append(document.getElementById("S:0").firstChild)</script>
<p>${"Long line. ".repeat(400)}</p></body></html>`;

const pdf = await withPage(async (page) => {
  await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
  const h1 = await page.locator("h1").count();
  const bytes = await page.pdf({ format: "A4", printBackground: true });
  return { h1, bytes };
});
const head = Buffer.from(pdf.bytes).subarray(0, 5).toString();
console.log({ inlineScriptRan: pdf.h1 === 1, bytes: pdf.bytes.byteLength, header: head });
process.exit(head === "%PDF-" && pdf.h1 === 1 ? 0 : 1);
