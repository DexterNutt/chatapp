import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { type CtxEnv, inputValidator, routeResponses, validatedJson } from "../../lib/hono";
import { AuthService } from "./service";
import { signInRequestSchema, signUpRequestSchema, authTokensSchema } from "./model";

export const authRouter = new Hono<CtxEnv>();

const tags = ["Auth"];

// Sign-In Route
authRouter.post(
    "/sign-in",
    inputValidator("json", signInRequestSchema),
    describeRoute({
        operationId: "signIn",
        responses: routeResponses(authTokensSchema),
        tags,
    }),
    async (c) => validatedJson(c, authTokensSchema, await AuthService.signIn(c.var.db, c.req.valid("json")))
);

// Sign-Up Route
authRouter.post(
    "/sign-up",
    inputValidator("json", signUpRequestSchema),
    describeRoute({
        operationId: "signUp",
        responses: routeResponses(authTokensSchema),
        tags,
    }),
    async (c) => validatedJson(c, authTokensSchema, await AuthService.signUp(c.var.db, c.req.valid("json")))
);

export default authRouter;
