import { z } from "zod";

export const zodFile = () => z.custom<File>((v) => v instanceof File);

export const zodFormBool = () =>
    z
        .custom<string | boolean>((v) => v === "true" || v === "false" || v === true || v === false)
        .transform((v) => v === "true" || v === true);

export type SSEEventType = "message" | "error";
export type SSEWrapper = z.output<ReturnType<typeof createSSEWrapperSchema>>;
export const createSSEWrapperSchema = <TSchema extends z.ZodType, TEvents extends [SSEEventType, ...SSEEventType[]]>(
    schema: TSchema,
    eventTypes: TEvents
) =>
    z
        .object({
            id: z.string(),
            event: z.enum(eventTypes),
            data: schema,
        })
        .strict();

export const errorWrapperSchema = z
    .object({
        message: z.string(),
        fieldErrors: z.object({}).passthrough().optional(),
    })
    .strict();

export const sseErrorWrapperSchema = createSSEWrapperSchema(errorWrapperSchema, ["error"]);
