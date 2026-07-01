import {
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
export const gameLocation = pgEnum("game_location", ["blackpine_outpost", "corrupt_forest"]);
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
    accountIdx: index("characters_account_id_idx").on(table.accountId)
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
    )
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
    )
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
    npcKeyIdx: index("world_actors_npc_key_idx").on(table.npcKey)
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
    actorItemIdx: uniqueIndex("npc_items_actor_item_idx").on(table.actorId, table.itemId)
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    resourceIdx: uniqueIndex("world_resource_nodes_resource_idx").on(table.zoneId, table.resourceId)
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
    settlementIdx: index("municipal_treasury_settlement_idx").on(table.settlementId)
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
    endsAtIdx: index("character_actions_ends_at_idx").on(table.endsAt)
  })
);

export const mapInstances = pgTable(
  "map_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id").notNull().references(() => characters.id),
    zoneId: gameLocation("zone_id").notNull(),
    resourceCharges: jsonb("resource_charges").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    characterZoneIdx: uniqueIndex("map_instances_character_zone_idx").on(
      table.characterId,
      table.zoneId
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
