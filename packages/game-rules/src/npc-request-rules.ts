import type { ItemId } from "@ai-mud/shared";

export type NpcResourceRequest =
  | { kind: "item"; itemId: ItemId; quantity: number }
  | { kind: "copper"; copper: number };

export type NpcResourceRequestDecision =
  | {
      outcome: "no_request";
      request: null;
      reason: "no_supported_request";
    }
  | {
      outcome: "granted";
      request: NpcResourceRequest;
      reason: "rule_verified";
    }
  | {
      outcome: "rejected";
      request: NpcResourceRequest;
      reason:
        | "unsupported_item"
        | "low_relationship"
        | "insufficient_inventory"
        | "insufficient_copper"
        | "reserve_required"
        | "quantity_too_high";
    };

export interface NpcResourceRequestDecisionInput {
  message: string;
  npcInventory: Array<{ itemId: string; quantity: number }>;
  npcCopper: number;
  relationship?: {
    familiarity: number;
    trust: number;
  } | null;
}

const ITEM_GRANT_CAP = 2;
const COPPER_GRANT_CAP = 5;
const NPC_COPPER_RESERVE = 20;
const ITEM_RESERVE: Partial<Record<ItemId, number>> = {
  iron_ore: 3,
  wild_berry: 1
};

const SUPPORTED_ITEMS: Record<ItemId, RegExp[]> = {
  wild_berry: [/野莓/, /浆果/, /吃的/, /食物/, /口粮/],
  iron_ore: [/基础铁矿石/, /铁矿石/, /铁矿/, /矿石/],
  beast_meat: [],
  rough_hide: []
};

export function parseNpcResourceRequest(message: string): NpcResourceRequest | null {
  const normalized = message.trim();
  if (!/(给|借|送|能不能|可以给|求|需要|想要)/.test(normalized)) return null;

  if (/(金币|银币|铜币|钱)/.test(normalized)) {
    return { kind: "copper", copper: Math.max(1, Math.min(parseQuantity(normalized) ?? 1, COPPER_GRANT_CAP)) };
  }

  for (const [itemId, patterns] of Object.entries(SUPPORTED_ITEMS)) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return {
        kind: "item",
        itemId: itemId as ItemId,
        quantity: Math.max(1, Math.min(parseQuantity(normalized) ?? 1, ITEM_GRANT_CAP))
      };
    }
  }

  return null;
}

export function decideNpcResourceRequest(
  input: NpcResourceRequestDecisionInput
): NpcResourceRequestDecision {
  const request = parseNpcResourceRequest(input.message);
  if (!request) {
    return { outcome: "no_request", request: null, reason: "no_supported_request" };
  }

  if (!hasRelationshipForFavor(input.relationship)) {
    return { outcome: "rejected", request, reason: "low_relationship" };
  }

  if (request.kind === "copper") {
    if (request.copper > COPPER_GRANT_CAP) {
      return { outcome: "rejected", request, reason: "quantity_too_high" };
    }
    if (input.npcCopper < request.copper) {
      return { outcome: "rejected", request, reason: "insufficient_copper" };
    }
    if (input.npcCopper - request.copper < NPC_COPPER_RESERVE) {
      return { outcome: "rejected", request, reason: "reserve_required" };
    }
    return { outcome: "granted", request, reason: "rule_verified" };
  }

  if (!hasSupportedItem(request.itemId)) {
    return { outcome: "rejected", request, reason: "unsupported_item" };
  }
  if (request.quantity > ITEM_GRANT_CAP) {
    return { outcome: "rejected", request, reason: "quantity_too_high" };
  }

  const available = input.npcInventory.find((entry) => entry.itemId === request.itemId)?.quantity ?? 0;
  if (available < request.quantity) {
    return { outcome: "rejected", request, reason: "insufficient_inventory" };
  }
  const reserve = ITEM_RESERVE[request.itemId] ?? 0;
  if (available - request.quantity < reserve) {
    return { outcome: "rejected", request, reason: "reserve_required" };
  }

  return { outcome: "granted", request, reason: "rule_verified" };
}

function hasRelationshipForFavor(relationship: NpcResourceRequestDecisionInput["relationship"]) {
  return (relationship?.familiarity ?? 0) >= 2 || (relationship?.trust ?? 0) >= 1;
}

function hasSupportedItem(itemId: ItemId) {
  return itemId === "wild_berry" || itemId === "iron_ore";
}

function parseQuantity(value: string) {
  const digit = value.match(/(\d+)/)?.[1];
  if (digit) return Number.parseInt(digit, 10);

  if (/[一1]/.test(value)) return 1;
  if (/[两二2]/.test(value)) return 2;
  if (/[三3]/.test(value)) return 3;
  return null;
}
