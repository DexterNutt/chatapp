import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { type CtxEnv, inputValidator, routeResponses, validatedJson } from "../../lib/hono";
import { ChatService } from "./service";
import {
    createChatSchema,
    sendMessageSchema,
    chatSchema,
    messageSchema,
    fetchChatsResponseSchema,
    fetchChatsRequestSchema,
    fetchMessagesResponseSchema,
    fetchMessagesRequestSchema,
    fetchChatParticipantsRequestSchema,
    fetchChatParticipantsResponseSchema,
} from "./model";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { AuthService, type AuthContext } from "../auth/service";
import type { WSEvents } from "hono/ws";

export const chatRouter = new Hono<CtxEnv>();
export const clients = new Map<string, ServerWebSocket<WebSocketData>>();

interface WebSocketData {
    userId: string;
    textContent: string;
}

const { upgradeWebSocket } = createBunWebSocket<ServerWebSocket<WebSocketData>>();

const tags = ["Chat"];

chatRouter.post(
    "/create",
    inputValidator("json", createChatSchema),
    describeRoute({
        operationId: "createChat",
        responses: routeResponses(chatSchema),
        tags,
    }),
    async (c) => validatedJson(c, chatSchema, await ChatService.createChat(c.var.db, c.req.valid("json")))
);

chatRouter.post(
    "/send-message",
    inputValidator("json", sendMessageSchema),
    describeRoute({
        operationId: "sendMessage",
        responses: routeResponses(messageSchema),
        tags,
    }),
    async (c) => validatedJson(c, messageSchema, await ChatService.sendMessage(c.var.db, c.req.valid("json")))
);

chatRouter.post(
    "/fetch-chats",
    inputValidator("json", fetchChatsRequestSchema),
    describeRoute({
        operationId: "fetchChats",
        responses: routeResponses(fetchChatsResponseSchema),
        tags,
    }),
    async (c) => validatedJson(c, fetchChatsResponseSchema, await ChatService.fetchChats(c.var.db, c.req.valid("json")))
);

chatRouter.get(
    "/fetch-messages",
    inputValidator("query", fetchMessagesRequestSchema),
    describeRoute({
        operationId: "fetchMessages",
        responses: routeResponses(fetchMessagesResponseSchema),
        tags,
    }),
    async (c) =>
        validatedJson(c, fetchMessagesResponseSchema, await ChatService.fetchMessages(c.var.db, c.req.valid("query")))
);

chatRouter.get(
    "/fetch-unread-messages",
    inputValidator("query", fetchMessagesRequestSchema),
    describeRoute({
        operationId: "fetchMessages",
        responses: routeResponses(fetchMessagesResponseSchema),
        tags,
    }),
    async (c) =>
        validatedJson(
            c,
            fetchMessagesResponseSchema,
            await ChatService.fetchMessages(c.var.db, c.req.valid("query"), true) //? Just true means we set the param to fetchUnread: true
        )
);

chatRouter.get(
    "/fetch-preview-message",
    inputValidator("query", fetchMessagesRequestSchema),
    describeRoute({
        operationId: "fetchMessages",
        responses: routeResponses(fetchMessagesResponseSchema),
        tags,
    }),
    async (c) =>
        validatedJson(
            c,
            fetchMessagesResponseSchema,
            await ChatService.fetchMessages(c.var.db, c.req.valid("query"), false, true) //? false, true means we set the param to fetchUnread: false, fetchPreview: true
        )
);

chatRouter.get(
    "/fetch-chat-participants",
    inputValidator("query", fetchChatParticipantsRequestSchema),
    describeRoute({
        operationId: "fetchChatParticipants",
        responses: routeResponses(fetchChatParticipantsResponseSchema),
        tags,
    }),
    async (c) =>
        validatedJson(
            c,
            fetchChatParticipantsResponseSchema,
            await ChatService.fetchParticipants(c.var.db, c.req.valid("query"))
        )
);

chatRouter.get(
    "/chat-socket",
    upgradeWebSocket(async (c): Promise<WSEvents<ServerWebSocket<WebSocketData>>> => {
        const url = new URL(c.req.url);
        const sessionToken = url.searchParams.get("sessionToken");
        const chatId = url.searchParams.get("chatId");

        console.log("WebSocket connection initiated with session token:", sessionToken);

        if (!sessionToken || !chatId) {
            throw new Error("Unauthorized: Missing session token or chatID");
        }

        let authContext: AuthContext;
        try {
            authContext = await AuthService.createAuthContext(c.var.db, { sessionToken });
            console.log("Authentication successful for user:", authContext.user.id);
        } catch (error) {
            console.error("Authentication failed:", error);
            throw new Error("Authentication failed");
        }

        const userId = authContext.user.id;

        return {
            onOpen: async (_, ws) => {
                if (!ws.raw) {
                    console.error("WebSocket raw data is undefined");
                    return;
                }

                clients.set(userId, ws.raw);

                console.log(`WebSocket connection opened for user: ${userId} in chat: ${chatId}`);

                ws.send(
                    JSON.stringify({
                        type: "connection_established",
                        userId: userId,
                    })
                );

                const result = await ChatService.fetchMessages(c.var.db, { chatId, userId }, true);

                ws.send(
                    JSON.stringify({
                        type: "unread_messages",
                        result: result,
                    })
                );
            },
            onMessage: async (event, ws) => {
                try {
                    const data = JSON.parse(event.data.toString());
                    console.log(`Message from user ${userId}:`, data.textContent);

                    data.userId = userId;

                    const result = await ChatService.handleWebSocketMessage(c.var.db, authContext, data);
                    ws.send(
                        JSON.stringify({
                            type: "message_received",
                            result: result,
                        })
                    );
                } catch (error) {
                    console.error(`Error handling message from user ${userId}:`, error);
                    ws.send(JSON.stringify({ error: "Failed to process message" }));
                }
            },
            onClose: (_, ws) => {
                clients.delete(userId);
                console.log(`WebSocket connection closed for user: ${userId}`);
            },
            onError: (error, ws) => {
                console.error(`WebSocket error for user ${userId}:`, error);
                clients.delete(userId);
            },
        };
    })
);

export default chatRouter;
