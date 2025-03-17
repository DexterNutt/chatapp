import type { z } from "zod";

export type AppErrorCode = keyof typeof appErrorCodesToHTTP;

const appErrorCodesToHTTP = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_SUPPORTED: 405,
    TIMEOUT: 408,
    CONFLICT: 409,
    PRECONDITION_FAILED: 412,
    PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    UNPROCESSABLE_CONTENT: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    SERVICE_UNAVAILABLE: 503,
} as const;

const sqlErrorToCode = {
    CONFLICT: "23505",
};

export const isSqlError = (error: unknown, errorType: keyof typeof sqlErrorToCode) => {
    return error instanceof Error && "code" in error && error["code"] === sqlErrorToCode[errorType];
};

export const getErrorMessage = (error: unknown): string => {
    return (error as Error).message || "An unknown error has occurred";
};

export class AppError extends Error {
    code: AppErrorCode;

    constructor(code: AppErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
    }

    static validation(error: z.ZodError): AppError {
        return new AppError("BAD_REQUEST", error.message, { cause: error });
    }

    static from(error: unknown): AppError {
        const result = (() => {
            if (error instanceof AppError) {
                return error;
            }

            if (error instanceof Error) {
                return new AppError("INTERNAL_SERVER_ERROR", error.message, { cause: error.cause ?? error });
            }

            return new AppError("INTERNAL_SERVER_ERROR", getErrorMessage(error));
        })();

        if (error instanceof Error && error.stack) {
            result.stack = error.stack;
        }

        return result;
    }

    httpCode() {
        return appErrorCodesToHTTP[this.code];
    }
}
