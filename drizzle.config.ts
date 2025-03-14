import { defineConfig } from "drizzle-kit";

const dbUrlEnvKey = "DB_URL" as const;
const dbUrl = process.env[dbUrlEnvKey];

if (!dbUrl) {
    throw new Error(`Database URL not provided in the ${dbUrlEnvKey} environment variable.`);
}

export default defineConfig({
    schema: "./src/lib/schema.ts",
    dialect: "postgresql",
    dbCredentials: {
        url: dbUrl,
    },
});
