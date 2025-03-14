import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, and, or, isNotNull, gt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users, passwordCredentialTable, sessionTable } from "../../lib/schema";
import { CryptoService } from "../../internal-services/crypto";
import { uuid } from "drizzle-orm/gel-core";
import { randomUUID } from "crypto";

export class AuthService {
    constructor(private db: NodePgDatabase, private cryptoService: CryptoService) {}

    // Sign Up
    async signUp(email: string, password: string): Promise<{ success: boolean; message: string }> {
        // Check if the user already exists
        const existingUser = await this.db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .then((res) => res.at(0));

        if (existingUser) {
            return { success: false, message: "User already exists" };
        }

        // Hash the password
        const passwordHash = await CryptoService.hashPassword(password);

        // Create user and password credential in a transaction
        await this.db.transaction(async (tx) => {
            // Create user
            const [user] = await tx.insert(users).values({ userId: randomUUID(), email }).returning();
            // Create password credential
            await tx.insert(passwordCredentialTable).values({
                userId: user.userId, // Link credential to the user
                passwordHash,
            });
        });

        return { success: true, message: "User registered successfully" };
    }

    // Sign In
    async signIn(email: string, password: string): Promise<{ success: boolean; sessionId?: string; message: string }> {
        // Fetch user and password credential
        const user = await this.db
            .select({
                userId: users.userId,
                passwordHash: passwordCredentialTable.passwordHash,
            })
            .from(users)
            .innerJoin(passwordCredentialTable, eq(passwordCredentialTable.userId, users.userId))
            .where(eq(users.email, email))
            .then((res) => res.at(0));

        if (!user) {
            return { success: false, message: "User not found" };
        }
        const isPasswordValid = await CryptoService.verifyPassword({
            hash: user.passwordHash,
            password,
        });

        if (!isPasswordValid) {
            return { success: false, message: "Invalid password" };
        }

        // Create session
        const sessionId = await this.createSession(user.userId);

        return { success: true, sessionId, message: "User signed in successfully" };
    }

    // Create Session
    private async createSession(userId: string): Promise<string> {
        const [session] = await this.db
            .insert(sessionTable)
            .values({
                userId,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
            })
            .returning({ id: sessionTable.id });

        return session.id;
    }

    // Validate Session
    async validateSession(sessionId: string): Promise<{ success: boolean; userId?: string; message: string }> {
        const session = await this.db
            .select()
            .from(sessionTable)
            .where(and(eq(sessionTable.id, sessionId), gt(sessionTable.expiresAt, new Date())))
            .then((res) => res.at(0));

        if (!session) {
            return { success: false, message: "Invalid or expired session" };
        }

        return { success: true, userId: session.userId ?? undefined, message: "Session is valid" };
    }
}
