import type { z } from "zod";
import { createMiddleware } from "hono/factory";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { streamSSE } from "hono/streaming";
import type { Context, ValidationTargets } from "hono";
import { AppError } from "./error";
import { connectToPostgres } from "./postgres";
import { resolver, validator } from "hono-openapi/zod";
import type { DescribeRouteOptions } from "hono-openapi";
import { type AuthContext } from "../api/auth/service";
import { errorWrapperSchema, sseErrorWrapperSchema, createSSEWrapperSchema, type SSEWrapper } from "./zod";

export type AppResponseType = "application/json" | "text/event-stream";

export type CtxEnv = {
    Variables: {
        db: NodePgDatabase;
        authContext: AuthContext | null;
    };
};

export const ctxMiddleware = (() => {
    let _db: NodePgDatabase | undefined;

    return createMiddleware<CtxEnv>(async (ctx, next) => {
        _db ??= drizzle(await connectToPostgres());

        ctx.set("db", _db);

        await next();
    });
})();

export const routeResponses = <TContentType extends "application/json" | "text/event-stream">(
    schema?: z.AnyZodObject | z.ZodEffects<z.AnyZodObject>,
    contentType?: TContentType
) => {
    const errorCodesToDescriptions =
        contentType === "text/event-stream"
            ? {
                  500: "Failed response. For SSE streams, ignore the HTTP code, which will always be 200.",
              }
            : {
                  500: "Internal server error. The server should ideally never return this.",
                  400: "Bad request. The provided `fieldErrors` object should contain the field names as keys and an array of error messages as values.",
                  401: "Unauthorized. If signed in, the session may have expired or is no longer valid, and the user should be signed out.",
                  403: "Forbidden. The user is not allowed to perform the operation.",
                  404: "Not found. The requested resource does not exist.",
                  409: "Conflict. The request could not be completed due to a conflict with an already existing resource.",
              };

    const errorContent =
        contentType === "text/event-stream"
            ? {
                  "text/event-stream": {
                      schema: resolver(sseErrorWrapperSchema),
                  },
              }
            : {
                  "application/json": {
                      schema: resolver(errorWrapperSchema),
                  },
              };

    return {
        200: {
            description: "Successful response",
            ...(schema
                ? {
                      content: {
                          [contentType ?? "application/json"]: {
                              schema: resolver(
                                  contentType === "text/event-stream"
                                      ? createSSEWrapperSchema(schema, ["message"])
                                      : schema
                              ),
                          },
                      },
                  }
                : {}),
        },
        ...Object.fromEntries(
            Object.entries(errorCodesToDescriptions).map(([code, description]) => [
                code,
                {
                    description,
                    content: errorContent,
                },
            ])
        ),
    } satisfies DescribeRouteOptions["responses"];
};

export const inputValidator = <TTarget extends keyof ValidationTargets, TSchema extends z.ZodTypeAny>(
    target: TTarget,
    schema: TSchema
) =>
    validator(target, schema, (c) => {
        if (!c.success) {
            throw AppError.validation(c.error);
        }
    });

export const validatedStream = <TContext extends Context, TSchema extends z.ZodTypeAny>(
    context: TContext,
    schema: TSchema,
    generator: AsyncGenerator<z.output<TSchema>>
) => {
    return streamSSE(context, async (stream) => {
        for await (const item of generator) {
            await stream.writeSSE({
                id: crypto.randomUUID(),
                event: "message",
                data: JSON.stringify(await schema.parseAsync(item)),
            } satisfies SSEWrapper);
        }
    });
};

export const validatedJson = async <TContext extends Context, TSchema extends z.ZodTypeAny>(
    c: TContext,
    schema: TSchema,
    data: z.output<TSchema>
) => c.json(await schema.parseAsync(data));
