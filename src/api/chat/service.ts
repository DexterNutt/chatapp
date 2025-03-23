import { eq, and, inArray, count } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chats, chatParticipants, messages, messageAttachments, chatParticipantRoles } from "../../lib/schema";
import { sendMessageSchema, type Chat, type CreateChat, type Message, type sendMessage } from "./model";
import { type AuthContext } from "../auth/service";
import { AppError } from "../../lib/error";
import { clients } from "./router";

interface MessageData {
    chatId: string;
    content: string;
    replyToMessageId?: string;
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

            // Find chat IDs where exactly those participants are members
            const chatIdsQuery = await db
                .select({
                    chatId: chatParticipants.chatId,
                    participantCount: count(chatParticipants.userId).as("participant_count"),
                })
                .from(chatParticipants)
                .where(inArray(chatParticipants.userId, participantIds))
                .groupBy(chatParticipants.chatId);

            const exactMatchChats = chatIdsQuery.filter((row) => row.participantCount === participantCount);

            if (exactMatchChats.length === 0) {
                return null;
            }

            // Now verify each chat has exactly these participants and no others
            for (const chat of exactMatchChats) {
                const allParticipants = await db
                    .select({ userId: chatParticipants.userId })
                    .from(chatParticipants)
                    .where(eq(chatParticipants.chatId, chat.chatId));

                const chatParticipantIds = allParticipants.map((p) => p.userId);

                // Check if the sets of participants are identical
                if (
                    chatParticipantIds.length === participantIds.length &&
                    chatParticipantIds.every((id) => participantIds.includes(id))
                ) {
                    return await this.fetchChatDetails(db, chat.chatId);
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

    private static async getMessages(db: NodePgDatabase, chatId: string): Promise<Message[]> {
        try {
            const fetchedMessages = await db
                .select({ message: messages })
                .from(messages)
                .where(eq(messages.chatId, chatId));

            // Map the fetched messages into MessageResponse format
            const chatMessages: Message[] = fetchedMessages.map((row) => ({
                chatId: row.message.chatId,
                messageId: row.message.messageId,
                userId: row.message.userId,
                textContent: row.message.textContent ?? "",
                senderId: row.message.userId,
                content: row.message.textContent ?? "",
                attachments: [],
            }));
            return chatMessages;
        } catch (error) {
            console.error("Error fetching messages:", error);
            throw new AppError("INTERNAL_SERVER_ERROR", "Failed to fetch messages.");
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

                // Create participant records for the database
                const participantRecords = participantIds.map((userId) => ({
                    chatId,
                    userId,
                    roles:
                        userId === request.creatorId
                            ? [chatParticipantRoles.enumValues[0]]
                            : [chatParticipantRoles.enumValues[1]],
                    joinedAt: now,
                }));

                // Insert the participant records
                await tx.insert(chatParticipants).values(participantRecords);

                // Notify all participants about the new chat
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
        const { chatId, senderId, content } = request;

        try {
            // Check if sender is a participant in the chat
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

                await tx.update(chats).set({ lastActivity: new Date() }).where(eq(chats.chatId, chatId));

                const mappedMessage: Message = {
                    messageId: message.messageId,
                    chatId: message.chatId,
                    senderId: message.userId,
                    content: message.textContent ?? "",
                    userId: message.userId,
                    textContent: message.textContent,
                    attachments: [],
                };

                // Broadcast the message to all participants
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

    //*Websocket Handlers
    static async handleWebSocketMessage(db: NodePgDatabase, authContext: AuthContext, data: MessageData) {
        const validatedData = sendMessageSchema.parse({
            chatId: data.chatId,
            senderId: authContext.user.id,
            content: data.content,
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
