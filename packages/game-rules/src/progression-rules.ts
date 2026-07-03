export interface LevelProgressionResult {
  level: number;
  leveledUp: boolean;
}

export const MAX_CHARACTER_LEVEL = 60;

export function xpRequiredForLevel(level: number) {
  const normalizedLevel = Math.max(1, Math.floor(level));
  return normalizedLevel * normalizedLevel * 12;
}

export function calculateLevelFromXp(xp: number) {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;

  while (level < MAX_CHARACTER_LEVEL && safeXp >= xpRequiredForLevel(level + 1)) {
    level += 1;
  }

  return level;
}

export function settleLevelProgression(input: {
  currentLevel: number;
  nextXp: number;
}): LevelProgressionResult {
  const level = Math.max(input.currentLevel, calculateLevelFromXp(input.nextXp));
  return {
    level,
    leveledUp: level > input.currentLevel
  };
}
