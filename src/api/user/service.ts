import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { AppError } from "../../lib/error";
import { users } from "../../lib/schema";
import type { User, UserSearch, UserSearchResponse } from "./model";

export class UserService {
    static async search(db: NodePgDatabase, UserSearch: UserSearch): Promise<UserSearchResponse> {
        const userSearchResult = await db
            .select({
                userId: users.userId,
                email: users.email,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(
                and(
                    UserSearch.query ? ilike(users.email, `%${UserSearch.query}%`) : undefined,
                    UserSearch.userIds ? inArray(users.userId, UserSearch.userIds) : undefined
                )
            );

        return { users: userSearchResult };
    }

    static async getSingle(db: NodePgDatabase, userId: string): Promise<User> {
        const userSingleResult = await db
            .select({
                userId: users.userId,
                email: users.email,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.userId, userId))
            .then((res) => res.at(0));

        if (!userSingleResult) {
            throw new AppError("NOT_FOUND", "User not found");
        }

        return userSingleResult;
    }
}
