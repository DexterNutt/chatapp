import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { type CtxEnv, inputValidator, routeResponses, validatedJson } from "../../lib/hono";
import { ChatService } from "./service";
import { createChatRequestSchema, sendMessageRequestSchema, chatResponseSchema, messageResponseSchema } from "./model";
export const chatRouter = new Hono<CtxEnv>();

const tags = ["Chat"];

chatRouter.post(
    "/create",
    inputValidator("json", createChatRequestSchema),
    describeRoute({
        operationId: "createChat",
        responses: routeResponses(chatResponseSchema),
        tags,
    }),
    async (c) => validatedJson(c, chatResponseSchema, await ChatService.createChat(c.var.db, c.req.valid("json")))
);

chatRouter.post(
    "/send-message",
    inputValidator("json", sendMessageRequestSchema),
    describeRoute({
        operationId: "sendMessage",
        responses: routeResponses(messageResponseSchema),
        tags,
    }),
    async (c) => validatedJson(c, messageResponseSchema, await ChatService.sendMessage(c.var.db, c.req.valid("json")))
);

export default chatRouter;
