import { pgTable, primaryKey, uuid, varchar, timestamp, pgEnum, text, integer } from "drizzle-orm/pg-core";

export const chatParticipantRoles = pgEnum("user_role", ["admin", "member"]);

export const users = pgTable("users", {
    userId: uuid("user_id").primaryKey().defaultRandom(),
    email: text("email").unique().notNull(),
    username: text("username"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const passwordCredentialTable = pgTable("password_credentials", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .unique()
        .references(() => users.userId, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessionTable = pgTable("sessions", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.userId, { onDelete: "cascade" }),
    passwordCredentialId: uuid("password_credential_id").references(() => passwordCredentialTable.id, {
        onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at").notNull(),
});

export const chats = pgTable("chats", {
    chatId: uuid("chat_id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id").references(() => users.userId),
    name: varchar("name", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    lastActivity: timestamp("last_activity").defaultNow(),
});

export const chatParticipants = pgTable(
    "chat_participants",
    {
        chatId: uuid("chat_id")
            .notNull()
            .references(() => chats.chatId, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        roles: chatParticipantRoles("roles").array().notNull(),
        joinedAt: timestamp("joined_at").notNull().defaultNow(),
        lastActivity: timestamp("last_activity").defaultNow().notNull(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.chatId, t.userId] }),
    })
);

export const messages = pgTable("messages", {
    messageId: uuid("message_id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chat_id")
        .notNull()
        .references(() => chats.chatId, { onDelete: "cascade" }),
    senderId: uuid("user_id")
        .notNull()
        .references(() => users.userId, { onDelete: "set null" }),
    textContent: text("text_content"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageAttachments = pgTable("message_attachments", {
    attachmentId: uuid("attachment_id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
        .references(() => messages.messageId)
        .notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    storagePath: text("storage_path").notNull(),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});
