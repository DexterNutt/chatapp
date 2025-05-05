#!/usr/bin/env bun

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import commandLineArgs from "command-line-args";
import { connectToPostgres } from "../lib/postgres";

const DB_CONFIG = {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT || "5432"),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
};

async function runMigrations() {
    try {
        const pool = await connectToPostgres();
        const db = drizzle(pool);

        console.log("Starting migrations...");
        await migrate(db, {
            migrationsFolder: "drizzle",
        });
        console.log("Migrations completed successfully!");

        await pool.end();
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

if (process.argv.includes("db-migrate")) {
    runMigrations();
}
