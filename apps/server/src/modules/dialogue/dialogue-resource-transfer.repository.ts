import type { ItemId } from "@ai-mud/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { characters, worldActors } from "../../db/schema.js";
import { ItemRepository } from "../item/item.repository.js";
import { ItemService, ItemServiceError } from "../item/item.service.js";
import { LedgerRepository } from "../ledger/ledger.repository.js";
import { LedgerService } from "../ledger/ledger.service.js";

type DialogueResourceTransferDb = Pick<Db, "transaction">;

export class DialogueResourceTransferRepository {
  constructor(private readonly db: DialogueResourceTransferDb) {}

  async transferNpcCopperToCharacter(input: {
    npcActorId: string;
    characterId: string;
    copper: number;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [npc] = await tx
        .select({ copperBalance: worldActors.copperBalance })
        .from(worldActors)
        .where(eq(worldActors.id, input.npcActorId))
        .limit(1);
      if (!npc || npc.copperBalance < input.copper) return false;

      const debited = await tx
        .update(worldActors)
        .set({
          copperBalance: sql`${worldActors.copperBalance} - ${input.copper}`,
          updatedAt: new Date()
        })
        .where(
          and(eq(worldActors.id, input.npcActorId), gte(worldActors.copperBalance, input.copper))
        )
        .returning({ id: worldActors.id });
      if (debited.length === 0) return false;

      const credited = await tx
        .update(characters)
        .set({ copperBalance: sql`${characters.copperBalance} + ${input.copper}` })
        .where(eq(characters.id, input.characterId))
        .returning({ id: characters.id });
      if (credited.length === 0) throw new Error("Failed to credit character copper");

      await new LedgerService(new LedgerRepository(tx)).recordCopperTransfer({
        operation: "dialogue_gift",
        fromBucket: "npc",
        fromEntityId: input.npcActorId,
        toBucket: "player",
        toEntityId: input.characterId,
        amountCopper: input.copper,
        reason: "dialogue.resource_request"
      });

      return true;
    });
  }

  async transferNpcItemToCharacter(input: {
    npcActorId: string;
    characterId: string;
    itemId: ItemId;
    quantity: number;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      try {
        await new ItemService(new ItemRepository(tx, false)).transfer({
          fromOwner: { ownerType: "npc", ownerId: input.npcActorId },
          toOwner: { ownerType: "character", ownerId: input.characterId },
          itemId: input.itemId,
          quantity: input.quantity,
          reason: "dialogue.resource_request"
        });
        return true;
      } catch (error) {
        if (error instanceof ItemServiceError) return false;
        throw error;
      }
    });
  }
}
