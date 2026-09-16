# Ecommerce Catalogue QA Automation Platform

A production-quality internal QA automation web application for ecommerce catalog teams. This tool allows catalog operations managers to upload Excel product templates (`.xlsx` / `.xls`), parse SKU rows into structured JSON, scrape live source product URLs into clean Markdown, and execute automated LLM-based Quality Assurance checks against official SAP source data and live product pages.

## Quick Start

Requirements: Node.js 18+ and PostgreSQL.

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `DATABASE_URL` in `.env` before uploading data; the database stores SKUs, scraped content, QA results, and job logs. Configure the LLM provider in the app under **LLM Settings**.

For a production build:

```bash
npm run build
npm start
```

The optional `./start.sh` helper stops this project's existing listeners on ports 3000 and 24678 before starting development.

## Password-protected VPS deployment

The deployment in `/opt/paxth-qa` uses `compose.yaml` as a separate Docker project. The container runs as `node`, restarts automatically, and has a 1 CPU / 1536 MiB memory limit with 256 MiB shared memory. Its backend is published only at `127.0.0.1:3200`.

Keep `DATABASE_URL` in `/opt/paxth-qa/.env` with mode `600`; Compose supplies it at runtime. Environment files and database backups are excluded from the image build. Back up the shared database before starting a new deployment because the app initializes its schema at startup.

```bash
cd /opt/paxth-qa
docker compose up -d --build
docker compose ps
```

The image preinstalls CloakBrowser. Production uses the ESM entrypoint `dist/server.mjs` and serves only `dist/public`; the server bundle and its source map are outside the public asset directory.

Caddy listens only on `127.0.0.1:8082`, requires HTTP Basic authentication for every page, asset, and API request, strips `Authorization`, and proxies to `127.0.0.1:3200`. Keep only the password's bcrypt hash in its configuration. The Caddy site must accept the Tailscale hostname rather than matching only `127.0.0.1`.

```bash
tailscale funnel --bg --https=8443 http://127.0.0.1:8082
```

Open `https://rakazo.tail608e42.ts.net:8443` in any browser and enter the separately supplied gateway credentials; a Tailscale client is not required. Port 8443 uses public Funnel behind Caddy authentication; leave the existing Rakazo Funnel configuration on port 443 intact. The app's existing login remains behind the gateway. LLM API keys and provider settings are browser-local, so configure them for this URL; catalog data, QA memory, and mapping rules use the shared database.

After deployment, check `tailscale serve status` and `docker compose logs --tail=50`. From outside the tailnet, confirm missing and incorrect credentials return `401` for `/`, an asset, and `/api/catalog`; valid credentials must load the UI and `/api/db-status`. Verify catalog loading, SAP editing, a sample scrape, recovery after `docker compose restart app`, and that Rakazo still works. Backend ports 3200 and 8082 must remain bound to loopback.

To restore private, tailnet-only access, run `tailscale serve --bg --https=8443 http://127.0.0.1:8082`.

To roll back this deployment, remove only its Funnel listener and Compose project, then validate and restore the saved Caddy configuration:

```bash
tailscale funnel --https=8443 off
cd /opt/paxth-qa
docker compose down
caddy validate --config /opt/paxth-qa/backups/Caddyfile.before --adapter caddyfile
cp /opt/paxth-qa/backups/Caddyfile.before /etc/caddy/Caddyfile
systemctl reload caddy
```

The rollback leaves the shared database and existing Rakazo services running. Avoid `tailscale serve reset`, which would remove unrelated Serve settings.

---

## 📌 Executive Summary & Business Logic.

When uploading new catalog SKUs to ecommerce marketplaces or platforms, data inconsistencies, missing specs, typos, and unverified marketing claims lead to customer returns and delays. This platform automates the verification process:

1. **Upload Data vs. Source Truth**:
   - Headers starting with `attributes__` represent **Upload Data** (the catalog data being validated).
   - Headers starting with `source__` represent **Source Data** (ground truth references).
2. **Required Source Data**:
   - `source__sap`: Official SAP/ERP master data (Highest Authority / Holy Truth).
   - `source__url`: Live website product page URL (Secondary Supporting Source).
3. **Hierarchy of Truth**:
   - **`source__sap` is the ultimate authority**.
   - Scraped `source__url` Markdown serves as secondary evidence.
   - If SAP data and web scraped data conflict, the system trusts SAP and flags the discrepancy.
   - If both `source__sap` and `source__url` are missing, the SKU is marked **"Cannot QA – No source data"**.
4. **Job Processing**:
   - Each selected SKU row is queued as an independent QA case.
   - Jobs run **sequentially, one at a time**, to respect API rate limits and ensure deterministic progress tracking.

---

## 🛠️ System Workflow (Step-by-Step)

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│ 1. Excel Upload │ ──► │ 2. Parsing & Mapping │ ──► │ 3. Queue Selection  │
└─────────────────┘     └──────────────────────┘     └─────────────────────┘
                                                                │
                                                                ▼
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│ 6. Download     │ ◄── │ 5. LLM QA Engine     │ ◄── │ 4. Web Scraper      │
│    Excel & JSON │     │    (JSON Rules)      │     │    (Markdown)       │
└─────────────────┘     └──────────────────────┘     └─────────────────────┘
```

### Step 1: Excel Upload and Attribute Parsing
- Users drag and drop or select an `.xlsx` / `.xls` catalog template.
- The app automatically parses row headers from Row 1:
  - Columns with `attributes__` prefix are stored in `upload_attributes` (prefix stripped).
  - Columns with `source__` prefix are stored in `source` (`sap` and `url`).
  - Identifies the `sku` column (or allows user column mapping).

### Step 2: Queueing & Selection
- All uploaded SKUs are listed in the interactive dashboard with readiness status indicators (`Ready`, `Missing Source`, `Cannot QA`).
- Users filter rows, select specific SKUs or click **Select All Ready**, and initiate the QA run.

### Step 3: Web Scraping (per SKU)
- For SKUs with a `source__url`, the built-in server scraper fetches the webpage content.
- Strips irrelevant clutter (navbars, footers, cookie popups, ads, recommendations, cart buttons).
- Converts core product content (Title, Specs, Bullet Points, Model, Description, Warranty) into clean Markdown.
- If scraping fails or is blocked, QA proceeds relying on `source__sap`.

### Step 4: LLM-Powered QA Analysis
- Sends the SKU, original template fields (including `name`, `base_code`, and `note`), SAP, and scraped evidence to the configured OpenAI-compatible LLM endpoint. Original column names, supplied values, and blank cells are retained; previous QA output and source metadata are excluded from template fields.
- Loads shared **QA Agent Memory** and attribute-set mapping rules from Supabase when each job starts, and uses that snapshot throughout the run. Matching ignores case and surrounding spaces; missing, blank, or ambiguous rules allow a general review with a visible warning that category validation was skipped. Jobs cannot start if shared configuration cannot be loaded.
- Prepares evidence once per SKU and retains it through retries. The **Max Source Page Characters** setting limits web evidence; truncation produces an incomplete-evidence warning. A SKU with neither usable SAP nor web evidence fails with an actionable error.
- Evaluates 18+ audit vectors (factual mismatches, incorrect brand/model, unsupported marketing claims, contradictions, spelling/grammar, model code leaks).
- Validates new JSON results before saving. Issue counts, colors, and statuses are reconciled so critical issues fail and incomplete reviews cannot pass. Existing saved results remain readable.
- A `data_mismatch` requires source truth for the same attribute and a complete suggested replacement; incomplete responses use the configured retries and fail visibly if still invalid. Unverifiable values remain blank with a verification explanation. Product weight cannot substitute for shipping weight, and material cannot establish colour. Rerun QA to replace older results with the new checks.

### Step 5: Exporting Formatted Excel Output
- Jobs downloads (single job, combined jobs, and issues-only) preserve original values and column order. A `Corrected: <original header>` column is inserted beside an `attributes__` column only when at least one exported SKU has a matched QA issue there, of any severity. The layout is fixed for the whole sheet using only the included rows; clean attributes have no correction column. SKU, SAP text, URLs, and other metadata remain single columns; `qa_status`, `qa_scrape_status`, and `job_error` are appended at the end.
- Affected original cells are highlighted and contain Excel notes (classic comments) with the plain-English explanation, available source truth, and suggested correction. Multiple issues share one comment and the highest severity determines the highlight. There are no separate `Error 1`, `Error 2`, etc. columns.
- Correction cells contain the stored suggested replacement value for review. Unaffected rows leave that correction cell blank. Missing or conflicting suggestions still create the correction column, but its cells stay blank where no unambiguous fix is available; comments explain when review is required. General issues and fields that cannot be matched to an original column appear in a comment on `qa_status` without creating correction columns.
- Existing results can be exported without rerunning QA. New QA runs request complete replacement values instead of editing instructions. The Dashboard summary export and uploaded data are unchanged.

---

## 🎨 Color Coding & Issue Severity Rules

| Cell Color | Severity Level | Issue Types Covered |
| :--- | :--- | :--- |
| 🔴 **Red Fill** | **Critical / Major** | Wrong product identity, incorrect brand, wrong model code, capacity mismatch, dangerous or unverified specs. |
| 🟠 **Orange Fill** | **Moderate / Warning** | Unsupported marketing claims, over-promising, SAP vs. Web source conflicts, missing vital product attributes. |
| 🟡 **Yellow Fill** | **Minor / Formatting** | Spelling errors, grammar mistakes, bad capitalisation, formatting inconsistencies, minor wording tweaks. |

---

## 🤖 Prompting ChatGPT for Mapping Rules

**Mapping Rules** (Attribute Sets) are markdown-formatted instructions injected directly into the LLM's system prompt during QA. They tell the AI *exactly how* to validate specific attributes for a specific product category (e.g., Laptops, Memory Cards, Apparel).

If you want ChatGPT (or another LLM) to write perfect Mapping Rules for this application, **copy and paste the following prompt into ChatGPT**, replacing the bracketed `[...]` information with your specific category needs.

### ChatGPT Prompt Template

> **Copy the text below and paste it into ChatGPT:**

```text
Act as an Ecommerce Catalog Quality Assurance expert. I am building a set of "Mapping Rules" for an automated LLM-based QA tool. 

This tool validates uploaded catalog attributes (from an Excel file) against "Source Truth" (SAP data and Web Scraped Markdown). The mapping rules are injected into the system prompt to tell the QA LLM exactly how to validate specific attributes for a product category.

Please write the mapping rules for the category: [INSERT CATEGORY NAME, e.g., Memory Cards / Laptops / Televisions].

The rules must be written in clear Markdown format.

For each key attribute in this category, provide:
1. The expected format or constraints (e.g., "Must be in GB or TB", "Must exactly match the brand name").
2. How to handle discrepancies or missing data.
3. Strict instructions on severity (e.g., "Flag as critical if capacity differs from SAP").

Here are the specific attributes I need rules for:
- attributes__brand
- attributes__title
- attributes__color
- [ADD OR REMOVE ATTRIBUTES AS NEEDED]

Format the output strictly as a Markdown list or set of headings that I can directly paste into my application's rule engine. Keep the instructions imperative and strict (e.g., "Flag as critical if...", "Value MUST be...").
```

---

## 📊 Data Schema Definitions

### Input SKU JSON Structure
```json
{
  "sku": "SKU-90210-BLK",
  "upload_attributes": {
    "title": "Wireless Noise Cancelling Headphones",
    "brand": "Acoustix",
    "color": "Matte Black",
    "battery_life": "30 Hours"
  },
  "source": {
    "sap": "Brand: Acoustix, Model: ANC-900, Color: Black, Battery: 30h",
    "url": "https://example.com/products/anc-900"
  },
  "raw_row": {
    "sku": "SKU-90210-BLK",
    "attributes__title": "Wireless Noise Cancelling Headphones",
    "source__sap": "Brand: Acoustix..."
  },
  "status": "ready"
}
```

### LLM Output QA Schema
```json
{
  "sku": "SKU-90210-BLK",
  "qa_status": "fail",
  "confidence": "high",
  "summary": "Brand and battery life mismatch against SAP source truth.",
  "issue_count": 2,
  "issues": [
    {
      "field": "attributes__brand",
      "issue_type": "data_mismatch",
      "severity": "critical",
      "uploaded_value": "Acoustix",
      "source_truth": "Acoustix Pro",
      "explanation": "Uploaded brand name 'Acoustix' is missing the 'Pro' suffix specified in official SAP data.",
      "suggested_fix": "Acoustix Pro",
      "cell_color": "red"
    }
  ],
  "source_notes": {
    "sap_used": true,
    "url_used": true,
    "scrape_status": "success",
    "source_conflicts": []
  }
}
```

---

## ⚙️ Configuration & LLM Providers

Access the **Settings** module in the sidebar to configure:
- **Base URL**: Supports any OpenAI-compatible API gateway (e.g. `https://api.openai.com/v1`, `https://aicredits.in/v1`, or local Ollama / vLLM endpoints).
- **API Key**: Safely saved in local browser state.
- **Model Name**: Custom model string (e.g., `gpt-4o`, `deepseek/deepseek-v4-flash`, `gemini-1.5-pro`).
- **Temperature & Max Tokens**: Fine-tune output determinism and response limits.
- **Max Source Page Characters**: Limit the web evidence sent to QA; truncated reviews receive a warning.

**QA Agent Memory** stores shared standing instructions in Supabase (`qa_agent_settings`); category mapping rules are stored in `attribute_sets`. Both survive browser and application restarts. The default covers GCC catalogue QA, SAP precedence, exact product variants, category rules, source-supported corrections, Arabic/English content, and regional claims without assumed product facts. Edit the memory and click **Save Changes**; success is shown only after the database confirms the save. **Restore Default Memory** replaces only the editor contents until saved; blank memory uses the default. Changes apply to future runs and explicit reruns, not running jobs or existing results. API keys, provider settings, and execution parameters remain browser-local. The agent does not learn facts between SKUs, and the application retains control of the output format and evidence requirements.

On first startup, shared QA configuration is initialized without overwriting existing database rules. Default category names are seeded once; deletions persist across restarts. In **Attribute Sets**, use **Import browser rules** to migrate browser-only rules into missing or blank shared sets; existing nonblank shared rules and the browser backup are preserved. If browser memory differs from shared memory, **Load previous browser memory into editor** lets you review it before saving it to Supabase. Saves and imports report database failures instead of silently falling back to local storage.

---

## ☁️ GitHub Codespaces Development Guide

When transitioning development to **GitHub Codespaces**, keep the following key points and best practices in mind:

### 1. Devcontainer & Automatic Setup
- A `.devcontainer/devcontainer.json` file is included in the project repository.
- When launching in GitHub Codespaces, Node.js 22 and recommended VS Code extensions (ESLint, Tailwind CSS) will be automatically provisioned.
- Dependencies will automatically install via `postCreateCommand: "npm install"`.

### 2. Port Configuration & Web Preview
- The app runs a unified full-stack server on **Port 3000** (Express server mounting Vite middleware in development).
- Codespaces automatically forwards port `3000`.
- In the **Ports** tab of VS Code / Codespaces, make sure port `3000` is forwarded.
- If you need to access the app preview from external browser windows or webhooks, change the port visibility from `Private` to `Public`.

### 3. Environment Variables & Database (`DATABASE_URL`)
- Copy `.env.example` to `.env`:
  ```bash
  cp .env.example .env
  ```
- **Database Connection (`DATABASE_URL`) & Supabase Data Sync**:
  - The application connects directly to your PostgreSQL database (e.g. Supabase Connection String) using Drizzle ORM in `server.ts`.
  - **All scraped data, SKUs, raw rows, QA results, and job logs are stored directly in your Supabase database** (`sku_data` and `jobs` tables).
  - For Supabase in Codespaces or another IPv4-only runtime, copy the exact **Session pooler** URI from **Supabase Dashboard → Connect**. Keep its project-specific region, port, and `postgres.<project-ref>` username unchanged, and include `sslmode=require`. The application deliberately does not guess or rewrite a pooler endpoint.
  - Once you set your `DATABASE_URL` in `.env` or Codespaces Secrets, the Codespaces environment will instantly query your Supabase instance, making all existing SKUs and JSON details immediately accessible.
  - `server.ts` automatically runs safe, non-destructive table initializations on startup.
- **LLM API Key Configuration**:
  - You can configure your API keys (OpenRouter, OpenAI, Gemini, or custom base URLs) **directly in the application UI** under the **LLM Settings** module.
  - API/provider settings configured via the UI remain in browser `localStorage`. QA agent memory and category mapping rules are shared through the database. Optionally, you can also set `GEMINI_API_KEY` in `.env`.
- **API Secrets**:
  - Store sensitive keys in GitHub Codespaces Secrets or in `.env`.
  - Do NOT commit `.env` to version control.

### 4. Quick Start Command for Codespacess

Run this single command in your Codespaces terminal to install all dependencies and start the app preview:

```bash
cp .env.example .env && npm install && npm run dev
```

### Docker

```bash
docker build -t paxth-qa-engine .
docker run --rm -p 3000:3000 --env-file .env paxth-qa-engine
```

This command will:
1. Create your `.env` file from `.env.example`.
2. Install all npm packages and requirements.
3. Start the Express + Vite server on **Port 3000**.
4. Open or forward Port 3000 in the Codespaces **Ports** tab to view your frontend!

---

### 5. Running & Debugging in Codespaces
```bash
# Start the full-stack development server
npm run dev

# Run TypeScript lint & type-check
npm run lint

# Test production build & start
npm run build
npm start
```

### 6. Tests

Run the TypeScript check and focused scraper/QA tests with:

```bash
npm run lint
npm run test:job-state
npm run test:site-selector
npm run test:tab-capture
npm run test:blocked-page
npm run test:lazy-content
npm run test:llm-response
npm run test:qa-agent
```

With `TEST_DATABASE_URL` set to a PostgreSQL test connection, `npm run test:qa-config-db` checks shared-memory persistence, mapping-rule CRUD/imports, restart behavior, and database failures. It creates and removes its own isolated schema and does not modify existing application tables.

---

## 🚀 Running the Project (Local Development)

### Prerequisites
- Node.js 18+ installed

### Development Server
```bash
# Install dependencies
npm install

# Start full-stack development server (Express backend + Vite React frontend on port 3000)
npm run dev

# Replace a stale instance of this project before starting
./start.sh
```

### Production Build
```bash
# Build Vite frontend and bundle server with esbuild
npm run build

# Launch production Node server
npm start
```
