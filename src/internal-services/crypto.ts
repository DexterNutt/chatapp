export class CryptoService {
    static hashPassword(password: string): Promise<string> {
        return Bun.password.hash(password);
    }

    static async verifyPassword(opts: { hash: string | null | undefined; password: string }): Promise<boolean> {
        if (!opts.hash) {
            return false;
        }
        const isCorrect = await Bun.password.verify(opts.password, opts.hash);
        return isCorrect;
    }
}
