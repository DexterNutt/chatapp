import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { type CtxEnv, inputValidator, routeResponses, validatedJson } from "../../lib/hono";
import { ChatService } from "./service";
import { createChatSchema, sendMessageSchema, chatSchema, messageSchema } from "./model";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ServerWebSocket } from "bun";
import { createBunWebSocket } from "hono/bun";
import { AuthService, type AuthContext } from "../auth/service";
export const chatRouter = new Hono<CtxEnv>();
export const clients = new Map<string, ServerWebSocket<WebSocketData>>();

interface WebSocketData {
    userId: string;
    content: string;
}

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

export function createWebSocketRouter(db: NodePgDatabase) {
    const wsRouter = new Hono();
    const { upgradeWebSocket, websocket } = createBunWebSocket<WebSocketData>();

    wsRouter.get(
        "/newChat",
        upgradeWebSocket(async (c) => {
            const url = new URL(c.req.url);
            const sessionToken = url.searchParams.get("sessionToken");

            if (!sessionToken) {
                throw new Error("Unauthorized: Missing session token");
            }

            let authContext: AuthContext;

            try {
                authContext = await AuthService.createAuthContext(db, { sessionToken });
                console.log("Authentication successful for user:", authContext.user.id);
            } catch (error) {
                console.error("Authentication failed:", error);
                throw new Error("Authentication failed");
            }

            const userId = authContext.user.id;

            return {
                onMessage: async (event, ws) => {
                    try {
                        const data = JSON.parse(event.toString());
                        console.log("Message:", data.content);
                        await ChatService.handleWebSocketMessage(db, authContext, data);
                    } catch (error) {
                        console.error(`Error handling message from user ${userId}:`, error);
                        ws.send(JSON.stringify({ error: "Failed to process message" }));
                    }
                },
                onClose: () => {
                    clients.delete(userId);
                    console.log(`WebSocket connection closed for user: ${userId}`);
                },
                onError: (ws, error) => {
                    console.error(`WebSocket error for user ${userId}:`, error);
                },
            };
        })
    );

    return { router: wsRouter, websocket };
}

export function initializeChatRouters(app: Hono, db: NodePgDatabase) {
    // Mount HTTP routes
    app.route("/chat", chatRouter);

    // Mount WebSocket routes
    const { router: wsRouter } = createWebSocketRouter(db);
    app.route("/ws", wsRouter);

    return app;
}

export default chatRouter;
