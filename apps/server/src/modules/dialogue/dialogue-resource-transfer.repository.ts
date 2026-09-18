import type { ItemId } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { AssetMutationService } from "../ledger/asset-mutation.service.js";
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
      // Copper movement goes through the assets module: it owns every balance
      // column (modularity.md §7 / ARCH-03).
      const assets = new AssetMutationService(tx);
      const debited = await assets.debitNpcCopperIfAvailable(input.npcActorId, input.copper);
      if (!debited) return false;

      await assets.creditCharacterCopper(input.characterId, input.copper);

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
