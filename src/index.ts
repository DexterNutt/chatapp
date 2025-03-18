import { Hono } from "hono";
import { apiRouter } from "./api/router";
import { AppError } from "./lib/error";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { errorWrapperSchema } from "./lib/zod";

export const app = new Hono();

const port = process.env["APP_PORT"];

app.get("/", (c) => c.text("Server is running 🚀"));

app.route("/api", apiRouter);

app.onError(async (err, c) => {
    console.error(c.req.method, c.req.url, err);

    const error = AppError.from(err);
    const fieldErrors =
        error.code === "BAD_REQUEST" && error.cause instanceof z.ZodError
            ? error.cause.flatten().fieldErrors
            : undefined;

    const output = await errorWrapperSchema.parseAsync({
        message:
            Object.values(fieldErrors ?? {})
                .at(0)
                ?.at(0) ?? error.message,
        fieldErrors,
    });

    if (c.req.header("Accept") === "text/event-stream") {
        return streamSSE(c, (stream) =>
            stream.writeSSE({
                id: crypto.randomUUID(),
                event: "error",
                data: JSON.stringify(output),
            })
        );
    }

    return c.json(output, error.httpCode());
});

export default {
    fetch: app.fetch,
    idleTimeout: 0,
    port,
};
