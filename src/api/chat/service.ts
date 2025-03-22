import { WebSocketServer, WebSocket } from "ws";
import { eq, sql, and, inArray, count } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chats, chatParticipants, messages, messageAttachments } from "../../lib/schema";
import {
    sendMessageRequestSchema,
    type Chat,
    type ChatResponse,
    type CreateChatRequest,
    type MessageResponse,
    type SendMessageRequest,
} from "./model";
import type { AuthContext } from "../auth/service";
import { clients } from "../../lib/ws";
import { AppError } from "../../lib/error";

interface MessageData {
    chatId: string;
    content: string;
    replyToMessageId?: string;
}

export class ChatService {
    static async createChat(db: NodePgDatabase, request: CreateChatRequest): Promise<Chat> {
        const now = new Date();

        // Step 0: Find unique participants
        const participantIds = [...new Set([request.creatorId, ...request.participantIds])];
        const participantCount = participantIds.length;

        try {
            // Step 1: Check if a chat already exists with the same participants
            const existingChat = await this.findExistingChat(db, participantIds);
            if (existingChat) {
                return existingChat;
            }

            // Step 2: Create a new chat if no existing chat is found
            return await this.createNewChat(db, request, participantIds, now);
        } catch (error) {
            console.error("Error in createChat:", error);
            throw new AppError("BAD_REQUEST", "Failed to create chat.");
        }
    }

    private static async findExistingChat(db: NodePgDatabase, participantIds: string[]): Promise<Chat | null> {
        const participantCount = participantIds.length;

        const existingChat = await db
            .select({ chatId: chatParticipants.chatId })
            .from(chatParticipants)
            .where(inArray(chatParticipants.userId, participantIds))
            .groupBy(chatParticipants.chatId)
            .having(eq(count(), participantCount))
            .limit(1);

        if (existingChat.length === 0) {
            return null;
        }

        return await this.fetchChatDetails(db, existingChat[0].chatId);
    }

    private static async fetchChatDetails(db: NodePgDatabase, chatId: string): Promise<Chat | null> {
        const result = await db
            .select({
                chat: chats,
                participant: chatParticipants,
                message: messages,
            })
            .from(chats)
            .leftJoin(chatParticipants, eq(chats.chatId, chatParticipants.chatId))
            .leftJoin(messages, eq(chats.chatId, messages.chatId))
            .where(eq(chats.chatId, chatId));

        if (result.length === 0) return null;

        const chat = result[0]?.chat;

        if (!chat) return null;

        const fetchedMessages = this.getMessages(db, chat.chatId);
        const fetchedParticipants = this.getParticipants(db, chat.chatId);

        return {
            chatId: chat.chatId,
            creatorId: chat.creatorId,
            name: chat.name,
            createdAt: chat.createdAt,
            lastActivity: chat.lastActivity,
            messages: fetchedMessages
            participants: fetchedParticipants
        };
    }

    private static async createNewChat(
        db: NodePgDatabase,
        request: CreateChatRequest,
        participantIds: string[],
        now: Date
    ): Promise<Chat> {
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

            const participants = participantIds.map((userId) => ({
                chatId,
                userId,
                roles: userId === request.creatorId ? ["admin"] : ["member"],
                joinedAt: now,
                leftAt: null,
            }));

            await tx.insert(chatParticipants).values(participants);

            return {
                chatId,
                creatorId: request.creatorId,
                name: request.name,
                createdAt: now,
                lastActivity: now,
                messages: [],
                participants,
            };
        });
    }

    static async handleWebSocketMessage(db: NodePgDatabase, authContext: AuthContext, data: MessageData) {
        const validatedData = sendMessageRequestSchema.parse({
            chatId: data.chatId,
            senderId: authContext.user.id,
            content: data.content,
            replyToMessageId: data.replyToMessageId,
        });

        const message = await this.sendMessage(db, validatedData);
        this.broadcastToParticipants(db, message.chatId, {
            event: "new_message",
            data: message,
        });
    }

    private static async broadcastToParticipants(db: NodePgDatabase, chatId: string, payload: any) {
        const participants = await this.getParticipants(db, chatId);
        participants.forEach((userId) => {
            const client = clients.get(userId);
            if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(payload));
            }
        });
    }

    private static async getParticipants(db: NodePgDatabase, chatId: string): Promise<string[]> {
        const result = await db
            .select({ userId: chatParticipants.userId })
            .from(chatParticipants)
            .where(eq(chatParticipants.chatId, chatId));
        return result.map((p) => p.userId);
    }

    static async sendMessage(db: NodePgDatabase, request: SendMessageRequest): Promise<MessageResponse> {
        const { chatId, senderId, content, replyToMessageId } = request;

        //Use user from auth context

        //Check if chat ID exists
        //check if senderId is participant
        //Then send msg

        const [message] = await db
            .insert(messages)
            .values({
                chatId,
                userId: senderId,
                textContent: content,
            })
            .returning();

        await db.update(chats).set({ lastActivity: new Date() }).where(eq(chats.chatId, chatId));

        // Make transaction dependent between message and last activity

        const mappedMessage: MessageResponse = {
            messageId: message.messageId,
            chatId: message.chatId,
            senderId: message.userId,
            content: message.textContent ?? "",
            userId: message.userId,
            textContent: message.textContent,
            attachments: [],
        };

        return mappedMessage;
    }

    private static async getMessages(db: NodePgDatabase, chatId: string): Promise<MessageResponse[]> {
        const fetchedMessages = await db
            .select({ message: messages })
            .from(messages)
            .where(eq(messages.chatId, chatId));

        // Map the fetched messages into MessageResponse format
        const chatMessages: MessageResponse[] = fetchedMessages.map((row) => ({
            chatId: row.message.chatId, // Accessing chatId from the nested message object
            messageId: row.message.messageId, // Accessing messageId from the nested message object
            userId: row.message.userId, // Accessing userId from the nested message object
            textContent: row.message.textContent ?? "", // Accessing textContent from the nested message object
            senderId: row.message.userId,
            content: row.message.textContent ?? "", // Content is the same as textContent
            attachments: [],
        }));
        return chatMessages;
    }
}
