import type { Db } from "../../db/client.js";
import {
  aiCallLogs,
  characterActions,
  characterItems,
  characterPresence,
  characters,
  chatMessages,
  gameEvents,
  assetLedger,
  itemInstances,
  itemLedger,
  mapInstances,
  marketInventory,
  marketTransactions,
  municipalTreasury,
  npcActions,
  npcDialogueMessages,
  npcEvents,
  npcItems,
  npcMemoryEntries,
  npcMemoryFragments,
  npcRelationships,
  npcTasks,
  syncEvents,
  systemAnnouncements,
  worldActors,
  worldResourceNodes,
  worldRumors,
  worldRuntimeState
} from "../../db/schema.js";
import { NpcRepository } from "../npc/npc.repository.js";
import { NpcService } from "../npc/npc.service.js";
import { LedgerRepository } from "../ledger/ledger.repository.js";
import { LedgerService } from "../ledger/ledger.service.js";
import type { WorldResetRepositoryPort } from "./world-reset.service.js";

type WorldResetDb = Pick<Db, "delete" | "insert" | "select" | "update">;

const CLEARED_TABLES = [
  "sync_events",
  "world_rumors",
  "npc_tasks",
  "npc_memory_fragments",
  "npc_memory_entries",
  "npc_relationships",
  "npc_dialogue_messages",
  "game_events",
  "character_actions",
  "map_instances",
  "market_transactions",
  "asset_ledger",
  "item_ledger",
  "character_equipment",
  "character_items",
  "character_presence",
  "chat_messages",
  "system_announcements",
  "npc_events",
  "npc_actions",
  "npc_items",
  "world_resource_nodes",
  "market_inventory",
  "municipal_treasury",
  "world_runtime_state",
  "item_instances",
  "characters",
  "world_actors"
] as const;

export class WorldResetRepository implements WorldResetRepositoryPort {
  constructor(private readonly db: WorldResetDb) {}

  async resetWorldState(): Promise<{ clearedTables: string[] }> {
    await this.db
      .update(aiCallLogs)
      .set({ characterId: null, npcActorId: null });

    await this.db.delete(syncEvents);
    await this.db.delete(worldRumors);
    await this.db.delete(npcTasks);
    await this.db.delete(npcMemoryFragments);
    await this.db.delete(npcMemoryEntries);
    await this.db.delete(npcRelationships);
    await this.db.delete(npcDialogueMessages);
    await this.db.delete(gameEvents);
    await this.db.delete(characterActions);
    await this.db.delete(mapInstances);
    await this.db.delete(marketTransactions);
    await this.db.delete(assetLedger);
    await this.db.delete(itemLedger);
    await this.db.delete(characterItems);
    await this.db.delete(characterPresence);
    await this.db.delete(chatMessages);
    await this.db.delete(systemAnnouncements);
    await this.db.delete(npcEvents);
    await this.db.delete(npcActions);
    await this.db.delete(npcItems);
    await this.db.delete(worldResourceNodes);
    await this.db.delete(marketInventory);
    await this.db.delete(municipalTreasury);
    const [runtimeRow] = await this.db
      .select({ worldEpoch: worldRuntimeState.worldEpoch })
      .from(worldRuntimeState)
      .limit(1);
    const nextEpoch = (runtimeRow?.worldEpoch ?? 0) + 1;
    await this.db.delete(worldRuntimeState);
    await this.db.insert(worldRuntimeState).values({
      key: "npc_world",
      lastSettledAt: new Date(0),
      worldEpoch: nextEpoch
    });
    await this.db.delete(itemInstances);
    await this.db.delete(characters);
    await this.db.delete(worldActors);

    return { clearedTables: [...CLEARED_TABLES] };
  }

  async seedBaseWorld(input: { resetAt: Date }): Promise<void> {
    const npcService = new NpcService(
      new NpcRepository(this.db),
      new LedgerService(new LedgerRepository(this.db))
    );
    await npcService.ensureWorldSeeded(input.resetAt);
  }
}
