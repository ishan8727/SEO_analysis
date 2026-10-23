# Run it on your PC

Easy steps to run the Local SEO Audit on Windows and try every part of it: search, live scan, score, report,
phone unlock and PDF. Commands are for **PowerShell**, run from the `project` folder.

> Already set up on this PC: the tools in step 1, the `.env` file, and the database tables.
> If that's you, jump to **[Start it](#4-start-it)**.

## 1. Install the tools (once)

| Tool | Version | Check with |
|---|---|---|
| Node.js | 22.12 or newer | `node -v` |
| pnpm | 12 | `pnpm -v` (install: `npm install -g pnpm`) |
| Podman Desktop (or Docker Desktop) | any recent | `podman -v` |
| Git | any | `git -v` |

Podman runs three helper services for us: the database (Postgres), the queue (Redis) and the headless
browser (Moli). If you use Docker instead, replace `podman compose` with `docker compose` below.

## 2. Get the code and packages (once)

```powershell
git clone https://github.com/ishanchaudhary-eng/TSI_Business_Analyzer.git
cd TSI_Business_Analyzer\project
pnpm install
pnpm db:generate
```

## 3. Fill in `.env` (once)

```powershell
Copy-Item .env.example .env
notepad .env
```

Fill these in. Everything not listed can stay as it is.

| Setting | What to put |
|---|---|
| `HASH_SALT`, `COOKIE_SECRET`, `INTERNAL_TOKEN`, `MOLI_TOKEN` | Four different random values. Make each one with:<br/>`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NEXT_PUBLIC_GOOGLE_BROWSER_KEY` | Google Maps browser key (search box). In Google Cloud, its website list must include `http://localhost:3000/*`. |
| `GOOGLE_SERVER_KEY`, `PSI_API_KEY` | Google server key (Places + PageSpeed). `PSI_API_KEY` can be the same key. |
| `GEMINI_API_KEY` | From Google AI Studio (review analysis). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | For your PC use Cloudflare's invisible test keys (always pass, nothing shown):<br/>`1x00000000000000000000BB` / `1x0000000000000000000000000000000AA` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web app API key (project `tsi-project-cd47e`). |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `tsi-project-cd47e.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `FIREBASE_PROJECT_ID` | `tsi-project-cd47e` |
| `NEXT_PUBLIC_PHONE_COUNTRIES` | Same country list as Firebase's SMS region policy, e.g. `IN,US,GB,AE,AU,CA` |

No Google or Gemini keys yet? You can still see the whole UI with demo data (step 5).

## 4. Start it

**One command** (in the `project` folder):

```powershell
pnpm start:app
```

It starts Podman if needed, brings up the helper services (database, queue, browser), applies database
migrations, then runs the website and the worker together in that window (lines start with `[web]` or
`[worker]`). Ctrl+C stops the website and worker; the helper services keep running.

Both the website **and** the worker must be running. With only the website, a scan sits on "Waiting" forever
because nothing picks up its jobs.

**Or by hand, in three PowerShell windows:**

**Window 1: helper services** (database, queue, browser)

```powershell
podman machine start          # only if Podman isn't running yet
podman compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis moli
pnpm prisma migrate deploy    # creates or updates the database tables; safe to run every time
```

**Window 2: the website**

```powershell
pnpm dev
```

**Window 3: the worker** (runs the audits and makes PDFs)

```powershell
pnpm worker:dev
```

Open **http://localhost:3000**. To check everything is connected, open http://localhost:3000/api/health:
it should say `"ok"` for `db`, `redis` and `moli`.

## 5. What to try

### A. A real audit (needs the Google + Gemini keys)
1. On http://localhost:3000, pick a category and type a business name. Pick it from the list.
2. You land on the live scan page: watch the steps tick off (about a minute).
3. See the score ring, the five pillar bars, the homepage screenshots and the first 2 fixes.
   Competitor names, the other fixes and review insights are blurred.
4. Or switch to **Website only**, type any website and press **Audit my website**.

### B. The full report and PDF without a phone (demo data, no keys needed)
```powershell
pnpm seed:demo
```
It prints a report link and a line starting with `document.cookie = ...`.
1. Open http://localhost:3000, press **F12** → **Console**, paste the `document.cookie = ...` line, press Enter.
2. Open the printed report link. You see the full report: every fix, the competitor map and table, review
   insights, the Google profile checklist and website details.
3. The **Download PDF** button appears once the worker has made the PDF (a few seconds; Window 3 must be running).

Other demo modes: `pnpm seed:demo --live` (watch a scan "run" step by step) and `pnpm seed:demo --online`
(a website-only audit).

### C. The phone unlock
1. On a scan page that's still locked, scroll to **Unlock your full report**.
2. Pick your role, check the country code, and enter a number:
   - **Free test number:** country United States, number `650 555 0100`, then code `123456`. No SMS is sent.
   - **Real number:** you get a real SMS (about $0.07 to India; the first 10 a day are free).
3. Press **Text me a code**. reCAPTCHA may show a picture puzzle first.
4. Enter the code and press **Unlock my report**. You go to the full report.

**Test the unlock on `dev.thesalesinc.com`, not `localhost`.** Firebase rejects phone sign-in from
`localhost` with "We couldn't check you're human…" (Firebase bug
[#8387](https://github.com/firebase/firebase-js-sdk/issues/8387)), even with the test number. Once per PC,
in PowerShell **as Administrator**:

```powershell
Add-Content C:\Windows\System32\drivers\etc\hosts "127.0.0.1 dev.thesalesinc.com"
```

Then open the scan at **http://dev.thesalesinc.com:3000/scan/...** (same app, just another name for this
PC). Firebase's authorized domains and its browser key already allow it. For the search box and the
Turnstile check to work there too, add `http://dev.thesalesinc.com:3000/*` to the Maps browser key and
`dev.thesalesinc.com` to the Turnstile widget's hostnames. An unlock on one name doesn't carry over to the
other (the cookie belongs to the name).

## 6. Stop it

- Windows 2 and 3: press **Ctrl + C**.
- Helper services: `podman compose stop postgres redis moli`

Your data stays in the database for next time.

## 7. If something goes wrong

| Problem | Fix |
|---|---|
| `Port 3000 is already in use` | Something else (often an old `pnpm dev`) holds it. Close it, or stop all project Node processes:<br/>`Get-CimInstance Win32_Process -Filter "Name='node.exe'" \| ? { $_.CommandLine -like "*project*" } \| % { taskkill /PID $_.ProcessId /T /F }` |
| `/api/health` shows `"down"` | Window 1's services aren't running: run the `podman compose ... up -d` line again (and `podman machine start` first). |
| Search box says "Search is unavailable" | The browser key is missing, or `http://localhost:3000/*` isn't in its website list in Google Cloud. |
| Picking a business gives "Something went wrong" | `GOOGLE_SERVER_KEY` is missing or wrong. Window 2 shows the reason. |
| The scan page never moves | The worker (Window 3) isn't running. |
| "Preparing your PDF…" never finishes | Worker or Moli is down, or `INTERNAL_TOKEN` is empty in `.env`. |
| The human check fails | Use the Turnstile test keys from step 3 on your PC. |

## 8. Run everything in containers instead (optional)

One command, no Node windows. It rebuilds the app image, so it takes a few minutes the first time:

```powershell
podman compose up -d --build
```

Open http://localhost:3000. Stop with `podman compose stop`. Don't run this while `pnpm dev` is using port 3000.

## 9. Checks for developers

```powershell
pnpm typecheck; pnpm lint; pnpm test; pnpm build; pnpm build:worker
```

`pnpm test` needs Redis from Window 1. See `architecture.md` for how the pieces connect and `TODO.md` for progress.
