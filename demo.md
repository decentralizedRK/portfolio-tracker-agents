# Presentation Generation Prompt — "Claude Code for Beginners"

Use this file as a complete prompt for any AI presentation tool. It describes every slide, the global design system, and the exact text so the deck can be regenerated faithfully. Build a **13-slide, 16:9** presentation that matches the specification below exactly.

---

## GLOBAL DESIGN SYSTEM

**Theme:** Dark "developer terminal" aesthetic. Every slide looks like a terminal/IDE window.

**Color palette (hex):**
- Background (deepest): `#0B0B12`
- Panel / card fill: `#14141C`
- Card alt fill: `#1B1B26`
- Border / divider / hairline: `#2E2E40`
- Primary accent (coral red): `#FF6B5E`  ← headings, prompt markers, numbers, icon strokes
- Green (terminal prompt / success): `#53D08A`
- Purple accent: `#A98BFF`
- Gold / yellow accent: `#F2C14E`
- Primary text (near-white): `#ECECF2`
- Muted text (gray): `#8E8EA3`

**Typography:**
- Primary font: **Consolas** (monospace) — used for nearly all text, headings, code, labels.
- Secondary font: **Calibri** — occasional supporting/body text.
- Headings: monospace, bold, prefixed with a coral `>` marker (e.g. `> Agenda`).

**Recurring chrome on every slide:**
- A faux terminal **top bar** with three colored "window dots" (red, gold, green) followed by a command-line string in muted text, e.g. `~/workshop % claude --workshop beginners`. Each slide has its own contextual command (listed per slide below).
- A thin divider line under the top bar in `#2E2E40`.
- **Footer (every slide):** left side `claude code  ·  Presenter: Rutuja Dond` (the words "claude code" in coral); right side a page counter `NN / 13` (e.g. `01 / 13`).
- Slide titles use the `> Title` pattern in coral monospace.
- Cards/panels use `#14141C` fill with `#2E2E40` borders and small rounded corners.
- Numbered steps use coral numerals or coral-outlined squares.
- Icons are thin-line, coral-stroked glyphs inside small rounded squares.

**Tone:** Clean, technical, minimal, high-contrast. Plenty of negative space. Monospace everywhere.

---

## SLIDES

### Slide 1 — Title
- Terminal command: `~ % claude --workshop beginners`
- Small eyebrow label: `BEGINNER WORKSHOP`
- Large title: **Claude Code** (white) / **for Beginners** (coral), stacked on two lines.
- Subtitle (green prompt style): `> from setup to your first shipped feature`
- `Presenter: Rutuja Dond`
- A friendly coral-outline robot/bot icon to the right.
- Footer page: `01 / 13`

### Slide 2 — Agenda
- Terminal command: `~/workshop % cat agenda.md`
- Title: `> Agenda`
- A two-column list of 7 numbered items, each with a small coral icon, a bold label, and a one-line description:
  - `01  Introduction` — What Claude Code is and why it matters
  - `02  Setup with VS Code` — Install, configure, and launch in minutes
  - `03  First Project` — Go from codebase to a shipped feature
  - `04  Commands` — The slash commands you will use daily
  - `05  Models` — Pick the right model for each job
  - `06  Token Optimization` — Get more done for less cost
  - `07  Security` — Keep code and data safe
- Footer page: `02 / 13`

### Slide 3 — What is Claude Code?
- Terminal command: `~/workshop % man claude-code`
- Title: `> What is Claude Code?`
- Subtitle: `An AI coding agent that lives in your terminal and VS Code.`
- Robot/bot icon on the right.
- Three points, each a bold heading + description:
  - **Agentic by design** — It reads your codebase, plans the work, and edits across many files.
  - **A full toolkit** — Generates, debugs, tests, and documents code, plus runs Git operations.
  - **You stay in control** — It proposes changes and waits for your approval before acting.
- Footer page: `03 / 13`

### Slide 4 — VS Code Setup
- Terminal command: `~/workshop % code . && claude`
- Title: `> VS Code Setup`
- Four numbered steps (1–4), each with a coral icon, bold label, and description:
  1. **Install Claude Code** — Open the Extensions panel, search for Claude Code, and install it from the marketplace.
  2. **Configure settings.json** — Edit settings.json to set your default model, tool permissions, and workspace preferences.
  3. **Open project folder** — Open the repository you want to work in so Claude can read its files and project context.
  4. **Launch terminal and run claude** — Open the integrated terminal, run the claude command, and start chatting in plain English.
- Footer page: `04 / 13`

### Slide 5 — VS Code Setup — Commands
- Terminal command: `~/workshop % code . && claude`
- Title: `> VS Code Setup — Commands`
- Sub-label: `Commands for each setup step`
- A large terminal/code panel titled `~/workshop — setup` containing:
```
# 1 · Install Claude Code
$ code --install-extension anthropic.claude-code

# 2 · Configure settings.json
$ claude config set model sonnet
$ claude config set permissions 'Edit,Bash,Read'

# 3 · Open your project folder
$ cd ~/projects/my-app && code .

# 4 · Launch the agent
$ claude
> Set up the project and summarize the codebase
```
- Use syntax-style coloring: comments muted gray, `$` commands white, `>` prompts green.
- Footer page: `05 / 13`

### Slide 6 — Your First Project
- Terminal command: `~/project % claude "let's build"`
- Title: `> Your First Project`
- Four numbered steps with coral icons, bold labels, descriptions:
  1. **Understand the codebase** — Ask Claude to map the structure, point out key files, and explain how data flows through it.
  2. **Implement the feature** — Describe the change in plain English and let Claude edit across multiple files at once.
  3. **Generate tests** — Have Claude write and run tests that confirm the new behavior and catch any regressions.
  4. **Review and commit changes** — Inspect the proposed diff carefully, then commit the change with a clear, descriptive message.
- Footer page: `06 / 13`

### Slide 7 — Your First Project — Commands
- Terminal command: `~/project % claude "let's build"`
- Title: `> Your First Project — Commands`
- Sub-label: `Commands for each build step`
- Terminal/code panel titled `~/project — build` containing:
```
# 1 · Understand the codebase
$ claude
> Map the structure and explain the data flow

# 2 · Implement the feature
> Add a dark mode toggle to the settings page

# 3 · Generate tests
> Write and run tests for the new toggle

# 4 · Review and commit
$ git diff
> Commit the changes with a clear message
```
- Footer page: `07 / 13`

### Slide 8 — Useful Commands
- Terminal command: `~/project % claude --help`
- Title: `> Useful Commands`
- A grid of command cards, each a coral command token + short description:
  - `/help` — List all commands and usage tips.
  - `/model` — Switch between Haiku, Sonnet, and Opus.
  - `/clear` — Wipe context to start a fresh task.
  - `/compact` — Summarize history to free up context.
  - `"Commit it"` — Plain-English request to stage and commit.
  - `"Explain this repo"` — Get an instant tour of an unfamiliar codebase.
- Footer page: `08 / 13`

### Slide 9 — Choosing the Right Model
- Terminal command: `~/project % claude /model`
- Title: `> Choosing the Right Model`
- Four model cards (each with an icon, name, category label, description, and pricing). Highlight the recommended one (opusplan) with a coral accent / "RECOMMENDED" badge:
  - **Haiku** — `FAST & CHEAP` — Quick edits, simple lookups, and high-volume tasks. — `$1 / $5`
  - **Sonnet** — `DAILY DEVELOPMENT` — Balanced speed and capability for everyday coding. — `$3 / $15`
  - **Opus** — `COMPLEX REASONING` — Deep problem-solving, architecture, and tricky bugs. — `$5 / $25`
  - **opusplan** — `RECOMMENDED` — Plans with Opus, builds with Sonnet — best of both. — `$5/$25 + $3/$15`
- Caption under the cards: `API pricing per million input / output tokens — opusplan blends Opus planning with Sonnet builds`
- Footer page: `09 / 13`

### Slide 10 — How to Save Tokens
- Terminal command: `~/project % claude --optimize`
- Title: `> How to Save Tokens`
- Four cards in a 2×2 grid, each with a coral icon, bold heading, description:
  - **Use Sonnet by default** — Reserve Opus for genuinely hard problems.
  - **Use /compact often** — Summarize long sessions to shrink context.
  - **Start new sessions per task** — Avoid carrying unrelated history between tasks.
  - **Provide only relevant files** — Point Claude at what matters, not the whole repo.
- Footer page: `10 / 13`

### Slide 11 — Security Best Practices
- Terminal command: `~/project % claude --secure`
- Title: `> Security Best Practices`
- Four numbered items with coral icons, bold labels, descriptions:
  1. **Never share API keys or tokens** — Keep secrets out of prompts, code, and commits.
  2. **Never paste customer PII** — Protect personal data; use anonymized samples instead.
  3. **Review commands before approval** — Read each suggested command before you run it.
  4. **Review code before commit** — Verify the diff so nothing unexpected ships.
- Footer page: `11 / 13`

### Slide 12 — Live Demo Flow
- Terminal command: `~/project % claude --demo`
- Title: `> Live Demo Flow`
- A horizontal 5-step pipeline with coral icons, numbered `01`–`05`, connected by `›` chevrons. Each step has a bold label + sub-line:
  - `01` **Open Repo** — Load the project
  - `02` **Explain Architecture** — Map the codebase
  - `03` **Implement Feature** — Make the change
  - `04` **Generate Tests** — Verify behavior
  - `05` **Commit** — Ship the diff
- Caption below: `Open Repo → Explain Architecture → Implement Feature → Generate Tests → Commit`
- Footer page: `12 / 13`

### Slide 13 — Key Takeaways
- Terminal command: `~/workshop % claude --recap`
- Title: `> Key Takeaways`
- Four cards in a 2×2 grid, each with a coral icon, bold heading, description:
  - **Use Claude daily** — Build the habit; small wins compound fast.
  - **Keep prompts focused** — Clear, specific asks produce better results.
  - **Validate outputs** — Always test and review before you trust.
  - **Follow security policies** — Guard keys, data, and every commit.
- Closing line (green prompt style, centered): `> happy building!`
- Footer page: `13 / 13`

---

## REGENERATION NOTES
- Keep the **monospace terminal look** consistent across all 13 slides.
- Every slide must include the **window-dots top bar with its own command string** and the **footer with "claude code · Presenter: Rutuja Dond" and the page counter**.
- Coral `#FF6B5E` is the single dominant accent; green `#53D08A` is reserved for prompt/success lines; purple and gold are used sparingly (e.g., the window dots and model accents).
- Preserve all names, commands, prices, and numbers exactly as written above

---

## Firebase Cloud Functions Deployment — Portfolio Tracker Pro

### Context
The portfolio tracker website has a Razorpay subscription paywall. Cloud Functions handle payment order creation and verification server-side. This section documents how to complete the deployment on any device.

### Firebase Project
- **Project ID:** `portfolio-tracer`
- **Firestore:** already live (holds user holdings data)
- **Functions source:** `functions/` directory in the repo root

### Razorpay Credentials (TEST mode)
- **Key ID (public):** already set in `docs/js/subscription.js`
- **Key Secret (private):** retrieve from Razorpay Dashboard → Settings → API Keys

### Step-by-step Deployment

#### 1. Prerequisites
```bash
# Install Node.js 18 via nvm (no sudo needed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc   # or restart terminal
nvm install 18
nvm use 18

# Install Firebase CLI
npm install -g firebase-tools
```

#### 2. Clone / pull the repo
```bash
git clone https://github.com/<your-repo>/portfolio-tracker-agents.git
cd portfolio-tracker-agents
```
Or if already cloned:
```bash
git pull origin main
```

#### 3. Install Functions dependencies
```bash
cd functions
npm install
cd ..
```

#### 4. Login to Firebase
Use the Google account that owns the `portfolio-tracer` Firebase project.
```bash
firebase login
```

#### 5. Set Firebase project
```bash
firebase use portfolio-tracer
```
If it asks to add an alias, pick `default`.

#### 6. Set Razorpay secrets in Firebase config
```bash
firebase functions:config:set \
  razorpay.key_id="<your Razorpay Key ID>" \
  razorpay.key_secret="<your Razorpay Key Secret>" \
  razorpay.webhook_secret="$(openssl rand -hex 32)"
```

#### 7. Deploy Cloud Functions
```bash
firebase deploy --only functions
```
On success the CLI prints three URLs like:
```
Function URL (createOrder):       https://us-central1-portfolio-tracer.cloudfunctions.net/createOrder
Function URL (verifyPayment):     https://us-central1-portfolio-tracer.cloudfunctions.net/verifyPayment
Function URL (razorpayWebhook):   https://us-central1-portfolio-tracer.cloudfunctions.net/razorpayWebhook
```

#### 8. Update FUNCTIONS_BASE in the frontend
Open `docs/js/subscription.js` line 8 and set:
```js
const FUNCTIONS_BASE = 'https://us-central1-portfolio-tracer.cloudfunctions.net';
```

#### 9. Commit and push
```bash
git add docs/js/subscription.js
git commit -m "chore: set Cloud Functions URL"
git push origin main
```

#### 10. (Optional) Configure Razorpay Webhook
In Razorpay Dashboard → Settings → Webhooks:
- URL: `https://us-central1-portfolio-tracer.cloudfunctions.net/razorpayWebhook`
- Events: `payment.captured`, `subscription.charged`, `subscription.cancelled`, `payment.failed`
- Secret: the same string you set in `razorpay.webhook_secret` above

### Verifying it works
1. Open the site and sign in — landing/pricing page should appear
2. Click Subscribe on any plan — Razorpay test checkout opens
3. Use test card: `4111 1111 1111 1111`, any future expiry, any CVV
4. After payment, dashboard should unlock and PRO badge appears in header

### Switching from Test to Live
When ready to go live, replace credentials:
```bash
firebase functions:config:set \
  razorpay.key_id="rzp_live_XXXX" \
  razorpay.key_secret="XXXX"
firebase deploy --only functions
```
And update `RAZORPAY_KEY_ID` in `docs/js/subscription.js` to `rzp_live_XXXX`.