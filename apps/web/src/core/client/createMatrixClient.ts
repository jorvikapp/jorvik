import {
    type ICreateClientOpts,
    type MatrixClient,
    MemoryCryptoStore,
    MemoryStore,
    IndexedDBCryptoStore,
    IndexedDBStore,
    LocalStorageCryptoStore,
    createClient,
} from "matrix-js-sdk/src/matrix";

let indexedDBFactory: IDBFactory | undefined;
try {
    indexedDBFactory = window.indexedDB;
} catch {
    indexedDBFactory = undefined;
}

const localStorageRef = typeof window !== "undefined" ? window.localStorage : undefined;

export function createMatrixClient(opts: ICreateClientOpts): MatrixClient {
    const storeOpts: Partial<ICreateClientOpts> = {
        useAuthorizationHeader: true,
    };

    if (indexedDBFactory && localStorageRef) {
        storeOpts.store = new IndexedDBStore({
            indexedDB: indexedDBFactory,
            dbName: "riot-web-sync",
            localStorage: localStorageRef,
            // Keeps sync-accumulator serialization off the main thread. See the
            // comment in indexeddb-worker.ts for why this matters.
            workerFactory: () => {
                const worker = new Worker(new URL("./indexeddb-worker.ts", import.meta.url), {
                    type: "module",
                    name: "matrix-indexeddb",
                });
                worker.onerror = (event): void => {
                    // The SDK's doCmd() only settles when the worker replies, so
                    // a worker that never loads would hang startup rather than
                    // throw. MatrixClientManager guards that with a timeout;
                    // this just makes the cause visible.
                    console.error("matrix indexeddb worker failed to load", event.message || event);
                };
                return worker;
            },
        });
    } else if (localStorageRef) {
        storeOpts.store = new MemoryStore({ localStorage: localStorageRef });
    }

    if (indexedDBFactory) {
        storeOpts.cryptoStore = new IndexedDBCryptoStore(indexedDBFactory, "matrix-js-sdk:crypto");
    } else if (localStorageRef) {
        storeOpts.cryptoStore = new LocalStorageCryptoStore(localStorageRef);
    } else {
        storeOpts.cryptoStore = new MemoryCryptoStore();
    }

    return createClient({
        ...storeOpts,
        ...opts,
    });
}
