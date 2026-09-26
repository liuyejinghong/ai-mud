import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
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
    lastReliefClaimedAt: timestamp("last_relief_claimed_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
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
      sql`${table.fromOwnerType} IS NULL OR ${table.fromOwnerType} IN ('character', 'npc', 'market', 'system', 'system_source')`
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
    worldEpoch: integer("world_epoch").notNull().default(1),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    leaseUntilIdx: index("world_runtime_state_lease_until_idx").on(table.leaseUntil)
  })
);

export const commandReceipts = pgTable(
  "command_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorScope: text("actor_scope").notNull(),
    commandKind: text("command_kind").notNull(),
    commandId: text("command_id").notNull(),
    worldEpoch: integer("world_epoch").notNull().default(1),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    scopeKindIdEpochUnique: uniqueIndex("command_receipts_scope_kind_id_epoch_unique").on(
      table.actorScope,
      table.commandKind,
      table.commandId,
      table.worldEpoch
    )
  })
)

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
    sourceUniqueIdx: uniqueIndex("world_rumors_source_unique")
      .on(table.sourceType, table.sourceId)
      .where(sql`${table.sourceId} IS NOT NULL`),
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

// ---------------------------------------------------------------------------
// 基地经营（v0.12，M12-P）：写归属见 docs/reviews/base-operations/contracts.md §6
// world=基地作用域/时钟/建设位/控制租约；assets=物料与设备资产；npc=作业者运行状态；
// industry=项目/步骤/站内供能。功率一律 W、电量一律 Wh 整数定点。
// ---------------------------------------------------------------------------

export const baseTimeMode = pgEnum("base_time_mode", ["paused", "running"]);

export const bases = pgTable(
  "bases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id)
      .unique(),
    name: text("name").notNull(),
    timeMode: baseTimeMode("time_mode").notNull().default("paused"),
    speed: integer("speed").notNull().default(1),
    simTime: timestamp("sim_time", { withTimezone: true }).notNull().defaultNow(),
    lastAdvancedAt: timestamp("last_advanced_at", { withTimezone: true }).notNull().defaultNow(),
    epoch: integer("epoch").notNull().default(1),
    baseRevision: integer("base_revision").notNull().default(1),
    contentRelease: text("content_release").notNull(),
    credits: integer("credits").notNull().default(1200),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    speedCheck: check("bases_speed_allowed_check", sql`${table.speed} IN (1, 2, 4)`),
    creditsCheck: check("bases_credits_nonnegative_check", sql`${table.credits} >= 0`),
    revisionCheck: check("bases_revision_positive_check", sql`${table.baseRevision} >= 1`)
  })
);

export const baseSites = pgTable(
  "base_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    siteKey: text("site_key").notNull(),
    state: text("state").notNull().default("free"),
    builtFacilityRef: text("built_facility_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseSiteKeyIdx: uniqueIndex("base_sites_base_site_key_idx").on(table.baseId, table.siteKey),
    stateCheck: check(
      "base_sites_state_check",
      sql`${table.state} IN ('free', 'reserved', 'built')`
    )
  })
);

export const baseControlLeases = pgTable("base_control_leases", {
  baseId: uuid("base_id")
    .primaryKey()
    .references(() => bases.id),
  leaseToken: text("lease_token").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const baseInventory = pgTable(
  "base_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseItemIdx: uniqueIndex("base_inventory_base_item_idx").on(table.baseId, table.itemId),
    quantityCheck: check("base_inventory_quantity_nonnegative_check", sql`${table.quantity} >= 0`),
    reservedCheck: check(
      "base_inventory_reserved_bounded_check",
      sql`${table.reservedQuantity} >= 0 AND ${table.reservedQuantity} <= ${table.quantity}`
    )
  })
);

export const baseDevices = pgTable(
  "base_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    deviceDefId: text("device_def_id").notNull(),
    templateRevision: integer("template_revision").notNull(),
    sourceOperation: text("source_operation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseIdx: index("base_devices_base_idx").on(table.baseId),
    sourceOperationIdx: uniqueIndex("base_devices_source_operation_idx").on(
      table.sourceOperation,
      table.deviceDefId
    )
  })
);

export const robotOperators = pgTable(
  "robot_operators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => baseDevices.id)
      .unique(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    groupId: text("group_id").notNull(),
    batteryWh: integer("battery_wh").notNull(),
    batteryCapacityWh: integer("battery_capacity_wh").notNull(),
    status: text("status").notNull().default("idle"),
    currentProjectId: uuid("current_project_id"),
    currentStepIndex: integer("current_step_index"),
    // R1 landing：当前勘探/采矿单（与 current_project_id 互斥，见下方 CHECK）。
    currentExtractionJobId: uuid("current_extraction_job_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseIdx: index("robot_operators_base_idx").on(table.baseId),
    groupIdx: index("robot_operators_group_idx").on(table.baseId, table.groupId),
    batteryCheck: check(
      "robot_operators_battery_bounded_check",
      sql`${table.batteryWh} >= 0 AND ${table.batteryWh} <= ${table.batteryCapacityWh}`
    ),
    groupCheck: check(
      "robot_operators_group_check",
      sql`${table.groupId} IN ('transport', 'engineering', 'survey')`
    ),
    statusCheck: check(
      "robot_operators_status_check",
      sql`${table.status} IN ('idle', 'charging', 'working', 'offline')`
    ),
    // 施工与采矿互斥：同一台设备不能同时挂项目工序与采矿单。
    assignmentExclusiveCheck: check(
      "robot_operators_assignment_exclusive_check",
      sql`(${table.currentProjectId} IS NULL) OR (${table.currentExtractionJobId} IS NULL)`
    )
  })
);

export const basePowerState = pgTable(
  "base_power_state",
  {
    baseId: uuid("base_id")
      .primaryKey()
      .references(() => bases.id),
    generationWPeak: integer("generation_w_peak").notNull(),
    storageWh: integer("storage_wh").notNull(),
    storageCapacityWh: integer("storage_capacity_wh").notNull(),
    lastLoadW: integer("last_load_w").notNull().default(0),
    // 积尘等级 0—100；保留每分钟的小数变化，避免按调用次数取整。
    dustLevel: doublePrecision("dust_level").notNull().default(30),
    // ---------- R1 landing（旧档缺省 = 旧行为：无临时电源、充电不受限、生产优先） ----------
    emergencyGenerationW: integer("emergency_generation_w").notNull().default(0),
    chargeLimitW: integer("charge_limit_w"),
    powerPolicy: text("power_policy").notNull().default("production"),
    // 站内能量固定点余数：storage_excess_wm ∈ [0,60) 为 W·min 余数
    // （storageWh + excess/60 = 精确存量，不因舍入丢能量）；gen_remainder_wm 承载
    // 发电端（光照/积尘系数）的小数 W·min 结转。
    storageExcessWm: integer("storage_excess_wm").notNull().default(0),
    genRemainderWm: doublePrecision("gen_remainder_wm").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    storageCheck: check(
      "base_power_storage_bounded_check",
      sql`${table.storageWh} >= 0 AND ${table.storageWh} <= ${table.storageCapacityWh}`
    ),
    storageExcessCheck: check(
      "base_power_storage_excess_bounded_check",
      sql`${table.storageExcessWm} >= 0 AND ${table.storageExcessWm} < 60`
    ),
    powerPolicyCheck: check(
      "base_power_policy_check",
      sql`${table.powerPolicy} IN ('production', 'charging')`
    )
  })
);

export const baseProjects = pgTable(
  "base_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => baseSites.id),
    projectDefId: text("project_def_id").notNull(),
    templateRevision: integer("template_revision").notNull(),
    status: text("status").notNull().default("active"),
    currentStepIndex: integer("current_step_index").notNull().default(0),
    reservedInputs: jsonb("reserved_inputs").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    baseIdx: index("base_projects_base_idx").on(table.baseId, table.status),
    siteActiveIdx: uniqueIndex("base_projects_one_active_per_site_idx")
      .on(table.siteId)
      .where(sql`${table.status} IN ('planned', 'active', 'paused', 'blocked', 'needs_decision')`),
    statusCheck: check(
      "base_projects_status_check",
      sql`${table.status} IN ('planned', 'active', 'paused', 'blocked', 'needs_decision', 'completed', 'cancelled', 'failed')`
    )
  })
);

export const baseProjectSteps = pgTable(
  "base_project_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => baseProjects.id),
    stepIndex: integer("step_index").notNull(),
    kind: text("kind").notNull(),
    groupId: text("group_id").notNull(),
    status: text("status").notNull().default("pending"),
    workRequired: integer("work_required").notNull(),
    workDone: integer("work_done").notNull().default(0),
    blockedReason: text("blocked_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectStepIdx: uniqueIndex("base_project_steps_project_index_idx").on(
      table.projectId,
      table.stepIndex
    ),
    kindCheck: check(
      "base_project_steps_kind_check",
      sql`${table.kind} IN ('site_clearing', 'transport', 'installation', 'commissioning')`
    ),
    groupCheck: check(
      "base_project_steps_group_check",
      sql`${table.groupId} IN ('transport', 'engineering', 'survey')`
    ),
    statusCheck: check(
      "base_project_steps_status_check",
      sql`${table.status} IN ('pending', 'ready', 'running', 'blocked', 'completed', 'failed')`
    ),
    workCheck: check(
      "base_project_steps_work_bounded_check",
      sql`${table.workDone} >= 0 AND ${table.workDone} <= ${table.workRequired}`
    )
  })
);

// ---------------------------------------------------------------------------
// 内容工坊与制造（v0.13，M13-P）：draft 可变 / release 不可变；
// 制造工单经 assets 预留、industry 结算，逐台 (jobId, ordinal) 原子产出。
// ---------------------------------------------------------------------------

export const contentDraftStatus = pgEnum("content_draft_status", ["draft", "published"]);

export const contentDrafts = pgTable(
  "content_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    stableId: text("stable_id").notNull(),
    revision: integer("revision").notNull(),
    payload: jsonb("payload").notNull(),
    status: contentDraftStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    kindStableIdx: uniqueIndex("content_drafts_kind_stable_rev_idx").on(
      table.kind,
      table.stableId,
      table.revision
    ),
    kindCheck: check(
      "content_drafts_kind_check",
      sql`${table.kind} IN ('robot_template', 'project', 'recipe')`
    ),
    revisionCheck: check("content_drafts_revision_positive_check", sql`${table.revision} >= 1`)
  })
);

export const contentReleases = pgTable(
  "content_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    releaseId: text("release_id").notNull().unique(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    definitionCount: integer("definition_count").notNull(),
    publishedBy: uuid("published_by").references(() => accounts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    createdAtIdx: index("content_releases_created_at_idx").on(table.createdAt)
  })
);

export const baseManufacturingJobs = pgTable(
  "base_manufacturing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    recipeDefId: text("recipe_def_id").notNull(),
    recipeRevision: integer("recipe_revision").notNull(),
    status: text("status").notNull().default("active"),
    outputsPlanned: integer("outputs_planned").notNull(),
    outputsDone: integer("outputs_done").notNull().default(0),
    // 结算按 tick 累加小数工作量（≈0.08/tick），整数列会令整个基地结算崩溃（评审 B002）
    currentUnitWorkDone: doublePrecision("current_unit_work_done").notNull().default(0),
    reservedInputs: jsonb("reserved_inputs").notNull().default([]),
    blockedReason: text("blocked_reason"),
    // ---------- R1 landing（旧单全部 NULL：继续走旧结算语义） ----------
    // 新单指向已建成加工间站点（手工配方 = 着陆器站点）。
    productionSiteId: uuid("production_site_id"),
    // 每批能量（W·min，开工时按配方额定冻结）；旧单 NULL。
    energyWmPerBatch: integer("energy_wm_per_batch"),
    // 当前批已获能量（W·min 定点，整批原子完成）。
    currentBatchEnergyWm: integer("current_batch_energy_wm").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    baseIdx: index("base_manufacturing_jobs_base_idx").on(table.baseId, table.status),
    statusCheck: check(
      "base_manufacturing_jobs_status_check",
      sql`${table.status} IN ('active', 'paused', 'blocked', 'completed', 'cancelled')`
    ),
    plannedCheck: check(
      "base_manufacturing_jobs_planned_bounded_check",
      sql`${table.outputsPlanned} >= 1 AND ${table.outputsPlanned} <= 20`
    ),
    doneCheck: check(
      "base_manufacturing_jobs_outputs_bounded_check",
      sql`${table.outputsDone} >= 0 AND ${table.outputsDone} <= ${table.outputsPlanned}`
    ),
    batchEnergyCheck: check(
      "base_manufacturing_jobs_batch_energy_check",
      sql`(${table.energyWmPerBatch} IS NULL AND ${table.currentBatchEnergyWm} = 0) OR (${table.energyWmPerBatch} IS NOT NULL AND ${table.currentBatchEnergyWm} >= 0 AND ${table.currentBatchEnergyWm} <= ${table.energyWmPerBatch})`
    )
  })
);

export const baseManufacturingOutputs = pgTable(
  "base_manufacturing_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => baseManufacturingJobs.id),
    ordinal: integer("ordinal").notNull(),
    // R1：robot（旧默认）或 item（材料产出）。
    outputKind: text("output_kind").notNull().default("robot"),
    deviceId: uuid("device_id").references(() => baseDevices.id),
    operatorId: uuid("operator_id").references(() => robotOperators.id),
    itemId: text("item_id"),
    quantity: integer("quantity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    jobOrdinalIdx: uniqueIndex("base_manufacturing_outputs_job_ordinal_idx").on(
      table.jobId,
      table.ordinal
    ),
    outputKindCheck: check(
      "base_manufacturing_outputs_kind_check",
      sql`(${table.outputKind} = 'robot' AND ${table.deviceId} IS NOT NULL AND ${table.operatorId} IS NOT NULL AND ${table.itemId} IS NULL AND ${table.quantity} IS NULL) OR (${table.outputKind} = 'item' AND ${table.deviceId} IS NULL AND ${table.operatorId} IS NULL AND ${table.itemId} IS NOT NULL AND ${table.quantity} IS NOT NULL)`
    )
  })
);

// ---------------------------------------------------------------------------
// R1 landing（2026-09-26）：资源节点（world 写者）、勘探/采矿单与现场货物
// （industry 写者）、加工槽（industry 写者，设施完成同事务创建）。
// ---------------------------------------------------------------------------

export const baseResourceNodes = pgTable(
  "base_resource_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    nodeKey: text("node_key").notNull(),
    name: text("name").notNull(),
    itemId: text("item_id").notNull(),
    discovered: boolean("discovered").notNull().default(false),
    remainingQuantity: integer("remaining_quantity").notNull(),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseNodeIdx: uniqueIndex("base_resource_nodes_base_node_idx").on(table.baseId, table.nodeKey),
    quantityCheck: check(
      "base_resource_nodes_quantity_bounded_check",
      sql`${table.remainingQuantity} >= 0 AND ${table.reservedQuantity} >= 0 AND ${table.reservedQuantity} <= ${table.remainingQuantity}`
    )
  })
);

export const baseExtractionJobs = pgTable(
  "base_extraction_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => baseResourceNodes.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("active"),
    batchesPlanned: integer("batches_planned").notNull().default(1),
    batchesExtracted: integer("batches_extracted").notNull().default(0),
    batchesDelivered: integer("batches_delivered").notNull().default(0),
    // mine：当前工序（mining 用筑垒点 / hauling 用驮运点）；survey 无 phase。
    phase: text("phase"),
    phaseWorkDone: integer("phase_work_done").notNull().default(0),
    builderOperatorIds: jsonb("builder_operator_ids").$type<string[]>().notNull().default([]),
    haulerOperatorId: uuid("hauler_operator_id"),
    surveyorOperatorId: uuid("surveyor_operator_id"),
    blockedReason: text("blocked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseStatusIdx: index("base_extraction_jobs_base_status_idx").on(table.baseId, table.status),
    nodeActiveIdx: uniqueIndex("base_extraction_jobs_one_active_per_node_idx")
      .on(table.nodeId)
      .where(sql`${table.status} IN ('active', 'paused', 'stopping')`),
    kindCheck: check(
      "base_extraction_jobs_kind_check",
      sql`${table.kind} IN ('survey', 'mine')`
    ),
    statusCheck: check(
      "base_extraction_jobs_status_check",
      sql`${table.status} IN ('active', 'paused', 'stopping', 'completed', 'cancelled')`
    ),
    phaseCheck: check(
      "base_extraction_jobs_phase_check",
      sql`(${table.kind} = 'survey' AND ${table.phase} IS NULL) OR (${table.kind} = 'mine' AND ${table.phase} IN ('mining', 'hauling'))`
    ),
    batchesCheck: check(
      "base_extraction_jobs_batches_bounded_check",
      sql`${table.batchesPlanned} >= 1 AND ${table.batchesPlanned} <= 10 AND ${table.batchesExtracted} >= 0 AND ${table.batchesExtracted} <= ${table.batchesPlanned} AND ${table.batchesDelivered} >= 0 AND ${table.batchesDelivered} <= ${table.batchesExtracted}`
    ),
    operatorShapeCheck: check(
      "base_extraction_jobs_operator_shape_check",
      sql`(${table.kind} = 'survey' AND ${table.surveyorOperatorId} IS NOT NULL AND ${table.haulerOperatorId} IS NULL) OR (${table.kind} = 'mine' AND ${table.surveyorOperatorId} IS NULL AND ${table.haulerOperatorId} IS NOT NULL AND jsonb_array_length(${table.builderOperatorIds}) BETWEEN 1 AND 2)`
    )
  })
);

export const baseExtractionOutputs = pgTable(
  "base_extraction_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => baseExtractionJobs.id),
    ordinal: integer("ordinal").notNull(),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    // extracted = 已采出、运输中（现场货物，不算仓库库存）；delivered = 已送达入库。
    status: text("status").notNull().default("extracted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    jobOrdinalIdx: uniqueIndex("base_extraction_outputs_job_ordinal_idx").on(
      table.jobId,
      table.ordinal
    ),
    statusCheck: check(
      "base_extraction_outputs_status_check",
      sql`${table.status} IN ('extracted', 'delivered')`
    ),
    quantityCheck: check(
      "base_extraction_outputs_quantity_positive_check",
      sql`${table.quantity} > 0`
    )
  })
);

export const baseProductionSlots = pgTable(
  "base_production_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => baseSites.id),
    slotIndex: integer("slot_index").notNull().default(0),
    batchesSinceMaintenance: integer("batches_since_maintenance").notNull().default(0),
    maintenanceBlocked: boolean("maintenance_blocked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseSiteSlotIdx: uniqueIndex("base_production_slots_base_site_slot_idx").on(
      table.baseId,
      table.siteId,
      table.slotIndex
    ),
    batchesCheck: check(
      "base_production_slots_batches_bounded_check",
      sql`${table.batchesSinceMaintenance} >= 0 AND ${table.batchesSinceMaintenance} <= 10`
    )
  })
);

// ---------------------------------------------------------------------------
// Jev 协作与决策审计（v0.14，M14-P）：决策记录只审计不授权；协作请求是
// industry 的真实调度事实（跨组支援），RULE 模式下由规则决策。
// ---------------------------------------------------------------------------

export const decisionRecords = pgTable(
  "decision_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: text("decision_id").notNull().unique(),
    purpose: text("purpose").notNull(),
    mode: text("mode").notNull(),
    provider: text("provider").notNull(),
    baseId: uuid("base_id").references(() => bases.id),
    planRevision: integer("plan_revision").notNull(),
    question: text("question").notNull(),
    candidates: jsonb("candidates").notNull().default([]),
    selectedCandidateId: text("selected_candidate_id"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    purposeIdx: index("decision_records_purpose_idx").on(table.purpose, table.createdAt),
    modeCheck: check(
      "decision_records_mode_check",
      sql`${table.mode} IN ('rule', 'shadow', 'live')`
    ),
    purposeCheck: check(
      "decision_records_purpose_check",
      sql`${table.purpose} IN ('transport_assistance', 'work_assignment')`
    )
  })
);

export const cooperationRequests = pgTable(
  "cooperation_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => baseProjects.id),
    stepIndex: integer("step_index").notNull(),
    fromGroupId: text("from_group_id").notNull(),
    helperGroupId: text("helper_group_id").notNull(),
    status: text("status").notNull().default("pending"),
    helperOperatorId: uuid("helper_operator_id"),
    decisionId: text("decision_id"),
    resolutionReason: text("resolution_reason"),
    question: text("question").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (table) => ({
    baseStatusIdx: index("cooperation_requests_base_status_idx").on(table.baseId, table.status),
    baseProjectIdx: index("cooperation_requests_base_project_idx").on(table.baseId),
    statusCheck: check(
      "cooperation_requests_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'expired', 'fulfilled')`
    ),
    resolutionReasonCheck: check(
      "cooperation_requests_resolution_reason_check",
      sql`${table.resolutionReason} IS NULL OR (${table.status} = 'expired' AND ${table.resolutionReason} IN ('ttl_expired', 'project_cancelled', 'project_failed', 'step_failed', 'content_missing', 'no_longer_needed'))`
    )
  })
);

// 天气日程（M15-P）：确定性循环序列，provision 时生成；结算按 simTime 查当前段。
export const weatherSchedule = pgTable(
  "base_weather_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    seq: integer("seq").notNull(),
    weather: text("weather").notNull(),
    startSim: timestamp("start_sim", { withTimezone: true }).notNull(),
    endSim: timestamp("end_sim", { withTimezone: true }).notNull()
  },
  (table) => ({
    baseStartIdx: uniqueIndex("base_weather_schedule_base_start_idx").on(
      table.baseId,
      table.startSim
    ),
    weatherCheck: check(
      "base_weather_schedule_weather_check",
      sql`${table.weather} IN ('clear', 'warning', 'storm')`
    )
  })
);

// 订单经济（v0.16，M16-P）：账款唯一余额在 bases.credits（economy 写者）；
// 订单 open→accepted→delivered/failed；采购付款≠到货（in_transit→delivered）。
export const baseOrders = pgTable(
  "base_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    orderDefId: text("order_def_id").notNull(),
    orderRevision: integer("order_revision").notNull(),
    status: text("status").notNull().default("open"),
    requiredItemId: text("required_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    rewardCredits: integer("reward_credits").notNull(),
    deadlineSim: timestamp("deadline_sim", { withTimezone: true }),
    acceptedAtSim: timestamp("accepted_at_sim", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (table) => ({
    baseStatusIdx: index("base_orders_base_status_idx").on(table.baseId, table.status),
    statusCheck: check(
      "base_orders_status_check",
      sql`${table.status} IN ('open', 'accepted', 'delivered', 'failed')`
    ),
    quantityCheck: check("base_orders_quantity_positive_check", sql`${table.quantity} > 0`)
  })
);

export const basePurchases = pgTable(
  "base_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id),
    itemId: text("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    costCredits: integer("cost_credits").notNull(),
    status: text("status").notNull().default("in_transit"),
    arrivesAtSim: timestamp("arrives_at_sim", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    baseStatusIdx: index("base_purchases_base_status_idx").on(table.baseId, table.status),
    statusCheck: check(
      "base_purchases_status_check",
      sql`${table.status} IN ('in_transit', 'delivered')`
    ),
    quantityCheck: check("base_purchases_quantity_positive_check", sql`${table.quantity} > 0`),
    costCheck: check("base_purchases_cost_nonnegative_check", sql`${table.costCredits} >= 0`)
  })
);
