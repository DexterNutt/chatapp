import pg from "pg";

export const connectToPostgres = async (): Promise<pg.Pool> => {
    const pool = new pg.Pool({
        host: "postgres",
        port: 5432,
        user: "postgres",
        password: "chat-password",
        database: "chatdb",
        keepAlive: true,
    });

    await pool.connect();
    return pool;
};
