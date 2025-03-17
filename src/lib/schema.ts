import { pgTable, uuid, varchar, timestamp, pgEnum, type AnyPgColumn, primaryKey, text } from "drizzle-orm/pg-core";

export const chatParticipantRoles = pgEnum("user_role", ["admin", "member"]);
export const messageStatus = pgEnum("message_status", ["sent", "delivered", "read", "deleted"]);

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
        leftAt: timestamp("left_at"),
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
    userId: uuid("user_id")
        .notNull()
        .references(() => users.userId, { onDelete: "set null" }),
    replyToMessageId: uuid("reply_to_message_id").references((): AnyPgColumn => messages.messageId, {
        onDelete: "set null",
    }),
    messageStatus: messageStatus("message_status"),
    textContent: text("text_content"),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
    editedAt: timestamp("edited_at"),
});

export const messageAttachments = pgTable("message_attachments", {
    attachmentId: uuid("attachment_id").primaryKey(),
    messageId: uuid("message_id").references(() => messages.messageId),
    filePath: varchar("file_path", { length: 255 }),
    fileType: varchar("file_type", { length: 50 }),
    fileName: varchar("file_name", { length: 255 }),
});
