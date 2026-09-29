import {
    type ICreateClientOpts,
    type IStartClientOpts,
    type MatrixClient,
    type TokenRefreshFunction,
    MemoryStore,
    PendingEventOrdering,
    type User,
    UserEvent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import type { MatrixClientAssignOpts, MatrixCredentials } from "../types/credentials";
import { createMatrixClient } from "./createMatrixClient";
import { coreCryptoCallbacks } from "./cryptoCallbacks";

/**
 * The store backend talks to its web worker over postMessage and only settles
 * once the worker replies, so a worker that never loads leaves startup pending
 * forever instead of throwing. Time it out so the MemoryStore fallback below
 * can actually run.
 */
const STORE_STARTUP_TIMEOUT_MS = 15_000;

const ownUsersForwarded = new WeakSet<User>();

/**
 * startClient stores our own User as a bare `new User(userId)`, whereas every
 * other User comes from User.createUser, which re-emits its events on the
 * client. So our own presence changes never reached client-level listeners:
 * choosing Idle updated the User, but the member list and profiles kept
 * showing the old status until something else re-rendered them.
 */
export function forwardOwnUserEvents(client: MatrixClient): void {
    const userId = client.getUserId();
    const user = userId ? client.getUser(userId) : null;
    if (!user || ownUsersForwarded.has(user)) {
        return;
    }

    ownUsersForwarded.add(user);
    client.reEmitter.reEmit(user, [
        UserEvent.AvatarUrl,
        UserEvent.DisplayName,
        UserEvent.Presence,
        UserEvent.CurrentlyActive,
        UserEvent.LastPresenceTs,
    ]);
}

async function startupWithTimeout(startup: () => Promise<void>, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        await Promise.race([
            startup(),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`store startup timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

export interface MatrixClientManagerOptions {
    initialSyncLimit?: number;
    lazyLoadMembers?: boolean;
    initRustCrypto?: boolean;
}

export class MatrixClientManager {
    private matrixClient: MatrixClient | null = null;
    private readonly lazyLoadMembers: boolean;
    private readonly rustCryptoEnabled: boolean;

    public readonly startOptions: IStartClientOpts;

    public constructor(options: MatrixClientManagerOptions = {}) {
        this.startOptions = {
            initialSyncLimit: options.initialSyncLimit ?? 20,
        };
        this.lazyLoadMembers = options.lazyLoadMembers ?? true;
        this.rustCryptoEnabled = options.initRustCrypto !== false;
    }

    public get(): MatrixClient | null {
        return this.matrixClient;
    }

    public safeGet(): MatrixClient {
        if (!this.matrixClient) {
            throw new Error("Matrix client has not been created yet");
        }

        return this.matrixClient;
    }

    public replaceUsingCreds(creds: MatrixCredentials, tokenRefreshFunction?: TokenRefreshFunction): void {
        this.createClient(creds, tokenRefreshFunction);
    }

    public unset(): void {
        this.matrixClient = null;
    }

    public stop(unset = true): void {
        if (!this.matrixClient) {
            return;
        }

        this.matrixClient.stopClient();
        this.matrixClient.removeAllListeners();
        this.matrixClient.store.destroy();

        if (unset) {
            this.unset();
        }
    }

    public async assign(assignOpts: MatrixClientAssignOpts = {}): Promise<IStartClientOpts> {
        if (!this.matrixClient) {
            throw new Error("createClient must be called before assign");
        }

        for (const dbType of ["indexeddb", "memory"]) {
            try {
                if (dbType === "indexeddb") {
                    await startupWithTimeout(() => this.matrixClient!.store.startup(), STORE_STARTUP_TIMEOUT_MS);
                } else {
                    await this.matrixClient.store.startup();
                }
                break;
            } catch (error) {
                if (dbType === "indexeddb") {
                    logger.warn("Matrix store startup failed, falling back to MemoryStore", error);
                    this.matrixClient.store = new MemoryStore({ localStorage: window.localStorage });
                } else {
                    throw error;
                }
            }
        }

        if (this.rustCryptoEnabled) {
            await this.initClientCrypto(assignOpts);
        }

        const opts: IStartClientOpts = {
            ...this.startOptions,
            pendingEventOrdering: PendingEventOrdering.Detached,
            lazyLoadMembers: this.lazyLoadMembers,
            threadSupport: true,
            clientWellKnownPollPeriod: 2 * 60 * 60,
        };

        return opts;
    }

    public async start(assignOpts: MatrixClientAssignOpts = {}): Promise<void> {
        const opts = await this.assign(assignOpts);
        const client = this.safeGet();
        await client.startClient(opts);
        forwardOwnUserEvents(client);
    }

    private createClient(creds: MatrixCredentials, tokenRefreshFunction?: TokenRefreshFunction): void {
        const opts: ICreateClientOpts = {
            baseUrl: creds.homeserverUrl,
            idBaseUrl: creds.identityServerUrl,
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            tokenRefreshFunction,
            userId: creds.userId,
            deviceId: creds.deviceId,
            pickleKey: creds.pickleKey,
            timelineSupport: true,
            cryptoCallbacks: { ...coreCryptoCallbacks },
        };

        this.matrixClient = createMatrixClient(opts);
        this.matrixClient.setGuest(Boolean(creds.guest));
    }

    private async initClientCrypto(assignOpts: MatrixClientAssignOpts): Promise<void> {
        if (!this.matrixClient) {
            throw new Error("createClient must be called before initClientCrypto");
        }

        await this.matrixClient.initRustCrypto({
            storageKey: assignOpts.rustCryptoStoreKey,
            storagePassword: assignOpts.rustCryptoStorePassword,
        });
    }
}
