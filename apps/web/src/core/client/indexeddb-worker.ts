/**
 * Web worker entry point for the matrix-js-sdk IndexedDB store.
 *
 * Without this, IndexedDBStore uses LocalIndexedDBStoreBackend and serializes
 * the entire accumulated sync state on the main thread on every save. That cost
 * grows with session length; Gecko's IndexedDB and structured-clone path is
 * slow enough at it to lock the UI for seconds at a time, while Chromium
 * absorbs it. Running the backend here keeps that work off the main thread on
 * every engine.
 */
import { IndexedDBStoreWorker } from "matrix-js-sdk/src/indexeddb-worker";

const workerScope = globalThis as unknown as Worker;
const remoteWorker = new IndexedDBStoreWorker(workerScope.postMessage.bind(workerScope));

workerScope.onmessage = remoteWorker.onMessage;
