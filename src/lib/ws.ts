import WebSocket, { WebSocketServer } from "ws";
import { ChatService } from "../api/chat/service";
import { AuthService } from "../api/auth/service";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { connectToPostgres } from "./postgres";

const websocketPort = 3001;

export const wss = new WebSocketServer({ port: websocketPort });
export const clients = new Map<string, WebSocket>();

async function startWebSocketServer() {
    const pool = await connectToPostgres();
    const db = drizzle(pool);
    initializeWebSocketServer(db, wss);
    console.log(`WebSocket server running on ${websocketPort}`);
}

export function initializeWebSocketServer(db: NodePgDatabase, wss: WebSocketServer) {
    wss.on("connection", async (ws, req) => {
        console.log("Connection attempt received");

        const url = new URL(req.url ?? "", `ws://${req.headers.host}`);
        const sessionToken = url.searchParams.get("sessionToken");

        if (!sessionToken) {
            ws.close(1008, "Unauthorized: Missing session token");
            return;
        }

        let authContext;

        try {
            authContext = await AuthService.createAuthContext(db, { sessionToken });
            console.log("Authentication successful for user:", authContext.user.id);
        } catch (error) {
            console.error("Authentication failed:", error);
            ws.close(1008, "Unauthorized: Invalid session");
            return;
        }

        const userId = authContext.user.id;
        clients.set(userId, ws);

        console.log(`Client connected: ${userId}`);

        ws.on("message", async (message) => {
            const { event, data } = JSON.parse(message.toString());
            console.log("Message:", data.content);
            try {
                switch (event) {
                    case "send_message":
                        await ChatService.handleWebSocketMessage(db, authContext, data);
                        break;
                    default:
                        ws.send(JSON.stringify({ error: "Unknown event type" }));
                }
            } catch (error) {
                ws.send(JSON.stringify({ error }));
            }
        });

        ws.on("close", () => {
            console.log(`Client disconnected: ${userId}`);
            clients.delete(userId);
        });
    });
    wss.on("error", (err) => console.error("WebSocket error:", err));
}

startWebSocketServer();
