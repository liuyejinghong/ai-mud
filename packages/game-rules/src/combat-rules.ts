import type { MonsterDefinition } from "@ai-mud/content";
import type { ItemId } from "@ai-mud/shared";

export interface CombatantStats {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  agility: number;
}

export interface CombatTimelineEntry {
  atMs: number;
  message: string;
}

export interface CombatResult {
  outcome: "victory" | "injury" | "stalemate";
  durationMs: number;
  playerRemainingHp: number;
  playerAttackCount: number;
  monsterAttackCount: number;
  xp: number;
  loot: Array<{ itemId: ItemId; quantity: number }>;
  timeline: CombatTimelineEntry[];
}

export interface SimulateCombatInput {
  seed: string;
  player: CombatantStats;
  monsters: MonsterDefinition[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function intervalMs(agility: number) {
  return clamp(Math.round(3000 / (1 + (agility - 10) * 0.04)), 1200, 4500);
}

function damage(attack: number, defense: number) {
  return Math.max(1, attack - Math.floor(defense * 0.45));
}

function chance(seed: string, index: number) {
  let hash = 0;
  const text = `${seed}:${index}`;

  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return (hash % 1000) / 1000;
}

export function simulateCombat(input: SimulateCombatInput): CombatResult {
  const monsters = input.monsters.map((monster, index) => ({
    ...monster,
    instanceId: `${monster.id}-${index}`,
    currentHp: monster.hp,
    nextAttackAt: intervalMs(monster.agility)
  }));
  const player = {
    ...input.player,
    currentHp: input.player.hp,
    nextAttackAt: intervalMs(input.player.agility)
  };
  const timeline: CombatTimelineEntry[] = [];
  const maxDurationMs = 600_000;
  let now = 0;
  let playerAttackCount = 0;
  let monsterAttackCount = 0;

  while (now <= maxDurationMs) {
    const aliveMonsters = monsters.filter((monster) => monster.currentHp > 0);

    if (aliveMonsters.length === 0) {
      const loot = input.monsters.flatMap((monster, monsterIndex) =>
        monster.lootTable
          .filter(
            (entry, lootIndex) => chance(input.seed, monsterIndex * 10 + lootIndex) <= entry.chance
          )
          .map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity }))
      );

      return {
        outcome: "victory",
        durationMs: now,
        playerRemainingHp: player.currentHp,
        playerAttackCount,
        monsterAttackCount,
        xp: input.monsters.reduce((sum, monster) => sum + monster.xp, 0),
        loot,
        timeline
      };
    }

    if (player.currentHp <= 0) {
      return {
        outcome: "injury",
        durationMs: now,
        playerRemainingHp: 0,
        playerAttackCount,
        monsterAttackCount,
        xp: 0,
        loot: [],
        timeline
      };
    }

    const nextMonsterAttackAt = Math.min(...aliveMonsters.map((monster) => monster.nextAttackAt));
    now = Math.min(player.nextAttackAt, nextMonsterAttackAt);

    if (player.nextAttackAt <= nextMonsterAttackAt) {
      const target = aliveMonsters[0]!;
      const hit = damage(player.attack, target.defense);
      target.currentHp = Math.max(0, target.currentHp - hit);
      player.nextAttackAt += intervalMs(player.agility);
      playerAttackCount += 1;
      timeline.push({
        atMs: now,
        message: `${player.name} 攻击${target.name}，造成 ${hit} 点伤害。`
      });
    } else {
      const attacker = aliveMonsters.find(
        (monster) => monster.nextAttackAt === nextMonsterAttackAt
      )!;
      const hit = damage(attacker.attack, player.defense);
      player.currentHp = Math.max(0, player.currentHp - hit);
      attacker.nextAttackAt += intervalMs(attacker.agility);
      monsterAttackCount += 1;
      timeline.push({
        atMs: now,
        message: `${attacker.name} 撕咬${player.name}，造成 ${hit} 点伤害。`
      });
    }
  }

  return {
    outcome: "stalemate",
    durationMs: maxDurationMs,
    playerRemainingHp: player.currentHp,
    playerAttackCount,
    monsterAttackCount,
    xp: 0,
    loot: [],
    timeline
  };
}
