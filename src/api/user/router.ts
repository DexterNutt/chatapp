import { type CtxEnv, inputValidator, routeResponses, validatedJson } from "../../lib/hono";
import { userSearchResponseSchema, userSearchSchema } from "./model";
import { UserService } from "./service";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

export const userRouter = new Hono<CtxEnv>();

const tags = ["User"];

userRouter.get(
    "/search",
    inputValidator("query", userSearchSchema),
    describeRoute({
        operationId: "searchUsers",
        responses: routeResponses(userSearchResponseSchema),
        tags,
    }),
    async (c) => validatedJson(c, userSearchResponseSchema, await UserService.search(c.var.db, c.req.valid("query")))
);
