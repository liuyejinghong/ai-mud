import { BLACKPINE_OUTPOST, CORRUPT_FOREST, getItemById } from "@ai-mud/content";
import { addInventoryItem, buildMapCells, movePosition } from "@ai-mud/game-rules";
import {
  CHARACTER_CLASSES,
  type CharacterDto,
  type CharacterClassId,
  type CreateCharacterRequestDto,
  type Direction,
  type GameStateDto,
  type GridPositionDto
} from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { GameRepository, type CharacterRecord } from "./game.repository.js";

export class GameServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

function classMaxHp(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return characterClass.baseStats.vitality * 10;
}

function initialResourceCharges() {
  return Object.fromEntries(CORRUPT_FOREST.resources.map((resource) => [resource.id, resource.charges]));
}

function findLiveResourceAt(position: GridPositionDto, resourceCharges: Record<string, number>) {
  return (
    CORRUPT_FOREST.resources.find(
      (resource) =>
        resource.position.x === position.x &&
        resource.position.y === position.y &&
        (resourceCharges[resource.id] ?? resource.charges) > 0
    ) ?? null
  );
}

function directionLabel(direction: Direction) {
  return {
    north: "北",
    south: "南",
    west: "西",
    east: "东"
  }[direction];
}

function toCharacterDto(character: CharacterRecord): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    classId: character.classId,
    level: character.level,
    xp: character.xp,
    hp: character.hp,
    maxHp: character.maxHp,
    currentLocation: character.currentLocation,
    position: character.position,
    injuryUntil: character.injuryUntil?.toISOString() ?? null
  };
}

export class GameService {
  constructor(private readonly db: Db) {}

  async getState(accountId: string): Promise<GameStateDto> {
    return this.buildState(new GameRepository(this.db), accountId);
  }

  async createCharacter(
    accountId: string,
    input: CreateCharacterRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const existing = await repo.findCharacterByAccountId(accountId);
      if (existing) {
        throw new GameServiceError("VALIDATION_ERROR", "Character already exists");
      }

      const maxHp = classMaxHp(input.classId);
      const character = await repo.createCharacter({
        accountId,
        name: input.name.trim(),
        classId: input.classId,
        hp: maxHp,
        maxHp
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.create",
        message: `${character.name} 抵达黑松哨站。`
      });

      return this.buildState(repo, accountId);
    });
  }

  async enterCorruptForest(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireCharacter(repo, accountId);
      const existingMap = await repo.findMapInstance(character.id, CORRUPT_FOREST.id);

      if (!existingMap) {
        await repo.createMapInstance({
          characterId: character.id,
          zoneId: CORRUPT_FOREST.id,
          resourceCharges: initialResourceCharges()
        });
      }

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: CORRUPT_FOREST.id,
        position: CORRUPT_FOREST.entry
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "zone.enter",
        message: "你穿过南侧木门，踏入腐林。"
      });

      return this.buildState(repo, accountId);
    });
  }

  async move(accountId: string, direction: Direction): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireCharacterInForest(repo, accountId);
      const result = movePosition(CORRUPT_FOREST, character.position, direction);

      if (!result.ok) {
        throw new GameServiceError("VALIDATION_ERROR", "边界被倒伏的黑木挡住。");
      }

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: CORRUPT_FOREST.id,
        position: result.position
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.move",
        message: `你向${directionLabel(direction)}移动，树影遮住了回路。`,
        metadata: { direction, position: result.position }
      });

      return this.buildState(repo, accountId);
    });
  }

  async gather(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireCharacterInForest(repo, accountId);
      const map = await this.requireCorruptForestMap(repo, character);
      const resource = findLiveResourceAt(character.position, map.resourceCharges);

      if (!resource) {
        throw new GameServiceError("VALIDATION_ERROR", "这里没有可采集的资源。");
      }

      const nextCharges = {
        ...map.resourceCharges,
        [resource.id]: (map.resourceCharges[resource.id] ?? resource.charges) - 1
      };
      const inventory = await repo.listInventory(character.id);
      const nextInventory = addInventoryItem(
        inventory,
        resource.gatherResult.itemId,
        resource.gatherResult.quantity
      );
      const changedStack = nextInventory.find(
        (item) => item.itemId === resource.gatherResult.itemId
      );

      if (!changedStack) {
        throw new Error("Failed to calculate gathered inventory stack");
      }

      await repo.updateMapResourceCharges(map.id, nextCharges);
      await repo.setInventoryItem({
        characterId: character.id,
        itemId: changedStack.itemId,
        quantity: changedStack.quantity
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "resource.gather",
        message: `你采集了${resource.name}。`,
        metadata: { resourceId: resource.id, itemId: changedStack.itemId }
      });

      return this.buildState(repo, accountId);
    });
  }

  private async requireCharacter(repo: GameRepository, accountId: string) {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) {
      throw new GameServiceError("VALIDATION_ERROR", "Character required");
    }
    return character;
  }

  private async requireCharacterInForest(repo: GameRepository, accountId: string) {
    const character = await this.requireCharacter(repo, accountId);
    if (character.currentLocation !== CORRUPT_FOREST.id || !character.position) {
      throw new GameServiceError("VALIDATION_ERROR", "Character is not exploring");
    }
    return character as CharacterRecord & { position: GridPositionDto };
  }

  private async requireCorruptForestMap(
    repo: GameRepository,
    character: CharacterRecord
  ) {
    const map = await repo.findMapInstance(character.id, CORRUPT_FOREST.id);
    if (!map) {
      throw new GameServiceError("VALIDATION_ERROR", "Map state required");
    }
    return map;
  }

  private async buildState(repo: GameRepository, accountId: string): Promise<GameStateDto> {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) {
      return {
        character: null,
        locationTitle: BLACKPINE_OUTPOST.title,
        locationDescription: "你尚未创建角色。",
        map: null,
        inventory: [],
        currentAction: null,
        availableActions: ["create_character"],
        log: []
      };
    }

    const inventory = await repo.listInventory(character.id);
    const log = await repo.listRecentEvents(character.id);
    const inventoryDto = inventory.map((item) => ({
      itemId: item.itemId,
      name: getItemById(item.itemId)?.name ?? item.itemId,
      quantity: item.quantity
    }));

    if (character.currentLocation !== CORRUPT_FOREST.id || !character.position) {
      return {
        character: toCharacterDto(character),
        locationTitle: BLACKPINE_OUTPOST.title,
        locationDescription: BLACKPINE_OUTPOST.description,
        map: null,
        inventory: inventoryDto,
        currentAction: null,
        availableActions: ["enter_corrupt_forest"],
        log: log.map((entry) => ({
          id: entry.id,
          message: entry.message,
          createdAt: entry.createdAt.toISOString()
        }))
      };
    }

    const map = await repo.findMapInstance(character.id, CORRUPT_FOREST.id);
    const resourceCharges = map?.resourceCharges ?? initialResourceCharges();
    const availableActions: GameStateDto["availableActions"] = ["move"];

    if (findLiveResourceAt(character.position, resourceCharges)) {
      availableActions.push("gather");
    }

    return {
      character: toCharacterDto(character),
      locationTitle: CORRUPT_FOREST.title,
      locationDescription: CORRUPT_FOREST.description,
      map: {
        zoneId: CORRUPT_FOREST.id,
        width: CORRUPT_FOREST.width,
        height: CORRUPT_FOREST.height,
        cells: buildMapCells(CORRUPT_FOREST, character.position, resourceCharges)
      },
      inventory: inventoryDto,
      currentAction: null,
      availableActions,
      log: log.map((entry) => ({
        id: entry.id,
        message: entry.message,
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }
}
