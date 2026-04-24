# NexTrade AI — Reporting Assistant

A chat-first reporting prototype for vendors of the NexTrade B2B marketplace. A vendor logs in, types a plain-English question like "top 5 products last month" or "revenue trend last 30 days", and a chart drops straight into the conversation.

**Live demo:** https://nextrade-ai-reporting.vercel.app
**Source:** https://github.com/rossymcross/nextrade-ai-reporting

Built in ~8 hours against the NexTrade test-task brief (Kevin's URGENT email + the Vendor Portal Phase 2 kickoff sync + the style guide + the database schema).

---

## What it does

- Natural-language questions → appropriate chart inline in the chat window
  - **line** chart for time-series (revenue trend, daily orders)
  - **bar** chart for rankings, top-N, day-of-week comparisons
  - **pie** chart for category breakdowns
- **Supplier switcher** in the header (Supplier 1 / Supplier 2) to prove end-to-end data isolation
- **No-hallucination guardrail** — refuses to invent reasons for cancellations (because the platform doesn't capture them at checkout) and offers concrete alternative questions instead
- Highlights strip below each chart summarising the key numbers
- Six suggested prompts on the empty state

## The one architectural decision that matters

Dave's concern from the kickoff (~05:00 mark of the transcript) was that an AI with access to the master orders table could leak Supplier A's sales to Supplier B. His exact ask was _"the code itself has to block it, not the AI promising not to look."_

That shaped everything. The LLM in this prototype **never writes SQL and never sees a vendor id**.

Instead:

1. A tool-use call to Claude Opus 4.7 forces the model to emit a structured `QueryIntent` JSON — `metric`, `dimension`, `timeframe`, optional `limit`, etc. — from the `generate_report` tool schema (`src/lib/reporter.ts`).
2. The server dispatches that intent to a small, finite set of typed query functions in `src/lib/queries.ts`. Every single one of them hardcodes `WHERE products.vendor_id = ?` in its SQL.
3. The `vendorId` is pulled server-side from the signed session cookie (`src/lib/session.ts`) — never from the request body, never from the LLM output.

The demo proves this: ask "top 5 products by revenue last month", switch the header dropdown from Supplier 1 to Supplier 2, ask the exact same question, and get a completely different list and different totals. Same prompt, different enforced scope.

## Stack

| Layer | Choice |
|---|---|
| Frontend + backend | Next.js 16 App Router + TypeScript |
| Styling | Tailwind v4, brand tokens from the NexTrade style guide |
| Charts | Recharts, themed to deep teal `#008080` + neon lime `#39FF14` |
| Typography | Inter (body) + JetBrains Mono (IDs / metadata) via `next/font` |
| Database | SQLite in-memory (`better-sqlite3`), seeded deterministically at cold start with ~1.3k orders across 2 vendors, 90 days, ~10% cancellation rate |
| LLM | Anthropic `claude-opus-4-7` with `tool_choice` pinned to `generate_report` |
| Deploy | Vercel (one repo, one URL) |

The seeded database uses a fixed PRNG so the numbers are reproducible across cold starts. Supplier 1 has mild upward growth, Supplier 2 plateaus — which makes trend and comparison questions actually have signal.

## Running locally

```bash
pnpm install        # or npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

### Environment variables

| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for live LLM responses |
| `ANTHROPIC_MODEL` | Defaults to `claude-opus-4-7` |
| `NEXTRADE_MOCK` | Set to `1` to route chat through a deterministic keyword classifier (`src/lib/mockReporter.ts`) instead of calling the LLM — useful for UI work and to demo without burning tokens |

The live Vercel deployment ships with `NEXTRADE_MOCK=1` so the chart flows work end-to-end regardless of API-key state. Swap it off (or remove the env var) and redeploy to use the real LLM.

## Demo script for the Friday vendor call

1. `"Top 5 products by revenue last month"` → bar chart, top bar lime, highlights underneath
2. `"Revenue trend last 30 days"` → line chart with peak-day highlight
3. `"Category breakdown this month"` → donut pie with legend + top-share %
4. `"Compare Tuesday vs Wednesday last week"` → two-bar compare with +/- delta
5. **Switch the dropdown to Supplier 2**, re-ask prompt #1 → completely different data. This is the isolation proof.
6. `"Why are my cancellations so high?"` → polite refusal + suggestions (no hallucination)
7. `"Show a snapshot of this month"` → highlights-only overview (no chart)

## Repo layout

```
src/
  app/
    page.tsx                 server component, reads cookie, renders Chat
    api/chat/route.ts        POST — runs Claude tool-use, executes intent
    api/supplier/route.ts    GET/POST — dropdown switcher
    layout.tsx               Inter + JetBrains Mono
    globals.css              brand tokens, `.card`, `.ai-accent`, `.lime-pulse`
  components/
    Chat.tsx                 full-viewport chat, header, composer
    ChartView.tsx            line / bar / pie rendered from ChartSpec
  lib/
    db.ts                    in-memory SQLite, singleton
    seed.ts                  deterministic seed (PRNG, fixed catalogue)
    queries.ts               typed query layer, vendor_id hardcoded in SQL
    reporter.ts              Anthropic tool-use + intent dispatcher
    mockReporter.ts          keyword classifier for NEXTRADE_MOCK=1
    session.ts               cookie-bound supplier id
    types.ts                 AssistantReply / ChartSpec / Highlight
    anthropic.ts             SDK client + model id
    cn.ts                    clsx + tailwind-merge helper
```

## Things intentionally **not** built

- Real auth / sign-up — the cookie-bound supplier switcher is enough to demonstrate isolation; password flows aren't the point of the demo
- LLM-writes-SQL with sandboxing — slower to ship, more failure modes, and makes Dave's isolation story harder to tell
- Chat history persistence across reloads
- Admin panel, user management, audit log
- Mobile-first polish (the vendor call will be on a laptop)

## License

MIT
