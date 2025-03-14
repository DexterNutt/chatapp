export type AppEnv = "development" | "staging" | "production";

export type AppContext = "isolated" | "debug" | "release";

export const isAppEnv = (env: string | undefined | null): env is AppEnv => {
    switch (env as AppEnv) {
        case "development":
        case "staging":
        case "production":
            return true;
        default:
            return false;
    }
};

export const isAppContext = (context: string | undefined | null): context is AppContext => {
    switch (context as AppContext) {
        case "isolated":
        case "debug":
        case "release":
            return true;
        default:
            return false;
    }
};
