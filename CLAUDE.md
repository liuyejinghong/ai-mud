# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI MUD — a dark-fantasy web MUD. Server-authoritative C/S architecture: players idle/grind through hotkey-driven exploration, auto-ATB combat, gathering, a small supply/demand economy, and a persistent NPC world. AI is a runtime part of the world (NPC dialogue, memory, rumors, task copy/proposals) rather than an offline content generator — see "AI layer" below for the authority boundary this implies. Full product framing lives in `docs/superpowers/specs/2026-07-01-ai-mud-game-design.md`.

## Commands

This is a pnpm workspace (`pnpm@9`). Package build order matters: `shared` → `content` → `game-rules` → `ai-prompts` → `server`/`web`. Each package's `typecheck`/`test`/`lint` script already builds its workspace dependencies first, so you rarely need to build manually.

```bash
pnpm install

# Whole repo (mirrors what release verification runs)
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm -r lint        # lint == tsc --noEmit; there is no separate ESLint step

# Single package
pnpm --filter @ai-mud/server test
pnpm --filter @ai-mud/web dev        # vite on 127.0.0.1:5173
pnpm --filter @ai-mud/server dev     # fastify on 127.0.0.1:3000, loads ../../.env

# Single test file/name (args pass through to `vitest run`)
pnpm --filter @ai-mud/server test -- ai-layer-boundary npc-task.service
pnpm --filter @ai-mud/ai-prompts test -- npc-task-proposal
pnpm --filter @ai-mud/web test -- GameShell

# E2E (Playwright, boots its own dev server)
pnpm --filter @ai-mud/web e2e

# Postgres schema (drizzle-kit, apps/server/drizzle.config.ts)
pnpm --filter @ai-mud/server db:generate
pnpm --filter @ai-mud/server db:migrate
```

Before treating verification as complete, prefer the `CI=true` prefix (matches what's used before landing changes) and run all four: `test`, `typecheck`, `lint`, `build`, plus `git diff --check`.

Server needs a real Postgres reachable at `DATABASE_URL` (see `.env.example`) — copy it to `.env` at the repo root. `SESSION_SECRET` must be ≥32 chars. `AI_PROVIDER=template` (default) needs no API key and runs fully deterministic fallback text; `AI_PROVIDER=deepseek` requires `DEEPSEEK_API_KEY`.

## Architecture

### Workspace layout

```
apps/server/   Fastify API, Postgres/Drizzle access, module services, admin API, AI orchestration
apps/web/      React + Vite client — login/register, main game UI, admin panels
packages/shared/     Cross-front/back DTOs, version constants, error types
packages/content/    Static world content: items, maps, encounters
packages/game-rules/ Pure rule functions only — combat, gathering, economy, hunger, equipment, NPC behavior, map math
packages/ai-prompts/ Prompt builders + structured-output parsers + safety-rejection rules for every AI purpose
```

`game-rules` and `content` have no side effects and no DB access — they're pure functions consumed by `apps/server`. Anything that decides numeric outcomes (damage, drops, prices, durability, hunger) belongs there, not inline in a service.

### Server module pattern

Each `apps/server/src/modules/<name>/` follows `*.repository.ts` (Drizzle queries) → `*.service.ts` (business logic, framework-agnostic, takes the repo via constructor injection) → `*.routes.ts` (Fastify route registration, zod request validation, session/auth checks). Services are unit-tested against in-memory fakes of their repository interface rather than a real DB (see `ai-layer-boundary.test.ts` for the pattern). Modules: `activation-code`, `auth`, `game`, `npc`, `npc-task`, `npc-memory`, `dialogue`, `rumor`, `world-runtime`, `world-reset`, `ai`, `admin`, `audit`.

`app.ts` wires everything: it builds one `WorldRuntimeService` per app instance and, when `WORLD_TICK_ENABLED`, ticks it on an interval to settle NPC world state and advance `world_runtime_state` in fixed-size steps (`WORLD_RUNTIME_TICK_MS`, capped by `WORLD_TICK_MAX_STEPS` per run) using a lease (`acquireLease`/`releaseLease`) so only one process advances the clock at a time.

### The AI layer boundary (read before touching anything under `modules/ai` or `packages/ai-prompts`)

This is the load-bearing architectural rule of the codebase: **the rule system owns all world state; AI may only produce text.**

- Every AI purpose (`npc_dialogue`, `npc_task_copy`, `npc_memory_compression`, `world_rumor`, `npc_task_proposal`) is declared in `apps/server/src/modules/ai/ai-purpose-policy.ts` with `mutatesWorldState: false`, `allowedStateEffects: "none"`, and `fallbackRequired: true`. `ai-layer-boundary.test.ts` regression-tests that this invariant holds for every policy.
- `AiOrchestrator` (`ai-orchestrator.ts`) always has a deterministic template fallback for every purpose and returns it whenever the provider is disabled, times out, errors, or the structured output fails the safety parser.
- Structured-output parsers in `packages/ai-prompts/src/*.ts` reject reward promises, OOC/model-identity leakage, rule-change language, and (for task proposals) any attempt by the model to change requested item/quantity — the rule system generates the legitimate candidate first and AI can only restyle the copy around it.
- All calls are logged to `ai_call_logs` (`aiCallLogs` table) with provider/model/status/tokens/latency; `AiGovernanceService` summarizes this for the admin "AI 状态" panel.
- Concretely: gold/items/XP/equipment grants, inventory, market, task rewards, and NPC/world state are only ever written by rule-layer services. If you add a new AI purpose, it must ship with a policy entry, a fallback, an `ai_call_logs` write path, and a boundary test — see `docs/superpowers/specs/2026-07-02-v0.6-ai-layer-closeout-checklist.md` for the checklist this pattern must satisfy.

### NPC tasks / economy loop

NPC tasks come from real detected NPC need (e.g. ore shortage, hunger) via `npc-request-rules.ts`, not invented by AI. The rule system builds the candidate task and confirms the NPC's own wallet can escrow the reward before task creation; AI (`npc_task_proposal`) is only asked to phrase the title/description/reason — see `npc-task.service.ts` + `npc-request-rules.ts`. On completion, items move into the NPC's inventory and escrowed currency pays out to the player; expired tasks refund escrow.

### Versioning

`packages/shared/src/version.ts` holds `PRODUCT_VERSION` and the `WORLD_COMPATIBILITY` block (`schemaVersion`, `apiVersion`, `engineVersion`, `rulesetVersion`, `contentVersion`, `promptVersion`, `economyVersion`, `worldSeedVersion`) — this is the real version source, independent of the root `package.json` `version` field (which currently lags and shouldn't be trusted). Bump the relevant sub-version whenever you touch its domain (new migration → `schemaVersion`, new/changed route contract → `apiVersion`, new AI prompt → `promptVersion`, etc.) — several tests assert against these constants.

### Docs worth knowing about

- `docs/superpowers/specs/` — design docs per feature slice (dated, versioned filenames).
- `docs/superpowers/plans/` — matching execution plans for each spec.
- `docs/releases/vX.Y.Z.md` — Chinese changelog-style release notes per version, each ending with the verification commands that were run for that release.
- `docs/reviews/` — point-in-time review handoffs with architecture context and known risk areas.

Docs and commit messages in this repo are written in Chinese; code, identifiers, and comments are in English.
