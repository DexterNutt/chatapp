import pg from "pg";

export const connectToPostgres = async (): Promise<pg.Pool> => {
    const pool = new pg.Pool({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || "5432"),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl:
            process.env.NODE_ENV === "production"
                ? {
                      rejectUnauthorized: true,
                  }
                : false,
    });

    try {
        await pool.connect();
        console.log("Connected to PostgreSQL");
        return pool;
    } catch (err) {
        console.error("PostgreSQL connection error:", err);
        throw err;
    }
};
