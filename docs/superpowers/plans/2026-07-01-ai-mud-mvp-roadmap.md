# AI MUD MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first closed-test version of the AI-driven dark-fantasy Web MUD, with accounts, a playable village/wild-map loop, automatic ATB combat, living NPC economy, AI NPC dialogue/tasks, admin tools, and simulation tests.

**Architecture:** Use a TypeScript monorepo with a Fastify modular server, React/Vite web client, PostgreSQL persistence, shared typed commands/events, rule packages, content packages, and an AI orchestration boundary. Keep the first release as a modular monolith, but version schemas, rules, content, prompts, and world state so later service extraction does not rewrite gameplay contracts.

**Tech Stack:** TypeScript, pnpm workspaces, React, Vite, Fastify, WebSocket, PostgreSQL, Drizzle or Prisma, Zod, Vitest, Playwright, structured AI provider adapter for DeepSeek v4 flash or compatible models.

---

## 1. Scope Check

The design spec covers multiple independent subsystems:

- Account, activation code, session, and role access.
- Web MUD UI and interaction model.
- World map, village nodes, wild grid movement.
- ATB automatic combat and injury state.
- Inventory, equipment, ledger, market, tax, and hunger.
- Long-term NPC agent simulation.
- AI dialogue, task proposal, memory compression, and output safety.
- Municipal tasks, NPC AI tasks, and dungeon objectives.
- GM/admin tools, world reset, audit log.
- Security, anti-cheat, testing, and simulation.

This is too large for one code-level implementation plan. Implementation must proceed as a versioned release train, with one focused code-level plan per version or subsystem. This master plan defines the release sequence, versioning policy, file/module boundaries, and acceptance gates.

## 2. Versioning Policy

### 2.1 Product Version

Use pre-1.0 semantic-style versions:

- `0.MINOR.PATCH`
- `MINOR` means a tested internal release boundary.
- `PATCH` means bug fixes, balance changes, prompt changes, content fixes, or small UI fixes within the same release boundary.

Version line:

- `v0.1.x` Foundation: repo, auth, activation codes, DB, shared contracts, admin basics.
- `v0.2.x` Playable Loop: character, village, wild movement, inventory, first resource feedback.
- `v0.3.x` Idle Action Loop: timed gathering, automatic ATB combat, active action state, injury return.
- `v0.4.x` Economy World: hunger, market, ledger, resources, taxes, repair, wages.
- `v0.5.x` Living NPC: long-term NPC movement, jobs, schedules, memory summaries.
- `v0.6.x` AI Layer: NPC dialogue, AI tasks, prompt safety, memory compression.
- `v0.7.x` Closed-Test Admin and Simulation: GM tools, world reset, dashboards, 3-day and 7-day simulations.
- `v0.8.x` Closed-Test Candidate: polish, security hardening, E2E, invite rollout for friends.

Do not call any build `v1.0` until the game has stable player onboarding, persistent world operation, economic recovery behavior, and at least one complete AI dungeon.

### 2.2 Compatibility Versions

Store these versions in a `world_version` or equivalent table:

- `product_version`
- `schema_version`
- `ruleset_version`
- `content_version`
- `prompt_version`
- `economy_version`
- `world_seed_version`

Every generated world, dungeon instance, NPC memory, AI task, market record, and combat result should be traceable to the relevant versions.

### 2.3 Migration Policy

- Schema changes use database migrations.
- Rule changes increment `ruleset_version`.
- Content balance changes increment `content_version`.
- Prompt/schema changes increment `prompt_version`.
- Economy formula changes increment `economy_version`.
- Breaking world initialization changes increment `world_seed_version`.

For closed-test builds, `Soft Reset` is allowed after root-cause fixes. Preserve accounts and activation-code history unless the reset explicitly says otherwise.

### 2.4 Release Notes

Every internal release must include:

- Product version.
- Migration list.
- Content/rules/prompt version changes.
- Player-visible changes.
- Balance changes.
- Admin or reset instructions.
- Known risks.
- Verification evidence.

## 3. Repository And Module Boundaries

Create this structure in the first implementation version:

```text
apps/
  web/
  server/
packages/
  shared/
  game-rules/
  content/
  ai-prompts/
docs/
  superpowers/
    specs/
    plans/
```

### 3.1 `apps/web`

Responsibility:

- Login/register UI.
- Character selection and creation.
- Main MUD shell.
- Keyboard and mouse interaction.
- Logs, map, inventory, NPC dialogue, market, admin pages.

Must not:

- Decide combat, loot, market price, task completion, NPC action, or ledger changes.
- Trust local state as authoritative.

### 3.2 `apps/server`

Responsibility:

- Fastify HTTP API.
- WebSocket gateway.
- Auth/session.
- Command handling.
- Database access.
- Admin API.
- Background jobs.
- World clock.

### 3.3 `packages/shared`

Responsibility:

- Shared command DTOs.
- Shared event DTOs.
- Public entity shapes used by web/server.
- Error codes.
- Version constants.

All client-server messages should be defined here and validated server-side.

### 3.4 `packages/game-rules`

Responsibility:

- Pure rule functions.
- ATB combat.
- hunger.
- market pricing.
- taxes.
- resource refresh.
- task state transitions.
- ledger invariants.
- versioned ruleset exports.

This package should not import server, database, web, or AI providers.

### 3.5 `packages/content`

Responsibility:

- Class definitions.
- Monster definitions.
- resource definitions.
- item/equipment templates.
- NPC definitions.
- map templates.
- market defaults.
- task definitions.
- seed data.

Content files must include a content version and stable IDs.

### 3.6 `packages/ai-prompts`

Responsibility:

- Prompt templates.
- Output schemas.
- Prompt versions.
- Test fixtures for prompt injection, OOC, illegal reward, and length checks.

Business code calls AI through `apps/server/src/modules/ai-orchestrator`, not directly through prompt files.

## 4. Release Train

### v0.1 Foundation

Goal: A secure internal web app skeleton with accounts, activation codes, sessions, shared contracts, database migrations, and admin access.

Included:

- Monorepo scaffold.
- Server and web app boot.
- PostgreSQL schema and migration setup.
- Account registration with activation code.
- Login/logout/session.
- Admin role.
- Activation-code admin page.
- Audit log.
- Soft Reset command stub with guardrails.
- Shared command/event typing.

Acceptance:

- Admin can generate activation code.
- New user can register only with valid unused activation code.
- User can log in, log out, and return.
- Admin can see accounts and activation-code status.
- Audit log records admin actions.

### v0.2 Playable Loop

Goal: A player can create a character, enter the village, move in a wild grid, gather resources, and see inventory/log feedback.

Included:

- Character creation and selection.
- Three combat classes as content definitions.
- MUD shell UI.
- Village nodes.
- Wild grid movement for `腐林`.
- Keyboard and mouse movement.
- Inventory.
- Basic resources: food, beast meat, leather.
- First resource feedback.

Acceptance:

- New player reaches village in under 5 minutes.
- Player enters `腐林`, moves by `W/A/S/D` and mouse.
- Player gathers a resource.
- Player sees gathered resources in inventory.
- Game shell supports keyboard and mouse movement.

### v0.3 Idle Action Loop

Goal: The player can start timed gathering and automatic ATB combat through one reusable active-action system, then complete, cancel, get injured, or return to town.

Included:

- One active action per character.
- Timed gathering.
- First monster group in the Corrupt Forest.
- Automatic ATB combat.
- Combat timeline derived from stats, not preset duration.
- Active action progress in game state.
- Manual cancel/escape.
- Injury return to village.
- Return-to-village command.

Acceptance:

- Gathering takes time and settles through server state.
- Cancelling gathering preserves rewards from completed gathering cycles only.
- Combat duration changes based on player/monster stats.
- High agility attacks more frequently than low agility.
- HP zero creates injury, not death.
- Active actions block movement and starting another action.
- No global per-second world tick is required.

### v0.4 Economy World

Goal: The village economy starts to run with hunger, market inventory, taxes, repair, mining, wages, and ledger visibility.

Current calibration after `v0.4.0`:

- `v0.4.0` delivered the economy foundation: copper-backed money display, municipal market, stock-sensitive pricing, buy/sell transactions, tax, basic iron ore, and repair quote rules.
- `v0.4.0` did not complete the whole Economy World scope.
- Equipment durability and repair execution remain `v0.4.x` work, not `v0.5`.
- Living NPC remains reserved for `v0.5.x`.
- Detailed split is recorded in `docs/superpowers/plans/2026-07-01-v0.4x-v0.5-roadmap-realignment-plan.md`.

Included:

- Three-coin currency display backed by copper integer storage.
- Hunger meter.
- Food consumption and auto-eat behavior.
- Market inventory and pricing.
- Municipal stock.
- Tax ledger entries.
- Copper and iron ore resources.
- Old mine outskirts map.
- Equipment durability.
- Repair with currency plus ore.
- NPC wages as configurable content.
- Ledger query API.

Acceptance:

- Food shortage affects price.
- Ore shortage affects repair/blacksmith pricing.
- Repair consumes money and ore.
- Transactions write ledger entries.
- 3-day no-player world simulation runs without invalid ledger totals.

Recommended remaining `v0.4.x` release split:

- `v0.4.1` Economy Sink: equipment durability and repair execution.
- `v0.4.2` Basic Needs: hunger and food consumption.
- `v0.4.3` Economy Visibility: ledger query and municipal controls.
- `v0.4.4` Wage And Simulation Skeleton: wage policy and 3-day economy simulation.

### v0.5 Living NPC

Goal: Long-term NPCs act like AI-operated world residents with location, inventory, jobs, movement, needs, and memory summaries.

Included:

- Six long-term NPCs: farmer, hunter, miner, blacksmith, merchant, municipal officer.
- NPC wallet, inventory, hunger, equipment, home, current location.
- Daily plan structure.
- Grid movement.
- Gathering/mining/hunting work activities.
- NPC buying/selling with market and each other.
- NPC injury handling.
- Nightly memory compression stub.
- NPC admin detail view.

Acceptance:

- NPCs move through grids rather than teleporting.
- NPC resources enter their own inventory before reaching market.
- NPCs can become hungry, buy food, or fail to work.
- NPCs can get injured and return.
- 7-day simulation has no world deadlock.

### v0.6 AI Layer

Goal: AI is integrated as structured intent, dialogue, task proposal, rumor, and memory compression without authority over assets or combat results.

Included:

- AI provider adapter.
- AI task table/log.
- Prompt versioning.
- `RoleplayNpc`.
- `ProposeAiQuest`.
- `SummarizeMemory`.
- `CompressNpcMemory`.
- `GenerateRumor`.
- Output schema validation.
- Length limits.
- Prompt-injection test fixtures.
- Template fallback.

Acceptance:

- Player can talk to blacksmith and merchant.
- NPC replies stay short and in-character.
- AI cannot grant items directly.
- NPC can propose a task only from real need and valid reward source.
- Memory compression turns detailed memory into summaries/fragments.
- AI failure does not block game flow.

### v0.7 Admin And Simulation

Goal: Closed-test operators can inspect, reset, and diagnose the living world.

Included:

- Admin dashboard.
- Player detail.
- NPC detail.
- Market/economy panel.
- Ledger search.
- AI call log.
- World state panel.
- Task admin.
- Soft Reset implementation.
- 1-day, 3-day, 7-day world simulation reports.
- Combat simulation reports.

Acceptance:

- Admin can diagnose player, NPC, market, ledger, and AI issues.
- Soft Reset preserves accounts and reinitializes world.
- 7-day simulation report includes stock, prices, hunger, injuries, civic fund, AI call estimate.

### v0.8 Closed-Test Candidate

Goal: Prepare the first friend-facing closed test.

Included:

- Security review fixes.
- E2E registration-to-newbie-loop test.
- UX polish for Portalborn-inspired demo shell.
- Activation-code batch for testers.
- Release notes.
- Backup/reset dry run.
- Performance baseline.

Acceptance:

- 10-30 users can be invited.
- Main loop works without developer intervention.
- Admin can inspect issues.
- Known reset process exists.

## 5. Code-Level Plan Breakdown

Write separate implementation plans in this order:

1. `2026-07-01-v0.1-foundation-plan.md`
2. `2026-07-01-v0.2-playable-loop-plan.md`
3. `2026-07-01-v0.3-idle-action-loop-plan.md`
4. `2026-07-01-v0.4-economy-world-plan.md`
5. `2026-07-01-v0.5-living-npc-plan.md`
6. `2026-07-01-v0.6-ai-layer-plan.md`
7. `2026-07-01-v0.7-admin-simulation-plan.md`
8. `2026-07-01-v0.8-closed-test-candidate-plan.md`

Each code-level plan must include exact files, test-first steps, implementation snippets, commands, expected output, and commit boundaries.

## 6. First Code-Level Plan: v0.1 Foundation

The first detailed implementation plan should cover only v0.1 Foundation. It must not include combat, economy, NPC simulation, or AI dialogue.

Required tasks:

- [ ] Scaffold pnpm workspace.
- [ ] Scaffold React/Vite web app.
- [ ] Scaffold Fastify server.
- [ ] Add shared package with version constants and DTO skeletons.
- [ ] Add database migration setup.
- [ ] Add account schema.
- [ ] Add activation-code schema.
- [ ] Add session schema.
- [ ] Add audit-log schema.
- [ ] Add admin role support.
- [ ] Implement activation-code generation.
- [ ] Implement registration with activation-code consumption.
- [ ] Implement login/logout.
- [ ] Implement authenticated current-user endpoint.
- [ ] Implement minimal admin activation-code UI.
- [ ] Implement audit log writes for activation-code actions.
- [ ] Add Soft Reset protected command shape without destructive world reset behavior.
- [ ] Add unit and integration tests for activation-code registration.
- [ ] Add Playwright smoke test for registration/login.

## 7. Version Gate Checklist

Before marking any version complete:

- [ ] Database migrations run from empty DB.
- [ ] Tests for touched rule modules pass.
- [ ] Relevant integration tests pass.
- [ ] Admin visibility exists for new persisted state.
- [ ] Ledger entries exist for asset changes.
- [ ] AI outputs are schema-validated when AI is involved.
- [ ] Version constants updated when rules/content/prompts change.
- [ ] Release note written.
- [ ] Reset or rollback behavior is documented.

## 8. Maintainability Rules

- Keep rule logic in `packages/game-rules`.
- Keep content data in `packages/content`.
- Keep AI prompts and output schemas in `packages/ai-prompts`.
- Keep server orchestration in `apps/server`.
- Keep web rendering and interaction in `apps/web`.
- Avoid direct model calls outside AI Orchestrator.
- Avoid direct asset mutation outside Inventory/Ledger services.
- Avoid business decisions in React components.
- Prefer stable IDs and versioned content over hardcoded strings.
- Write tests before implementing rule functions.

## 9. Self-Review

Spec coverage:

- Product positioning, architecture, maps, UI, AI, economy, NPC, tasks, admin, safety, and testing are represented in the release train.
- Full AI dungeon work is intentionally excluded from v0.1-v0.7 and remains after the first closed-test candidate.
- Player-to-player economy, guilds, PVP, parties, advanced crafting, and mobile optimization remain outside the first release as stated in the spec.

Placeholder scan:

- This master plan contains no unresolved placeholders. It intentionally delegates code-level steps to follow-up per-version plans because the spec spans multiple independent subsystems.

Type and naming consistency:

- Product versions, compatibility versions, module names, and planned package names are consistent with the spec.
