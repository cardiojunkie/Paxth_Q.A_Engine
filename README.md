# Ecommerce Catalogue QA Automation Platform

A production-quality internal QA automation web application for ecommerce catalog teams. This tool allows catalog operations managers to upload Excel product templates (`.xlsx` / `.xls`), parse SKU rows into structured JSON, scrape live source product URLs into clean Markdown, and execute automated LLM-based Quality Assurance checks against official SAP source data and live product pages.

---

## 📌 Executive Summary & Business Logic

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
- Sends the structured payload (`SKU`, `upload_attributes`, `source_sap`, and `scraped_markdown`) to the configured OpenAI-compatible LLM endpoint.
- Evaluates 18+ audit vectors (factual mismatches, incorrect brand/model, unsupported marketing claims, contradictions, spelling/grammar, model code leaks).
- Returns a strict, machine-readable JSON evaluation output.

### Step 5: Exporting Formatted Excel Output
- Re-generates the original Excel file with appended QA metadata columns (`qa_status`, `qa_confidence`, `qa_issue_count`, `qa_summary`, `qa_issues_plain_english`, `qa_suggestions`, `qa_source_used`).
- Highlights individual cells containing errors using industry-standard color coding and cell comments.

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
- **Base URL**: Supports any OpenAI-compatible API gateway (e.g. `https://api.openai.com/v1`, `https://api.aicredits.in/v1`, or local Ollama / vLLM endpoints).
- **API Key**: Safely saved in local browser state.
- **Model Name**: Custom model string (e.g., `gpt-4o`, `deepseek/deepseek-v4-flash`, `gemini-1.5-pro`).
- **Temperature & Max Tokens**: Fine-tune output determinism and response limits.
- **Scraper Settings**: Configurable network timeout and max page character limits.

---

## ☁️ GitHub Codespaces Development Guide

When transitioning development to **GitHub Codespaces**, keep the following key points and best practices in mind:

### 1. Devcontainer & Automatic Setup
- A `.devcontainer/devcontainer.json` file is included in the project repository.
- When launching in GitHub Codespaces, Node.js 20 and recommended VS Code extensions (ESLint, Tailwind CSS) will be automatically provisioned.
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
  - Once you set your `DATABASE_URL` in `.env` or Codespaces Secrets, the Codespaces environment will instantly query your Supabase instance, making all existing SKUs and JSON details immediately accessible.
  - `server.ts` automatically runs safe, non-destructive table initializations on startup.
- **LLM API Key Configuration**:
  - You can configure your API keys (OpenRouter, OpenAI, Gemini, or custom base URLs) **directly in the application UI** under the **LLM Settings** module.
  - Settings configured via the UI are persisted in browser `localStorage` and shared across sessions. Optionally, you can also set `GEMINI_API_KEY` in `.env`.
- **API Secrets**:
  - Store sensitive keys in GitHub Codespaces Secrets or in `.env`.
  - Do NOT commit `.env` to version control.

### 4. Quick Start Command for Codespaces

Run this single command in your Codespaces terminal to install all dependencies and start the app preview:

```bash
cp .env.example .env && npm install && npm run dev
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
```

### Production Build
```bash
# Build Vite frontend and bundle server with esbuild
npm run build

# Launch production Node server
npm start
```
