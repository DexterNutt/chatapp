import { Hono } from "hono";
import { ctxMiddleware } from "../lib/hono";
import { authRouter } from "./auth/router";
import { userRouter } from "./user/router";
import { chatRouter } from "./chat/router";
import { logger } from "hono/logger";

export const apiBaseEndpoint = "/api";

export const apiRouter = new Hono().use(ctxMiddleware).use(logger());

apiRouter.route("/auth", authRouter);
apiRouter.route("/user", userRouter);
apiRouter.route("/chat", chatRouter);
