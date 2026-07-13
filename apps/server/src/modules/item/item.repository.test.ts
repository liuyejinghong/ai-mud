import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ItemRepository,
  type ItemLedgerParty,
  type ItemOwner
} from "./item.repository.js";

type IncludesSystemSource<T> = "system_source" extends T ? true : false;

describe("ItemRepository ledger parties", () => {
  it("accepts system_source as a ledger source without widening inventory ownership", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const repository = new ItemRepository({ insert } as never);
    const source: ItemLedgerParty = { ownerType: "system_source", ownerId: null };

    await repository.writeLedger({
      operation: "grant",
      itemDefId: "wild_berry",
      quantity: 1,
      fromOwner: source,
      toOwner: { ownerType: "character", ownerId: "00000000-0000-0000-0000-000000000001" },
      reason: "municipal_relief"
    });

    expect(values).toHaveBeenCalledWith({
      operation: "grant",
      itemDefId: "wild_berry",
      quantity: 1,
      itemInstanceId: null,
      fromOwnerType: "system_source",
      fromOwnerId: null,
      toOwnerType: "character",
      toOwnerId: "00000000-0000-0000-0000-000000000001",
      reason: "municipal_relief",
      metadata: {}
    });
    expectTypeOf<IncludesSystemSource<ItemLedgerParty["ownerType"]>>().toEqualTypeOf<true>();
    expectTypeOf<IncludesSystemSource<ItemOwner["ownerType"]>>().toEqualTypeOf<false>();
  });
});
