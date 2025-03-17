import pg from "pg";

export const connectToPostgres = async (): Promise<pg.Pool> => {
    const pool = new pg.Pool({
        host: "127.0.0.1",
        port: 5432,
        user: "postgres",
        password: "chat-password",
        database: "chatdb",
        keepAlive: true,
    });

    return pool;
};
