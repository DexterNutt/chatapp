import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { type CtxEnv, inputValidator, routeResponses, validatedJson } from "../../lib/hono";
import { ChatService } from "./service";
import { createChatSchema, sendMessageSchema, chatSchema, messageSchema } from "./model";
export const chatRouter = new Hono<CtxEnv>();

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

export default chatRouter;
