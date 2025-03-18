import { eq, and, gt } from "drizzle-orm";
import { AppError } from "../../lib/error";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users, passwordCredentialTable, sessionTable } from "../../lib/schema";
import { CryptoService } from "../../internal-services/crypto";
import type { AuthTokens, Session, SignUpRequest, SignInRequest } from "./model";

const sessionExpiryMs = 1000 * 60 * 60 * 24 * 30;

export type AuthContextParams = {};

export type BaseAuthContext = {
    session: {
        id: string;
    };
    user: {
        id: string;
    };
};

export type AuthContext = BaseAuthContext;

export class AuthService {
    static async createAuthContext(db: NodePgDatabase, authTokens: AuthTokens) {
        const result = await db
            .select({
                session: {
                    id: sessionTable.id,
                },
                user: {
                    id: users.userId,
                    email: users.email,
                },
            })
            .from(sessionTable)
            .innerJoin(users, eq(users.userId, sessionTable.userId))
            .where(and(eq(sessionTable.id, authTokens.sessionToken), gt(sessionTable.expiresAt, new Date())))
            .then((res) => res.at(0));

        if (!result) {
            throw new AppError("UNAUTHORIZED", "Invalid session");
        }

        return {
            ...result,
            userId: result.user.id || null,
        };
    }

    static async reloadAuthContext(db: NodePgDatabase, authContext: AuthContext): Promise<AuthContext> {
        return this.createAuthContext(db, { sessionToken: authContext.session.id });
    }

    static async signUp(db: NodePgDatabase, signUpRequest: SignUpRequest): Promise<AuthTokens> {
        return db.transaction(async (db) => {
            const { userId } = await this.createUser(db, {
                email: signUpRequest.email,
            });

            await this.forceSetPassword(db, {
                userId,
                password: signUpRequest.password,
            });

            const authTokens = await this.signIn(db, {
                email: signUpRequest.email,
                password: signUpRequest.password,
            });

            return authTokens;
        });
    }

    // Sign In
    static async signIn(db: NodePgDatabase, signInRequest: SignInRequest): Promise<AuthTokens> {
        return db.transaction(async (db) => {
            const { email, password } = signInRequest;

            const user = await db
                .select({
                    userId: users.userId,
                    passwordHash: passwordCredentialTable.passwordHash,
                    passwordCredentialId: passwordCredentialTable.id,
                })
                .from(users)
                .innerJoin(passwordCredentialTable, eq(passwordCredentialTable.userId, users.userId))
                .where(eq(users.email, email))
                .then((res) => res.at(0));

            if (!user) {
                throw new AppError("NOT_FOUND", "User not found");
            }

            const isPasswordValid = await CryptoService.verifyPassword({
                hash: user.passwordHash,
                password,
            });

            if (!isPasswordValid) {
                throw new AppError("UNAUTHORIZED", "Invalid password");
            }

            const session = await this.createSession(db, {
                userId: user.userId,
                passwordCredentialId: user.passwordCredentialId, // Use the fetched passwordCredentialId
            });

            return { sessionToken: session.id };
        });
    }

    //Create user
    static async createUser(
        db: NodePgDatabase,
        opts: {
            email: string;
        }
    ): Promise<{ userId: string }> {
        return db.transaction(async (db) => {
            const { userId } = await db
                .insert(users)
                .values({
                    email: opts.email,
                })
                .returning({
                    userId: users.userId,
                })
                .then((res) => res[0]);
            return { userId };
        });
    }

    // Create Session
    static async createSession(
        db: NodePgDatabase,
        opts: {
            userId: string;
            passwordCredentialId: string;
        }
    ): Promise<Session> {
        return db
            .insert(sessionTable)
            .values({
                userId: opts.userId,
                passwordCredentialId: opts.passwordCredentialId,
                expiresAt: new Date(Date.now() + sessionExpiryMs), // 30 days
            })
            .returning()
            .then((res) => res[0]);
    }

    // Password management
    static async forceSetPassword(
        db: NodePgDatabase,
        opts: {
            userId: string;
            password: string;
        }
    ): Promise<{ passwordCredentialId: string }> {
        const passwordHash = await CryptoService.hashPassword(opts.password);

        const user = await db
            .select()
            .from(users)
            .where(eq(users.userId, opts.userId))
            .then((res) => res.at(0));

        if (!user) {
            throw new AppError("NOT_FOUND", "User not found");
        }

        return db
            .insert(passwordCredentialTable)
            .values({
                userId: opts.userId,
                passwordHash,
            })
            .onConflictDoUpdate({
                set: { passwordHash },
                target: [passwordCredentialTable.userId],
            })
            .returning({ passwordCredentialId: passwordCredentialTable.id })
            .then((res) => res[0]);
    }
}
