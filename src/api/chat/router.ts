import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { type CtxEnv, inputValidator, routeResponses, validatedJson } from "../../lib/hono";
import { ChatService } from "./service";
import { createChatSchema, sendMessageSchema, chatSchema, messageSchema } from "./model";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { AuthService, type AuthContext } from "../auth/service";
import type { WSEvents, WSContext } from "hono/ws";

export const chatRouter = new Hono<CtxEnv>();
export const clients = new Map<string, ServerWebSocket<WebSocketData>>();

interface WebSocketData {
    userId: string;
    content: string;
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

chatRouter.get(
    "/newChat",
    upgradeWebSocket(async (c): Promise<WSEvents<ServerWebSocket<WebSocketData>>> => {
        const url = new URL(c.req.url);
        const sessionToken = url.searchParams.get("sessionToken");
        console.log("WebSocket connection initiated with session token:", sessionToken);

        if (!sessionToken) {
            throw new Error("Unauthorized: Missing session token");
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
            onOpen: (_, ws) => {
                if (!ws.raw) {
                    console.error("WebSocket raw data is undefined");
                    return;
                }

                clients.set(userId, ws.raw);

                console.log(`WebSocket connection opened for user: ${userId}`);

                ws.send(
                    JSON.stringify({
                        type: "connection_established",
                        userId: userId,
                    })
                );
            },
            onMessage: async (event, ws) => {
                try {
                    const data = JSON.parse(event.data.toString());
                    console.log(`Message from user ${userId}:`, data.content);

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
