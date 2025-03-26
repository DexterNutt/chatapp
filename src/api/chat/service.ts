import { eq, and, inArray, sql, gt, desc } from "drizzle-orm";
import { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import { chats, chatParticipants, messages, messageAttachments, chatParticipantRoles } from "../../lib/schema";
import {
    sendMessageSchema,
    type Chat,
    type CreateChat,
    type Message,
    type SendMessage,
    type MessageAttachment,
    type FetchChatParticipantsRequest,
    type FetchChatParticipantsResponse,
    type FetchMessagesResponse,
    type FetchChatsResponse,
    type FetchMessagesRequest,
    type FetchChatsRequest,
    type ChatParticipant,
    messageAttachmentSchema,
    type UploadAttachmentRequest,
    type FetchChatDetailsRequest,
} from "./model";
import { type AuthContext } from "../auth/service";
import { AppError } from "../../lib/error";
import { clients } from "./router";
import { minioClient, BUCKET_NAME } from "../../lib/minio";
import * as crypto from "crypto";
import * as path from "path";

export class ChatService {
    static async createChat(db: NodePgDatabase, chat: CreateChat): Promise<Chat> {
        const now = new Date();
        const participantIds = Array.from(new Set([chat.creatorId, ...chat.participants]));

        if (participantIds.length < 2) {
            throw new AppError("BAD_REQUEST", "Chat must have at least 2 participants.");
        }

        const existingChat = await this.findExistingChat(db, participantIds);
        if (existingChat) {
            throw new AppError("BAD_REQUEST", `Chat already exists: ${existingChat.chatId}`);
        }

        return await db.transaction(async (tx) => {
            const [newChat] = await tx
                .insert(chats)
                .values({
                    creatorId: chat.creatorId,
                    name: chat.name ?? null,
                    createdAt: now,
                    lastActivity: now,
                })
                .returning();

            const chatId = newChat.chatId;
            const participantRecords = participantIds.map((userId) => ({
                chatId,
                userId,
                roles:
                    userId === chat.creatorId
                        ? [chatParticipantRoles.enumValues[0]]
                        : [chatParticipantRoles.enumValues[1]],
                joinedAt: now,
            }));

            await tx.insert(chatParticipants).values(participantRecords);

            return {
                chatId,
                createdAt: now,
                creatorId: chat.creatorId,
                lastActivity: now,
                name: chat.name,
                messages: [],
                participants: participantIds,
            };
        });
    }

    static async sendMessage(db: NodePgDatabase, message: SendMessage): Promise<Message> {
        const now = new Date();
        const { chatId, senderId, textContent, attachments } = message;

        const participantCheck = await db
            .select({ userId: chatParticipants.userId })
            .from(chatParticipants)
            .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.userId, senderId)));

        if (participantCheck.length === 0) {
            throw new AppError("FORBIDDEN", "User is not a participant in this chat.");
        }

        return await db.transaction(async (tx) => {
            const [message] = await tx
                .insert(messages)
                .values({
                    chatId,
                    senderId,
                    textContent: textContent ?? "",
                    createdAt: now,
                })
                .returning();

            await tx.update(chats).set({ lastActivity: now }).where(eq(chats.chatId, chatId));

            await tx
                .update(chatParticipants)
                .set({ lastActivity: now })
                .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.userId, senderId)));

            const attachmentsToUpload = (attachments ?? []).map((attachment) => ({
                data: attachment.data,
                fileName: attachment.filename,
                mimeType: attachment.contentType,
                messageId: message.messageId,
            }));

            const messageAttachmentRecords = await this.handleAttachments(tx, attachmentsToUpload);

            const mappedMessage: Message = {
                messageId: message.messageId,
                chatId: message.chatId,
                senderId: message.senderId,
                textContent: message.textContent ?? "",
                createdAt: message.createdAt,
                attachments: messageAttachmentRecords,
            };

            await this.broadcastToParticipants(db, message.chatId, {
                event: "new_message",
                data: mappedMessage,
            });

            return mappedMessage;
        });
    }

    private static async handleAttachments(
        tx: NodePgTransaction<any, any>,
        attachments: UploadAttachmentRequest[]
    ): Promise<MessageAttachment[]> {
        const now = new Date();

        if (!attachments || attachments.length === 0) {
            return [];
        }

        const messageId = attachments[0]?.messageId;
        if (!messageId) {
            throw new AppError("BAD_REQUEST", "Message ID is required for attachments.");
        }

        return Promise.all(
            attachments.map(async (attachment) => {
                const uploadedAttachment = await this.uploadAttachment({ ...attachment });

                const [attachmentRecord] = await tx
                    .insert(messageAttachments)
                    .values({
                        messageId,
                        fileName: uploadedAttachment.fileName,
                        fileSize: uploadedAttachment.fileSize,
                        mimeType: uploadedAttachment.mimeType,
                        storagePath: uploadedAttachment.storagePath,
                        uploadedAt: now,
                    })
                    .returning();

                return messageAttachmentSchema.parse({
                    ...attachmentRecord,
                    url: uploadedAttachment.url,
                });
            })
        );
    }

    static async uploadAttachment(attachment: UploadAttachmentRequest): Promise<MessageAttachment> {
        const now = new Date();
        const { fileName, mimeType, messageId, data } = attachment;

        if (!messageId) {
            throw new AppError("BAD_REQUEST", "Message ID is required for attachment.");
        }

        const fileExtension = path.extname(fileName) || ".bin";
        const uniqueFilename = `${crypto.randomBytes(8).toString("hex")}-${Date.now()}${fileExtension}`;
        const storagePath = `${messageId}/${uniqueFilename}`;

        const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
        const dataPart = data.includes(",") ? data.split(",")[1] : data;

        if (!base64Pattern.test(dataPart)) {
            throw new AppError("BAD_REQUEST", "Invalid Base64 data format.");
        }

        const buffer = Buffer.from(dataPart, "base64");
        const fileSize = buffer.length;

        if (fileSize === 0) {
            throw new AppError("BAD_REQUEST", "Empty file data.");
        }

        try {
            await minioClient.putObject(BUCKET_NAME, storagePath, buffer, buffer.length, { "Content-Type": mimeType });
        } catch (error) {
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to upload file to storage.");
        }

        const url = await this.getAttachmentUrl(storagePath);

        return {
            attachmentId: crypto.randomUUID(),
            messageId,
            fileName,
            fileSize,
            mimeType,
            storagePath,
            url,
            uploadedAt: now,
        };
    }

    static async getAttachmentUrl(storagePath: MessageAttachment["storagePath"]): Promise<MessageAttachment["url"]> {
        const url = await minioClient.presignedGetObject(BUCKET_NAME, storagePath, 24 * 60 * 60);
        return url;
    }

    static async fetchMessageAttachments(
        db: NodePgDatabase,
        request: Pick<MessageAttachment, "messageId">
    ): Promise<MessageAttachment[]> {
        const messageId = request.messageId;

        const attachmentRecords = await db
            .select()
            .from(messageAttachments)
            .where(eq(messageAttachments.messageId, messageId));

        return Promise.all(
            attachmentRecords.map(async (record) => ({
                attachmentId: record.attachmentId,
                messageId: record.messageId,
                fileName: record.fileName,
                fileSize: record.fileSize,
                mimeType: record.mimeType,
                storagePath: record.storagePath,
                url: await this.getAttachmentUrl(record.storagePath),
                uploadedAt: record.uploadedAt,
            }))
        );
    }

    private static async findExistingChat(
        db: NodePgDatabase,
        participantIds: Chat["participants"]
    ): Promise<Chat | null> {
        const potentialChats = await db
            .select({
                chatId: chatParticipants.chatId,
                userIds: sql<string[]>`ARRAY_AGG(${chatParticipants.userId} ORDER BY ${chatParticipants.userId})`,
            })
            .from(chatParticipants)
            .where(inArray(chatParticipants.userId, participantIds))
            .groupBy(chatParticipants.chatId)
            .having(sql`count(${chatParticipants.userId}) = ${participantIds.length}`);

        if (potentialChats.length > 0) {
            const chatParticipantIds = new Set(potentialChats[0].userIds);
            const inputParticipantIds = new Set(participantIds);

            if (
                chatParticipantIds.size === inputParticipantIds.size &&
                [...chatParticipantIds].every((id) => inputParticipantIds.has(id))
            ) {
                return await this.fetchChatDetails(db, {
                    chatId: potentialChats[0].chatId,
                    userId: participantIds[0],
                });
            }
        }

        return null;
    }

    private static async fetchChatDetails(db: NodePgDatabase, request: FetchChatDetailsRequest): Promise<Chat | null> {
        const { chatId, userId } = request;

        const result = await db
            .select({
                chatId: chats.chatId,
                createdAt: chats.createdAt,
                creatorId: chats.creatorId,
                lastActivity: chats.lastActivity,
                name: chats.name,
            })
            .from(chats)
            .where(eq(chats.chatId, chatId))
            .limit(1);

        if (result.length === 0) return null;

        const chat = result[0];

        const fetchedMessages = await this.fetchMessages(db, { chatId, userId }).then((res) => res.messages);
        const participantIds = await this.fetchParticipants(db, chat.chatId);

        return {
            chatId: chat.chatId,
            createdAt: chat.createdAt,
            creatorId: chat.creatorId,
            lastActivity: chat.lastActivity,
            name: chat.name,
            messages: fetchedMessages,
            participants: participantIds,
        };
    }

    private static async fetchParticipants(
        db: NodePgDatabase,
        chatId: Chat["chatId"]
    ): Promise<ChatParticipant["participantId"][]> {
        const participants = await db
            .select({ userId: chatParticipants.userId })
            .from(chatParticipants)
            .where(eq(chatParticipants.chatId, chatId));
        return participants.map((p) => p.userId);
    }

    static async fetchMessages(
        db: NodePgDatabase,
        request: FetchMessagesRequest,
        fetchUnread: boolean = false,
        fetchPreview: boolean = false
    ): Promise<FetchMessagesResponse> {
        const { chatId, userId } = request;

        let messageRows;

        switch (true) {
            case fetchUnread: {
                const lastActivityRecord = await db
                    .select({ lastActivity: chatParticipants.lastActivity })
                    .from(chatParticipants)
                    .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.userId, userId)))
                    .limit(1)
                    .then((rows) => rows[0]);

                const lastActivityTimestamp = lastActivityRecord?.lastActivity ?? null;

                if (!lastActivityTimestamp) {
                    return { messages: [] };
                }

                messageRows = await db
                    .select({
                        messageId: messages.messageId,
                        chatId: messages.chatId,
                        senderId: messages.senderId,
                        textContent: messages.textContent,
                        createdAt: messages.createdAt,
                    })
                    .from(messages)
                    .where(and(eq(messages.chatId, chatId), gt(messages.createdAt, lastActivityTimestamp)));
                break;
            }
            case fetchPreview: {
                messageRows = await db
                    .select({
                        messageId: messages.messageId,
                        chatId: messages.chatId,
                        senderId: messages.senderId,
                        textContent: messages.textContent,
                        createdAt: messages.createdAt,
                    })
                    .from(messages)
                    .where(eq(messages.chatId, chatId))
                    .orderBy(desc(messages.createdAt))
                    .limit(1);
                break;
            }
            default: {
                messageRows = await db
                    .select({
                        messageId: messages.messageId,
                        chatId: messages.chatId,
                        senderId: messages.senderId,
                        textContent: messages.textContent,
                        createdAt: messages.createdAt,
                    })
                    .from(messages)
                    .where(eq(messages.chatId, chatId));
                break;
            }
        }

        const chatMessages = await Promise.all(
            messageRows.map(async (row) => {
                const textContent = row.textContent ?? "";
                const attachments = await this.fetchMessageAttachments(db, { messageId: row.messageId });
                return {
                    ...row,
                    textContent,
                    attachments,
                };
            })
        );

        return {
            messages: chatMessages,
        };
    }

    static async fetchChats(db: NodePgDatabase, request: FetchChatsRequest): Promise<FetchChatsResponse> {
        const { userId } = request;

        const chatRows = await db
            .select({
                chatId: chats.chatId,
                createdAt: chats.createdAt,
                creatorId: chats.creatorId,
                lastActivity: chats.lastActivity,
                name: chats.name,
            })
            .from(chats)
            .innerJoin(chatParticipants, eq(chats.chatId, chatParticipants.chatId))
            .where(eq(chatParticipants.userId, userId));

        const chatDetails = await Promise.all(
            chatRows.map(async (chatRow) => {
                const [fetchedMessages, participantIds] = await Promise.all([
                    this.fetchMessages(db, { chatId: chatRow.chatId, userId }).then((res) => res.messages),
                    this.fetchParticipants(db, chatRow.chatId),
                ]);

                return {
                    ...chatRow,
                    messages: fetchedMessages,
                    participants: participantIds,
                };
            })
        );

        return {
            chats: chatDetails,
        };
    }

    static async fetchChatParticipants(
        db: NodePgDatabase,
        request: FetchChatParticipantsRequest
    ): Promise<FetchChatParticipantsResponse> {
        const { chatId } = request;
        const participants = await db.select().from(chatParticipants).where(eq(chatParticipants.chatId, chatId));

        return {
            participants: participants.map((p) => ({
                participantId: p.userId,
                chatId: p.chatId,
                joinedAt: p.joinedAt,
                role: p.roles[0],
            })),
        };
    }

    static async handleWebSocketMessage(db: NodePgDatabase, authContext: AuthContext, message: SendMessage) {
        const validatedData = sendMessageSchema.parse({
            chatId: message.chatId,
            senderId: authContext.user.id,
            textContent: message.textContent,
            attachments: message.attachments || [],
        });

        await this.sendMessage(db, validatedData);
    }

    private static async broadcastToParticipants(db: NodePgDatabase, chatId: Chat["chatId"], payload: any) {
        const participants = await this.fetchChatParticipants(db, { chatId });
        this.notifyParticipants(
            participants.participants.map((p) => p.participantId),
            payload
        );
    }

    private static notifyParticipants(participantIds: Chat["participants"], payload: any) {
        const payloadString = JSON.stringify(payload);
        participantIds.forEach((userId) => {
            const client = clients.get(userId);
            if (client && client.readyState === 1) {
                client.send(payloadString);
            }
        });
    }
}
