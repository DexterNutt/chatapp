import { WebSocketServer, WebSocket } from "ws";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chats, chatParticipants, messages } from "../../lib/schema";
import {
    sendMessageRequestSchema,
    type ChatResponse,
    type CreateChatRequest,
    type MessageResponse,
    type SendMessageRequest,
} from "./model";
import type { AuthContext } from "../auth/service";
import { clients } from "../../lib/ws";

interface MessageData {
    chatId: string;
    content: string;
    replyToMessageId?: string;
}

interface TypingUpdateData {
    chatId: string;
    isTyping: boolean;
}

export class ChatService {
    static async createChat(db: NodePgDatabase, request: CreateChatRequest): Promise<ChatResponse> {
        const now = new Date();

        const [chat] = await db
            .insert(chats)
            .values({
                creatorId: request.creatorId,
                name: request.name ?? null,
                createdAt: now,
                lastActivity: now,
            })
            .returning();

        const chatId = chat.chatId;
        const participantIds = Array.from(new Set([request.creatorId, ...request.participantIds]));

        const participants = participantIds.map((userId) => ({
            chatId,
            userId,
            roles:
                userId === request.creatorId
                    ? (["admin"] as ("admin" | "member")[])
                    : (["member"] as ("admin" | "member")[]),
            joinedAt: now,
            leftAt: null,
        }));

        await db.insert(chatParticipants).values(participants);

        return {
            chatId,
            creatorId: request.creatorId,
            name: request.name,
            createdAt: now,
            lastActivity: now,
            messages: [],
            participants: participants.map((p) => ({
                userId: p.userId,
                roles: p.roles,
                joinedAt: p.joinedAt,
                leftAt: p.leftAt,
            })),
        };
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

    static async handleWebSocketTypingUpdate(db: NodePgDatabase, authContext: AuthContext, data: TypingUpdateData) {
        const { chatId, isTyping } = data;
        const participants = await this.getParticipants(db, chatId);

        participants.forEach((userId) => {
            if (userId !== authContext.user.id) {
                const client = clients.get(userId);
                if (client && client.readyState === WebSocket.OPEN) {
                    client.send(
                        JSON.stringify({
                            event: "typing_update",
                            data: { chatId, userId: authContext.user.id, isTyping },
                        })
                    );
                }
            }
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
        const [message] = await db
            .insert(messages)
            .values({
                chatId,
                userId: senderId,
                textContent: content,
                replyToMessageId,
                messageStatus: "sent",
            })
            .returning();

        await db.update(chats).set({ lastActivity: new Date() }).where(eq(chats.chatId, chatId));

        const mappedMessage: MessageResponse = {
            messageId: message.messageId,
            chatId: message.chatId,
            senderId: message.userId,
            content: message.textContent ?? "",
            sentAt: message.sentAt ?? new Date(),
            replyToMessageId: message.replyToMessageId ?? undefined,
            messageStatus: message.messageStatus ?? "sent",
            userId: message.userId,
            textContent: message.textContent,
            deletedAt: message.deletedAt,
            editedAt: message.editedAt,
            attachments: [],
        };

        return mappedMessage;
    }
}
