/** The worker that encrypts and decrypts call media; built by Vite like the store worker. */
export function createE2EEWorker(): Worker {
    return new Worker(new URL("./e2ee-worker.ts", import.meta.url), { type: "module" });
}
