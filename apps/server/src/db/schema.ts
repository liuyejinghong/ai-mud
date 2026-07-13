import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const accountRole = pgEnum("account_role", ["player", "admin", "super_admin"]);
export const accountStatus = pgEnum("account_status", ["active", "disabled"]);
export const activationCodeStatus = pgEnum("activation_code_status", [
  "unused",
  "used",
  "expired",
  "revoked"
]);
export const characterClass = pgEnum("character_class", ["warrior", "ranger", "warlock"]);
export const gameLocation = pgEnum("game_location", [
  "blackpine_outpost",
  "corrupt_forest",
  "old_mine",
  "ash_watch"
]);
export const characterActionType = pgEnum("character_action_type", ["gathering", "combat"]);
export const characterActionStatus = pgEnum("character_action_status", [
  "active",
  "completed",
  "cancelled"
]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: accountRole("role").notNull().default("player"),
    status: accountStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true })
  },
  (table) => ({
    emailIdx: index("accounts_email_idx").on(table.email)
  })
);

export const activationCodes = pgTable(
  "activation_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    status: activationCodeStatus("status").notNull().default("unused"),
    note: text("note"),
    createdByAdminId: uuid("created_by_admin_id").references(() => accounts.id),
    usedByAccountId: uuid("used_by_account_id").references(() => accounts.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => ({
    codeHashIdx: index("activation_codes_code_hash_idx").on(table.codeHash),
    statusIdx: index("activation_codes_status_idx").on(table.status)
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => ({
    tokenHashIdx: index("sessions_token_hash_idx").on(table.tokenHash),
    accountIdx: index("sessions_account_id_idx").on(table.accountId)
  })
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorAccountId: uuid("actor_account_id").references(() => accounts.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    actionIdx: index("audit_logs_action_idx").on(table.action),
    createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt)
  })
);

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id).unique(),
    name: text("name").notNull(),
    classId: characterClass("class_id").notNull(),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    hp: integer("hp").notNull(),
    maxHp: integer("max_hp").notNull(),
    copperBalance: integer("copper_balance").notNull().default(0),
    hunger: integer("hunger").notNull().default(5),
    lastHungerSettledAt: timestamp("last_hunger_settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    currentLocation: gameLocation("current_location").notNull().default("blackpine_outpost"),
    position: jsonb("position"),
    injuryUntil: timestamp("injury_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    accountIdx: index("characters_account_id_idx").on(table.accountId),
    copperBalanceCheck: check(
      "characters_copper_balance_nonnegative_check",
      sql`${table.copperBalance} >= 0`
    )
  })
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    channel: text("channel").notNull().default("lobby"),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    channelIdIdx: index("chat_messages_channel_id_idx").on(table.channel, table.id),
    characterCreatedAtIdx: index("chat_messages_character_created_at_idx").on(
      table.characterId,
      table.createdAt
    ),
    channelCheck: check("chat_messages_channel_check", sql`${table.channel} IN ('lobby')`)
  })
);

export const systemAnnouncements = pgTable(
  "system_announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminAccountId: uuid("admin_account_id").notNull().references(() => accounts.id),
    body: text("body").notNull(),
    severity: text("severity").notNull().default("info"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    createdAtIdx: index("system_announcements_created_at_idx").on(table.createdAt),
    severityCheck: check(
      "system_announcements_severity_check",
      sql`${table.severity} IN ('info')`
    ),
    bodyLengthCheck: check(
      "system_announcements_body_length_check",
      sql`char_length(${table.body}) BETWEEN 1 AND 240`
    )
  })
);

export const characterPresence = pgTable(
  "character_presence",
  {
    accountId: uuid("account_id").primaryKey().references(() => accounts.id),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterIdx: index("character_presence_character_id_idx").on(table.characterId),
    lastSeenIdx: index("character_presence_last_seen_at_idx").on(table.lastSeenAt)
  })
);

export const characterItems = pgTable(
  "character_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterItemIdx: uniqueIndex("character_items_character_item_idx").on(
      table.characterId,
      table.itemId
    ),
    quantityCheck: check("character_items_quantity_nonnegative_check", sql`${table.quantity} >= 0`)
  })
);

export const characterEquipment = pgTable(
  "character_equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    slot: text("slot").notNull(),
    itemKey: text("item_key").notNull(),
    name: text("name").notNull(),
    itemLevel: integer("item_level").notNull(),
    attackBonus: integer("attack_bonus").notNull().default(0),
    defenseBonus: integer("defense_bonus").notNull().default(0),
    maxDurability: integer("max_durability").notNull().default(100),
    currentDurability: integer("current_durability").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterSlotIdx: uniqueIndex("character_equipment_character_slot_idx").on(
      table.characterId,
      table.slot
    )
  })
);

export const itemInstances = pgTable(
  "item_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemDefId: text("item_def_id").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id"),
    locationType: text("location_type").notNull().default("inventory"),
    locationId: text("location_id"),
    slot: text("slot"),
    rarity: text("rarity").notNull().default("common"),
    itemLevel: integer("item_level").notNull(),
    baseStats: jsonb("base_stats").notNull().default({}),
    affixes: jsonb("affixes").notNull().default([]),
    maxDurability: integer("max_durability").notNull(),
    currentDurability: integer("current_durability").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    ownerIdx: index("item_instances_owner_idx").on(
      table.ownerType,
      table.ownerId,
      table.locationType
    ),
    characterEquippedSlotIdx: uniqueIndex("item_instances_character_equipped_slot_idx")
      .on(table.ownerId, table.slot)
      .where(
        sql`${table.ownerType} = 'character' AND ${table.locationType} = 'equipped' AND ${table.slot} IS NOT NULL`
      ),
    ownerTypeCheck: check(
      "item_instances_owner_type_check",
      sql`${table.ownerType} IN ('character', 'npc', 'market', 'system')`
    ),
    locationTypeCheck: check(
      "item_instances_location_type_check",
      sql`${table.locationType} IN ('inventory', 'equipped', 'market', 'destroyed')`
    ),
    slotCheck: check(
      "item_instances_slot_check",
      sql`${table.slot} IS NULL OR ${table.slot} IN ('weapon', 'chest', 'head', 'accessory')`
    ),
    rarityCheck: check(
      "item_instances_rarity_check",
      sql`${table.rarity} IN ('common', 'uncommon', 'rare', 'epic')`
    ),
    durabilityCheck: check(
      "item_instances_durability_check",
      sql`${table.maxDurability} > 0 AND ${table.currentDurability} >= 0 AND ${table.currentDurability} <= ${table.maxDurability}`
    )
  })
);

export const itemLedger = pgTable(
  "item_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operation: text("operation").notNull(),
    itemDefId: text("item_def_id").notNull(),
    quantity: integer("quantity"),
    itemInstanceId: uuid("item_instance_id").references(() => itemInstances.id),
    fromOwnerType: text("from_owner_type"),
    fromOwnerId: uuid("from_owner_id"),
    toOwnerType: text("to_owner_type"),
    toOwnerId: uuid("to_owner_id"),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    instanceIdx: index("item_ledger_instance_idx").on(table.itemInstanceId, table.createdAt),
    ownerIdx: index("item_ledger_owner_idx").on(
      table.toOwnerType,
      table.toOwnerId,
      table.createdAt
    ),
    operationCheck: check(
      "item_ledger_operation_check",
      sql`${table.operation} IN ('grant', 'consume', 'transfer', 'equip', 'unequip', 'destroy')`
    ),
    quantityCheck: check(
      "item_ledger_quantity_check",
      sql`${table.quantity} IS NULL OR ${table.quantity} > 0`
    ),
    fromOwnerTypeCheck: check(
      "item_ledger_from_owner_type_check",
      sql`${table.fromOwnerType} IS NULL OR ${table.fromOwnerType} IN ('character', 'npc', 'market', 'system')`
    ),
    toOwnerTypeCheck: check(
      "item_ledger_to_owner_type_check",
      sql`${table.toOwnerType} IS NULL OR ${table.toOwnerType} IN ('character', 'npc', 'market', 'system')`
    )
  })
);

export const assetLedger = pgTable(
  "asset_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetType: text("asset_type").notNull(),
    operation: text("operation").notNull(),
    fromBucket: text("from_bucket"),
    fromEntityId: text("from_entity_id"),
    toBucket: text("to_bucket"),
    toEntityId: text("to_entity_id"),
    amountCopper: integer("amount_copper").notNull(),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    createdAtIdx: index("asset_ledger_created_at_idx").on(table.createdAt),
    operationCreatedAtIdx: index("asset_ledger_operation_created_at_idx").on(
      table.operation,
      table.createdAt
    ),
    fromBucketCreatedAtIdx: index("asset_ledger_from_bucket_created_at_idx").on(
      table.fromBucket,
      table.createdAt
    ),
    toBucketCreatedAtIdx: index("asset_ledger_to_bucket_created_at_idx").on(
      table.toBucket,
      table.createdAt
    ),
    assetTypeCheck: check("asset_ledger_asset_type_check", sql`${table.assetType} IN ('copper')`),
    fromBucketCheck: check(
      "asset_ledger_from_bucket_check",
      sql`${table.fromBucket} IS NULL OR ${table.fromBucket} IN ('player', 'npc', 'municipal', 'escrow', 'system_source', 'system_sink')`
    ),
    toBucketCheck: check(
      "asset_ledger_to_bucket_check",
      sql`${table.toBucket} IS NULL OR ${table.toBucket} IN ('player', 'npc', 'municipal', 'escrow', 'system_source', 'system_sink')`
    ),
    positiveAmountCheck: check(
      "asset_ledger_positive_amount_check",
      sql`${table.amountCopper} > 0`
    )
  })
);

export const marketInventory = pgTable(
  "market_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: text("settlement_id").notNull(),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull().default(0),
    targetQuantity: integer("target_quantity").notNull(),
    baseBuyPriceCopper: integer("base_buy_price_copper").notNull(),
    baseSellPriceCopper: integer("base_sell_price_copper").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    settlementItemIdx: uniqueIndex("market_inventory_settlement_item_idx").on(
      table.settlementId,
      table.itemId
    ),
    quantityCheck: check("market_inventory_quantity_nonnegative_check", sql`${table.quantity} >= 0`)
  })
);

export const marketTransactions = pgTable(
  "market_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: text("settlement_id").notNull(),
    characterId: uuid("character_id").references(() => characters.id),
    actorType: text("actor_type").notNull().default("player"),
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull().default("unknown"),
    transactionType: text("transaction_type").notNull(),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCopper: integer("unit_price_copper").notNull(),
    grossCopper: integer("gross_copper").notNull(),
    taxCopper: integer("tax_copper").notNull(),
    netCopper: integer("net_copper").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    settlementCreatedAtIdx: index("market_transactions_settlement_created_at_idx").on(
      table.settlementId,
      table.createdAt
    ),
    characterCreatedAtIdx: index("market_transactions_character_created_at_idx").on(
      table.characterId,
      table.createdAt
    )
  })
);

export const worldActors = pgTable(
  "world_actors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: text("actor_type").notNull(),
    npcKey: text("npc_key").unique(),
    name: text("name").notNull(),
    profession: text("profession").notNull(),
    currentLocation: gameLocation("current_location").notNull().default("blackpine_outpost"),
    position: jsonb("position"),
    copperBalance: integer("copper_balance").notNull().default(0),
    hunger: integer("hunger").notNull().default(5),
    lastHungerSettledAt: timestamp("last_hunger_settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    injuryUntil: timestamp("injury_until", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    actorTypeIdx: index("world_actors_actor_type_idx").on(table.actorType),
    npcKeyIdx: index("world_actors_npc_key_idx").on(table.npcKey),
    copperBalanceCheck: check(
      "world_actors_copper_balance_nonnegative_check",
      sql`${table.copperBalance} >= 0`
    )
  })
);

export const npcItems = pgTable(
  "npc_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull().references(() => worldActors.id),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    actorItemIdx: uniqueIndex("npc_items_actor_item_idx").on(table.actorId, table.itemId),
    quantityCheck: check("npc_items_quantity_nonnegative_check", sql`${table.quantity} >= 0`)
  })
);

export const npcActions = pgTable(
  "npc_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull().references(() => worldActors.id),
    actionType: text("action_type").notNull(),
    status: characterActionStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    actorStatusIdx: index("npc_actions_actor_status_idx").on(table.actorId, table.status),
    endsAtIdx: index("npc_actions_ends_at_idx").on(table.endsAt)
  })
);

export const npcEvents = pgTable(
  "npc_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull().references(() => worldActors.id),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    actorCreatedAtIdx: index("npc_events_actor_created_at_idx").on(table.actorId, table.createdAt)
  })
);

export const worldResourceNodes = pgTable(
  "world_resource_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: gameLocation("zone_id").notNull(),
    resourceId: text("resource_id").notNull(),
    position: jsonb("position").notNull(),
    charges: integer("charges").notNull(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    resourceIdx: uniqueIndex("world_resource_nodes_resource_idx").on(table.zoneId, table.resourceId),
    chargesCheck: check(
      "world_resource_nodes_charges_nonnegative_check",
      sql`${table.charges} >= 0`
    )
  })
);

export const municipalTreasury = pgTable(
  "municipal_treasury",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: text("settlement_id").notNull().unique(),
    copperBalance: integer("copper_balance").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    settlementIdx: index("municipal_treasury_settlement_idx").on(table.settlementId),
    copperBalanceCheck: check(
      "municipal_treasury_copper_balance_nonnegative_check",
      sql`${table.copperBalance} >= 0`
    )
  })
);

export const worldRuntimeState = pgTable(
  "world_runtime_state",
  {
    key: text("key").primaryKey(),
    lastSettledAt: timestamp("last_settled_at", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    leaseUntilIdx: index("world_runtime_state_lease_until_idx").on(table.leaseUntil)
  })
);

export const aiCallLogs = pgTable(
  "ai_call_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    purpose: text("purpose").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    characterId: uuid("character_id").references(() => characters.id),
    npcActorId: uuid("npc_actor_id").references(() => worldActors.id),
    requestHash: text("request_hash").notNull(),
    inputSummary: text("input_summary").notNull(),
    outputSummary: text("output_summary").notNull(),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    createdAtIdx: index("ai_call_logs_created_at_idx").on(table.createdAt),
    npcCreatedAtIdx: index("ai_call_logs_npc_created_at_idx").on(
      table.npcActorId,
      table.createdAt
    )
  })
);

export const worldRumors = pgTable(
  "world_rumors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    settlementId: text("settlement_id"),
    audience: text("audience").notNull().default("public"),
    message: text("message").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    generatedBy: text("generated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
  },
  (table) => ({
    sourceIdx: index("world_rumors_source_idx").on(table.sourceType, table.sourceId),
    createdAtIdx: index("world_rumors_created_at_idx").on(table.createdAt),
    audienceCreatedAtIdx: index("world_rumors_audience_created_at_idx").on(
      table.audience,
      table.createdAt
    )
  })
);

export const npcDialogueMessages = pgTable(
  "npc_dialogue_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    npcActorId: uuid("npc_actor_id").notNull().references(() => worldActors.id),
    speakerType: text("speaker_type").notNull(),
    message: text("message").notNull(),
    safetyFlags: jsonb("safety_flags").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    conversationCreatedAtIdx: index("npc_dialogue_messages_conversation_created_at_idx").on(
      table.characterId,
      table.npcActorId,
      table.createdAt
    )
  })
);

export const npcRelationships = pgTable(
  "npc_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    npcActorId: uuid("npc_actor_id").notNull().references(() => worldActors.id),
    familiarity: integer("familiarity").notNull().default(0),
    trust: integer("trust").notNull().default(0),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    shortSummary: text("short_summary").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterNpcIdx: uniqueIndex("npc_relationships_character_npc_idx").on(
      table.characterId,
      table.npcActorId
    )
  })
);

export const npcMemoryEntries = pgTable(
  "npc_memory_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    npcActorId: uuid("npc_actor_id").notNull().references(() => worldActors.id),
    characterId: uuid("character_id").references(() => characters.id),
    sourceType: text("source_type").notNull(),
    memoryKind: text("memory_kind").notNull(),
    evidenceLevel: text("evidence_level").notNull().default("dialogue_claim"),
    sourceIds: jsonb("source_ids").notNull().default([]),
    importance: integer("importance").notNull().default(1),
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    compressedAt: timestamp("compressed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    npcOccurredAtIdx: index("npc_memory_entries_npc_occurred_at_idx").on(
      table.npcActorId,
      table.occurredAt
    ),
    characterNpcIdx: index("npc_memory_entries_character_npc_idx").on(
      table.characterId,
      table.npcActorId
    ),
    compressionIdx: index("npc_memory_entries_compression_idx").on(
      table.npcActorId,
      table.compressedAt,
      table.occurredAt
    )
  })
);

export const npcMemoryFragments = pgTable(
  "npc_memory_fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    npcActorId: uuid("npc_actor_id").notNull().references(() => worldActors.id),
    characterId: uuid("character_id").references(() => characters.id),
    memoryKind: text("memory_kind").notNull(),
    evidenceLevel: text("evidence_level").notNull().default("dialogue_claim"),
    importance: integer("importance").notNull().default(1),
    summary: text("summary").notNull(),
    firstOccurredAt: timestamp("first_occurred_at", { withTimezone: true }).notNull(),
    lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true }).notNull(),
    sourceEntryIds: jsonb("source_entry_ids").notNull().default([]),
    compressionLevel: integer("compression_level").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    npcLastOccurredAtIdx: index("npc_memory_fragments_npc_last_occurred_at_idx").on(
      table.npcActorId,
      table.lastOccurredAt
    ),
    characterNpcIdx: index("npc_memory_fragments_character_npc_idx").on(
      table.characterId,
      table.npcActorId
    )
  })
);

export const npcTasks = pgTable(
  "npc_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    npcActorId: uuid("npc_actor_id").notNull().references(() => worldActors.id),
    needType: text("need_type").notNull(),
    status: text("status").notNull().default("open"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    proposalSource: text("proposal_source").notNull().default("template"),
    proposalReason: text("proposal_reason"),
    requestedItemId: text("requested_item_id").notNull(),
    requestedQuantity: integer("requested_quantity").notNull(),
    rewardCopper: integer("reward_copper").notNull(),
    escrowCopper: integer("escrow_copper").notNull(),
    acceptedByCharacterId: uuid("accepted_by_character_id").references(() => characters.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    npcStatusIdx: index("npc_tasks_npc_status_idx").on(table.npcActorId, table.status),
    characterStatusIdx: index("npc_tasks_character_status_idx").on(
      table.acceptedByCharacterId,
      table.status
    ),
    expiresAtIdx: index("npc_tasks_expires_at_idx").on(table.expiresAt),
    npcActiveUniqueIdx: uniqueIndex("npc_tasks_one_active_per_npc_idx")
      .on(table.npcActorId)
      .where(sql`${table.status} IN ('open', 'accepted')`)
  })
);

export const characterActions = pgTable(
  "character_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    actionType: characterActionType("action_type").notNull(),
    status: characterActionStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterStatusIdx: index("character_actions_character_status_idx").on(
      table.characterId,
      table.status
    ),
    endsAtIdx: index("character_actions_ends_at_idx").on(table.endsAt),
    activeUniqueIdx: uniqueIndex("character_actions_one_active_per_character_idx")
      .on(table.characterId)
      .where(sql`${table.status} = 'active'`)
  })
);

export const mapInstances = pgTable(
  "map_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    zoneId: gameLocation("zone_id").notNull(),
    resourceCharges: jsonb("resource_charges").notNull().default({}),
    encounterCooldowns: jsonb("encounter_cooldowns").notNull().default({}),
    resourcesRefreshedAt: timestamp("resources_refreshed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterZoneIdx: uniqueIndex("map_instances_character_zone_idx").on(
      table.characterId,
      table.zoneId
    ),
    resourceChargesCheck: check(
      "map_instances_resource_charges_nonnegative_check",
      sql`NOT (${table.resourceCharges} @? '$.** ? (@.type() == "number" && @ < 0)'::jsonpath)`
    )
  })
);

export const gameEvents = pgTable(
  "game_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterCreatedAtIdx: index("game_events_character_created_at_idx").on(
      table.characterId,
      table.createdAt
    )
  })
);

export const syncEvents = pgTable(
  "sync_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    audience: text("audience").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    characterId: uuid("character_id").references(() => characters.id),
    eventType: text("event_type").notNull(),
    stateDirty: boolean("state_dirty").notNull().default(false),
    payload: jsonb("payload").notNull().default({}),
    source: text("source").notNull().default("server"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    accountIdx: index("sync_events_account_id_idx").on(table.accountId, table.id),
    characterIdx: index("sync_events_character_id_idx").on(table.characterId, table.id),
    audienceCheck: check(
      "sync_events_audience_check",
      sql`${table.audience} IN ('account', 'character', 'public', 'admin')`
    )
  })
);
