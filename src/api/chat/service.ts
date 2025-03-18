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
import { WebSocketServer, WebSocket } from "ws";

export class ChatService {
    private static wss: WebSocketServer;
    private static clients: Map<string, WebSocket> = new Map();

    static initializeWebSocketServer(port: number, db: NodePgDatabase) {
        if (this.wss) return;
        this.wss = new WebSocketServer({ port });

        this.wss.on("connection", (ws: WebSocket, req) => {
            const url = req.url;

            if (!url) {
                ws.close();
                return;
            }

            const userId = (url.split("/").pop() ?? "").replace(/[^a-fA-F0-9]/g, "");

            if (!userId) {
                ws.close();
                return;
            }

            this.clients.set(userId, ws);

            ws.on("message", async (message) => {
                try {
                    const data = typeof message === "string" ? message : message.toString();
                    const request = JSON.parse(data);
                    const parsedRequest = sendMessageRequestSchema.safeParse(request);
                    if (!parsedRequest.success) {
                        ws.send(JSON.stringify({ error: "Invalid message format" }));
                        return;
                    }

                    // Send message using the attached database connection
                    const chatMessage = await this.sendMessage(db, parsedRequest.data);
                    ws.send(JSON.stringify(chatMessage));
                } catch (error) {
                    console.error("Error processing message:", error);
                    ws.send(JSON.stringify({ error: "Internal server error" }));
                }
            });

            ws.on("close", () => this.clients.delete(userId));
        });

        console.log(`WebSocket server is running on ws://localhost:${port}`);
    }

    static addConnection(userId: string, ws: WebSocket) {
        this.clients.set(userId, ws);
    }

    static removeConnection(userId: string) {
        this.clients.delete(userId);
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

        // Map participants for the API response.
        const participants = participantIds.map((userId) => ({
            userId,
            roles: userId === creatorId ? ["admin"] : ["member"],
            joinedAt: chat.createdAt ?? new Date(),
            leftAt: undefined,
        }));

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

    // Send a message to a chat and broadcast it via WebSocket.
    static async sendMessage(db: NodePgDatabase, request: SendMessageRequest): Promise<MessageResponse> {
        const { chatId, senderId, content, replyToMessageId } = request;

        // Insert the message record.
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
            userId: "",
            textContent: null,
            deletedAt: null,
            editedAt: null,
            attachments: [],
        };

        // Fetch participants for the given chat
        const participants = await db
            .select({ userId: chatParticipants.userId })
            .from(chatParticipants)
            .where(eq(chatParticipants.chatId, chatId));

        // Broadcast the message to all connected participants
        for (const participant of participants) {
            const connection = this.clients.get(participant.userId);
            if (connection) {
                connection.send(JSON.stringify(mappedMessage));
            }
        }

        return mappedMessage;
    }
}
