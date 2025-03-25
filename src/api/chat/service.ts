import { eq, and, inArray, count, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chats, chatParticipants, messages, messageAttachments, chatParticipantRoles } from "../../lib/schema";
import {
    sendMessageSchema,
    type Chat,
    type CreateChat,
    type Message,
    type sendMessage,
    type MessageAttachment,
} from "./model";
import { type AuthContext } from "../auth/service";
import { AppError } from "../../lib/error";
import { clients } from "./router";
import { minioClient, BUCKET_NAME } from "../../lib/minio";
import * as crypto from "crypto";
import * as path from "path";

interface MessageData {
    chatId: string;
    content: string;
    replyToMessageId?: string;
    attachments?: Array<{
        filename: string;
        contentType: string;
        data: string;
    }>;
}

export class ChatService {
    static async createChat(db: NodePgDatabase, request: CreateChat): Promise<Chat> {
        const now = new Date();

        const participantIds = [...new Set([request.creatorId, ...request.participantIds])];
        const participantCount = participantIds.length;

        if (participantCount < 2) {
            throw new AppError("BAD_REQUEST", "Chat must have at least 2 participants.");
        }

        try {
            const existingChat = await this.findExistingChat(db, participantIds);
            if (existingChat) {
                throw new AppError("BAD_REQUEST", `Chat already exists.${existingChat.chatId}`);
            }

            return await this.createNewChat(db, request, participantIds, now);
        } catch (error) {
            console.error("Error in createChat:", error);
            throw new AppError("BAD_REQUEST", "Failed to create chat.");
        }
    }

    private static async findExistingChat(db: NodePgDatabase, participantIds: string[]): Promise<Chat | null> {
        try {
            const participantCount = participantIds.length;

            const potentialChats = await db
                .select({ chatId: chatParticipants.chatId })
                .from(chatParticipants)
                .where(inArray(chatParticipants.userId, participantIds))
                .groupBy(chatParticipants.chatId)
                .having(sql`count(${chatParticipants.userId}) = ${participantCount}`);

            for (const { chatId } of potentialChats) {
                const participants = await db
                    .select({
                        userId: chatParticipants.userId,
                    })
                    .from(chatParticipants)
                    .where(eq(chatParticipants.chatId, chatId));

                const chatParticipantIds = participants.map((p) => p.userId);

                if (
                    chatParticipantIds.length === participantIds.length &&
                    chatParticipantIds.every((id) => participantIds.includes(id))
                ) {
                    return await this.fetchChatDetails(db, chatId);
                }
            }

            return null;
        } catch (error) {
            console.error("Error finding existing chat:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to find existing chat.");
        }
    }

    private static async fetchChatDetails(db: NodePgDatabase, chatId: string): Promise<Chat | null> {
        try {
            const result = await db
                .select({
                    chat: chats,
                })
                .from(chats)
                .where(eq(chats.chatId, chatId))
                .limit(1);

            if (result.length === 0 || !result[0].chat) return null;

            const chat = result[0].chat;

            if (!chat) return null;

            const fetchedMessages = await this.getMessages(db, chat.chatId);
            const participantIds = await this.getParticipants(db, chat.chatId);

            return {
                chatId: chat.chatId,
                creatorId: chat.creatorId,
                name: chat.name,
                createdAt: chat.createdAt,
                lastActivity: chat.lastActivity,
                messages: fetchedMessages,
                participants: participantIds,
            };
        } catch (error) {
            console.error("Error fetching chat details:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to fetch chat details.");
        }
    }

    private static async getParticipants(db: NodePgDatabase, chatId: string): Promise<string[]> {
        try {
            const participants = await db
                .select({ userId: chatParticipants.userId })
                .from(chatParticipants)
                .where(eq(chatParticipants.chatId, chatId));
            return participants.map((p) => p.userId);
        } catch (error) {
            console.error("Error fetching participants:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to fetch participants.");
        }
    }

    private static async createNewChat(
        db: NodePgDatabase,
        request: CreateChat,
        participantIds: string[],
        now: Date
    ): Promise<Chat> {
        try {
            return await db.transaction(async (tx) => {
                const [newChat] = await tx
                    .insert(chats)
                    .values({
                        creatorId: request.creatorId,
                        name: request.name ?? null,
                        createdAt: now,
                        lastActivity: now,
                    })
                    .returning();

                const chatId = newChat.chatId;

                const participantRecords = participantIds.map((userId) => ({
                    chatId,
                    userId,
                    roles:
                        userId === request.creatorId
                            ? [chatParticipantRoles.enumValues[0]]
                            : [chatParticipantRoles.enumValues[1]],
                    joinedAt: now,
                }));

                await tx.insert(chatParticipants).values(participantRecords);

                const chatCreatedEvent = {
                    event: "chat_created",
                    data: {
                        chatId,
                        creatorId: request.creatorId,
                        name: request.name,
                        participants: participantIds,
                        createdAt: now,
                    },
                };

                this.notifyParticipants(participantIds, chatCreatedEvent);

                return {
                    chatId,
                    creatorId: request.creatorId,
                    name: request.name,
                    createdAt: now,
                    lastActivity: now,
                    messages: [],
                    participants: participantIds,
                };
            });
        } catch (error) {
            console.error("Error creating new chat:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to create new chat.");
        }
    }

    static async sendMessage(db: NodePgDatabase, request: sendMessage): Promise<Message> {
        const { chatId, senderId, content, attachments } = request;
        const now = new Date();
        try {
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
                        userId: senderId,
                        textContent: content,
                    })
                    .returning();

                const messageAttachmentRecords: MessageAttachment[] = [];
                if (attachments && attachments.length > 0) {
                    for (const attachment of attachments) {
                        const uploadedAttachment = await this.uploadAttachment(
                            message.messageId,
                            attachment.filename,
                            attachment.contentType,
                            attachment.data
                        );

                        const [attachmentRecord] = await tx
                            .insert(messageAttachments)
                            .values({
                                messageId: message.messageId,
                                fileName: uploadedAttachment.fileName,
                                fileSize: uploadedAttachment.fileSize,
                                mimeType: uploadedAttachment.mimeType,
                                storagePath: uploadedAttachment.storagePath,
                                uploadedAt: now,
                            })
                            .returning();

                        const url = await this.getAttachmentUrl(attachmentRecord.storagePath);

                        messageAttachmentRecords.push({
                            attachmentId: attachmentRecord.attachmentId,
                            messageId: attachmentRecord.messageId,
                            fileName: attachmentRecord.fileName,
                            fileSize: attachmentRecord.fileSize,
                            mimeType: attachmentRecord.mimeType,
                            storagePath: attachmentRecord.storagePath,
                            url: url,
                            uploadedAt: now,
                        });
                    }
                }
                await tx.update(chats).set({ lastActivity: now }).where(eq(chats.chatId, chatId));

                const mappedMessage: Message = {
                    messageId: message.messageId,
                    chatId: message.chatId,
                    senderId: message.userId,
                    content: message.textContent ?? "",
                    userId: message.userId,
                    textContent: message.textContent,
                    attachments: messageAttachmentRecords,
                };

                await this.broadcastToParticipants(db, message.chatId, {
                    event: "new_message",
                    data: mappedMessage,
                });

                return mappedMessage;
            });
        } catch (error) {
            console.error("Error sending message:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to send message.");
        }
    }

    //* Handle message attachments
    static async uploadAttachment(
        messageId: string,
        filename: string,
        contentType: string,
        base64Data: string
    ): Promise<{
        fileName: string;
        fileSize: number;
        mimeType: string;
        storagePath: string;
    }> {
        try {
            const fileExtension = path.extname(filename);
            const uniqueFilename = `${crypto.randomBytes(8).toString("hex")}-${Date.now()}${fileExtension}`;
            const storagePath = `${messageId}/${uniqueFilename}`;

            let dataPart = base64Data;
            if (base64Data.includes(",")) {
                dataPart = base64Data.split(",")[1];
            }
            if (!/^[A-Za-z0-9+/=]*$/.test(dataPart)) {
                throw new AppError("BAD_REQUEST", "Invalid base64 data format");
            }

            const buffer = Buffer.from(dataPart, "base64");
            const fileSize = buffer.length;

            if (fileSize === 0) {
                throw new AppError("BAD_REQUEST", "Empty file data");
            }

            await minioClient.putObject(BUCKET_NAME, storagePath, buffer, buffer.length, {
                "Content-Type": contentType,
            });

            return {
                fileName: filename,
                fileSize,
                mimeType: contentType,
                storagePath,
            };
        } catch (error) {
            console.error("Error uploading attachment:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to upload attachment.");
        }
    }

    static async getAttachmentUrl(storagePath: string): Promise<string> {
        try {
            const url = await minioClient.presignedGetObject(BUCKET_NAME, storagePath, 24 * 60 * 60);
            return url;
        } catch (error) {
            console.error("Error generating attachment URL:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to generate attachment URL.");
        }
    }

    static async getMessageAttachments(db: NodePgDatabase, messageId: string): Promise<MessageAttachment[]> {
        try {
            const attachmentRecords = await db
                .select()
                .from(messageAttachments)
                .where(eq(messageAttachments.messageId, messageId));

            const attachments = await Promise.all(
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

            return attachments;
        } catch (error) {
            console.error("Error fetching message attachments:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to fetch message attachments.");
        }
    }

    private static async getMessages(db: NodePgDatabase, chatId: string): Promise<Message[]> {
        try {
            const fetchedMessages = await db
                .select({ message: messages })
                .from(messages)
                .where(eq(messages.chatId, chatId));

            const chatMessages: Message[] = [];

            for (const row of fetchedMessages) {
                const attachments = await this.getMessageAttachments(db, row.message.messageId);

                chatMessages.push({
                    chatId: row.message.chatId,
                    messageId: row.message.messageId,
                    userId: row.message.userId,
                    senderId: row.message.userId,
                    textContent: row.message.textContent,
                    content: row.message.textContent ?? "",
                    attachments: attachments,
                });
            }

            return chatMessages;
        } catch (error) {
            console.error("Error fetching messages:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to fetch messages.");
        }
    }

    //*Websocket Handlers
    static async handleWebSocketMessage(db: NodePgDatabase, authContext: AuthContext, data: MessageData) {
        const validatedData = sendMessageSchema.parse({
            chatId: data.chatId,
            senderId: authContext.user.id,
            content: data.content,
            replyToMessageId: data.replyToMessageId,
            attachments: data.attachments || [],
        });

        await this.sendMessage(db, validatedData);
    }

    private static async broadcastToParticipants(db: NodePgDatabase, chatId: string, payload: any) {
        const participants = await this.getParticipants(db, chatId);
        this.notifyParticipants(participants, payload);
    }

    private static notifyParticipants(participantIds: string[], payload: any) {
        const payloadString = JSON.stringify(payload);

        participantIds.forEach((userId) => {
            const client = clients.get(userId);
            if (client && client.readyState === 1) {
                client.send(payloadString);
            }
        });
    }
}
