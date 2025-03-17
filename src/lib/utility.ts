type AwaitedObject<T> = {
    [K in keyof T]: T[K] extends Promise<infer U> ? U : T[K];
};

export type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type FullyRequired<T extends object> = {
    [K in keyof T]-?: NonNullable<T[K]>;
};

export type RemoveUndefined<T> = {
    [P in keyof T as object extends Pick<T, P> ? P : never]?: Exclude<T[P], undefined>;
} & {
    [P in keyof T as object extends Pick<T, P> ? never : P]: Exclude<T[P], undefined>;
};

export const removeUndefined = <T extends object>(obj: T) => {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as RemoveUndefined<T>;
};

export const uniqueArray = <T>(array: T[] | readonly T[]) => {
    return Array.from(new Set(array));
};

export const isNullish = (value: unknown): value is null | undefined => {
    return value === null || value === undefined;
};

export const awaitAllPromises = async <T extends Record<string, unknown>>(obj: T): Promise<AwaitedObject<T>> => {
    const entries = Object.entries(obj);
    const awaitedEntries = await Promise.all(entries.map(async ([key, value]) => [key, await value] as const));
    return Object.fromEntries(awaitedEntries) as AwaitedObject<T>;
};
