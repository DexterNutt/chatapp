import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chats, chatParticipants, messages } from "../../lib/schema";
import {
    type CreateChatRequest,
    type SendMessageRequest,
    type ChatResponse,
    type MessageResponse,
    sendMessageRequestSchema,
} from "./model";
import type { Context } from "hono";
import type { CtxEnv } from "../../lib/hono";
import type { AuthContext } from "../auth/service";
import { wss, clients } from "../../lib/ws";
import WebSocket from "ws";

export class ChatService {
    static handleConnectionOpen(ws: WebSocket, ctx: Context<CtxEnv>) {
        const authContext = ctx.get("authContext");
        if (!authContext) {
            ws.close(1008, "Unauthorized");
            return;
        }

        // Store the user’s WebSocket connection
        clients.set(authContext.user.id, ws);
        console.log(`Client connected: ${authContext.user.id}`);
    }

    static handleMessage(ws: WebSocket, message: string | Buffer, ctx: Context<CtxEnv>) {
        try {
            const { event, data } = JSON.parse(message.toString());
            const authContext = ctx.get("authContext");

            if (!authContext) {
                ws.send(JSON.stringify({ error: "Unauthorized" }));
                return;
            }

            switch (event) {
                case "send_message":
                    this.handleSendMessage(ctx, authContext, data);
                    break;
                case "typing_update":
                    this.handleTypingUpdate(ctx, authContext, data);
                    break;
                default:
                    ws.send(JSON.stringify({ error: "Unknown event type" }));
            }
        } catch (error) {
            ws.send(JSON.stringify({ error: "Invalid message format" }));
        }
    }

    private static async handleSendMessage(ctx: Context<CtxEnv>, authContext: AuthContext, data: any) {
        try {
            const validatedData = sendMessageRequestSchema.parse({
                chatId: data.chatId,
                senderId: authContext.user.id,
                content: data.content,
                replyToMessageId: data.replyToMessageId,
            });

            const db = ctx.get("db");
            const message = await this.sendMessage(db, validatedData);

            this.broadcastToParticipants(db, message.chatId, {
                event: "new_message",
                data: message,
            });
        } catch (error) {
            console.error("Error handling message:", error);
            const client = clients.get(authContext.user.id);
            if (client) {
                client.send(
                    JSON.stringify({
                        event: "error",
                        data: { message: "Failed to send message" },
                    })
                );
            }
        }
    }

    private static async handleTypingUpdate(ctx: Context<CtxEnv>, authContext: AuthContext, data: any) {
        try {
            const { chatId, isTyping } = data;
            const db = ctx.get("db");

            const participants = await this.getParticipants(db, chatId);

            participants.forEach((userId) => {
                if (userId !== authContext.user.id) {
                    const client = clients.get(userId);
                    if (client) {
                        client.send(
                            JSON.stringify({
                                event: "typing_update",
                                data: {
                                    chatId,
                                    userId: authContext.user.id,
                                    isTyping,
                                },
                            })
                        );
                    }
                }
            });
        } catch (error) {
            console.error("Error handling typing update:", error);
        }
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

    // Create a new chat
    static async createChat(db: NodePgDatabase, request: CreateChatRequest): Promise<ChatResponse> {
        const { creatorId, participantIds, name } = request;

        // Insert the chat record into the database.
        const [chat] = await db.insert(chats).values({ creatorId, name }).returning();

        // Insert chat participants.
        await db.insert(chatParticipants).values(
            participantIds.map((userId) => ({
                chatId: chat.chatId,
                userId,
                roles: userId === creatorId ? ["admin" as const] : ["member" as const],
            }))
        );

        // Build the ChatResponse object.
        const chatResponse: ChatResponse = {
            chatId: chat.chatId,
            creatorId: chat.creatorId ?? creatorId,
            name: chat.name ?? undefined,
            createdAt: chat.createdAt ?? new Date(),
            lastActivity: chat.lastActivity ?? new Date(),
            participants: participantIds.map((userId) => ({
                userId,
                roles: userId === creatorId ? ["admin" as const] : ["member" as const],
                joinedAt: chat.createdAt ?? new Date(),
                leftAt: undefined,
            })),
            messages: [],
        };

        return chatResponse;
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

        // Update chat's lastActivity.
        await db.update(chats).set({ lastActivity: new Date() }).where(eq(chats.chatId, chatId));

        // Map the database message to our API response shape.
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
            attachments: [], // Assuming no attachments by default
        };

        return mappedMessage;
    }
}
