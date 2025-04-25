#!/usr/bin/env bun

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { config } from "dotenv";
import commandLineArgs from "command-line-args";
import { connectToPostgres } from "../lib/postgres";

config();

const args = commandLineArgs(
    [
        { name: "command", defaultOption: true },
        { name: "force", type: Boolean, defaultValue: false },
        { name: "quiet", type: Boolean, defaultValue: false },
    ],
    { partial: true }
) as {
    command: string;
    force: boolean;
    quiet: boolean;
};

const dbUrlEnvKey = "DB_URL" as const;
const dbUrl = process.env[dbUrlEnvKey];

if (!dbUrl) {
    throw new Error(`Database URL not provided in the ${dbUrlEnvKey} environment variable.`);
}

async function dbMigrate() {
    const db = drizzle(await connectToPostgres());
    await migrate(db, {
        migrationsFolder: "drizzle",
    });
}

if (args.command === "db-migrate") {
    dbMigrate().catch(console.error);
} else if (!args.quiet && args.command) {
    console.log(`Unknown command: ${args.command}`);
} else if (!args.command && !args.quiet) {
    console.log("Usage: bun run ./migrate.ts db-migrate");
}
