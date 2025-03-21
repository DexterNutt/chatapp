import { WebSocketServer, WebSocket } from "ws";
import { eq, sql, and, inArray } from "drizzle-orm";
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
import { array } from "zod";

interface MessageData {
    chatId: string;
    content: string;
    replyToMessageId?: string;
}

export class ChatService {
    static async createChat(db: NodePgDatabase, request: CreateChatRequest): Promise<ChatResponse> {
        const now = new Date();

        //Step 0: find participants
        const participantIds = [...new Set([request.creatorId, ...request.participantIds])];
        const participantCount = participantIds.length;

        //Step 1: Check if chat already exists with the same participants
        const existingChat = await db
            .select({ chatId: chatParticipants.chatId })
            .from(chatParticipants)
            .groupBy(chatParticipants.chatId)
            .having(({ and, eq, count, sql }) =>
                and(
                    eq(count(), participantCount),
                    eq(
                        sql`sum(case when ${chatParticipants.userId} in ${participantIds} then 1 else 0 end)`,
                        participantCount
                    )
                )
            )
            .limit(1);

        if (existingChat[0]) {
            const { chatId } = existingChat[0];
            const [chat, participants] = await Promise.all([
                db
                    .select()
                    .from(chats)
                    .where(eq(chats.chatId, chatId))
                    .then((res) => res[0]),
                db.select().from(chatParticipants).where(eq(chatParticipants.chatId, chatId)),
            ]);

            return {
                ...chat,
                messages: messages.map((m) => ({
                    ...m,
                    content: m.textContent ?? "",
                    senderId: m.userId,
                    replyToMessageId: m.replyToMessageId ?? undefined,
                    messageStatus: m.messageStatus ?? "sent",
                    attachments: [],
                })),
                participants: participants.map((p) => ({
                    userId: p.userId,
                    roles: p.roles,
                    joinedAt: p.joinedAt,
                    leftAt: p.leftAt,
                })),
            };
        }

        //Step 2: Create a new chat
        const [newChat] = await db.transaction(async (tx) => {
            await tx
                .insert(chats)
                .values({
                    creatorId: request.creatorId,
                    name: request.name ?? null,
                    createdAt: now,
                    lastActivity: now,
                })
                .returning();
            await tx.insert(chatParticipants);
        });

        const newChatId = newChat.chatId;

        const participants = participantIds.map((userId) => ({
            newChatId,
            userId,
            roles:
                userId === request.creatorId
                    ? (["admin"] as ("admin" | "member")[])
                    : (["member"] as ("admin" | "member")[]),
            joinedAt: now,
            leftAt: null,
        }));

        return {
            chatId: newChatId,
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
                replyToMessageId,
                messageStatus: "sent",
            })
            .returning();

        await db.update(chats).set({ lastActivity: new Date() }).where(eq(chats.chatId, chatId));

        // Make transaction dependent between message and last activity

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
