import type { ItemId } from "@ai-mud/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { characterItems, characters, npcItems, worldActors } from "../../db/schema.js";

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
      const [npcStack] = await tx
        .select({ id: npcItems.id, quantity: npcItems.quantity })
        .from(npcItems)
        .where(and(eq(npcItems.actorId, input.npcActorId), eq(npcItems.itemId, input.itemId)))
        .limit(1);
      if (!npcStack || npcStack.quantity < input.quantity) return false;

      const debited = await tx
        .update(npcItems)
        .set({
          quantity: sql`${npcItems.quantity} - ${input.quantity}`,
          updatedAt: new Date()
        })
        .where(and(eq(npcItems.id, npcStack.id), gte(npcItems.quantity, input.quantity)))
        .returning({ id: npcItems.id });
      if (debited.length === 0) return false;

      await tx
        .insert(characterItems)
        .values({
          characterId: input.characterId,
          itemId: input.itemId,
          quantity: input.quantity
        })
        .onConflictDoUpdate({
          target: [characterItems.characterId, characterItems.itemId],
          set: {
            quantity: sql`${characterItems.quantity} + ${input.quantity}`,
            updatedAt: new Date()
          }
        });

      return true;
    });
  }
}
