import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 3001 });
const clients = new Map<string, WebSocket>();

wss.on("connection", (ws) => {
    console.log("New WebSocket connection established");

    ws.on("message", (message) => {
        console.log("Received:", message.toString());
    });

    ws.on("close", () => {
        console.log("Client disconnected");
        for (const [userId, client] of clients.entries()) {
            if (client === ws) {
                clients.delete(userId);
                break;
            }
        }
    });
});

export { wss, clients };
