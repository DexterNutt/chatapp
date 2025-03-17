import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "../../lib/schema";
import { zodFormBool } from "../../lib/zod";

export type User = z.infer<typeof userSchema>;
export const userSchema = createSelectSchema(users, {
    username: (s) => s.username.min(1).max(50).optional(),
    createdAt: z.coerce.date(),
})
    .pick({
        userId: true,
        username: true,
        createdAt: true,
    })
    .strict();

export type UserSearch = z.infer<typeof userSearchSchema>;
export const userSearchSchema = z
    .object({
        userIds: userSchema.shape.userId.array(),
        includeCurrentUser: zodFormBool(),
        query: z.string().min(1).max(50),
    })
    .partial()
    .strict();

export type UserSearchResponse = z.infer<typeof userSearchResponseSchema>;
export const userSearchResponseSchema = z
    .object({
        users: userSchema.array(),
    })
    .strict();
