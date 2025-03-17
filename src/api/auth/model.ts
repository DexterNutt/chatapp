import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { sessionTable } from "../../lib/schema";

export type AuthTokens = z.output<typeof authTokensSchema>;
export const authTokensSchema = z.object({ sessionToken: z.string() }).strict();

export type SignInRequest = z.output<typeof signInRequestSchema>;
export const signInRequestSchema = z
    .object({
        email: z.string().transform((value) => value.toLowerCase()),
        password: z.string().max(128),
    })
    .strict();

export type SignUpRequest = z.output<typeof signUpRequestSchema>;
export const signUpRequestSchema = z
    .object({
        email: z
            .string()
            .email()
            .transform((value) => value.toLowerCase()),
        password: signInRequestSchema.shape.password.min(6).max(128),
        suppressDomainCheck: z.boolean().nullish(),
        suppressVerificationEmail: z.boolean().nullish(),
    })
    .strict();

export type Session = z.output<typeof sessionSchema>;
export const sessionSchema = createSelectSchema(sessionTable).strict();
