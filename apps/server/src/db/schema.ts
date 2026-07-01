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
