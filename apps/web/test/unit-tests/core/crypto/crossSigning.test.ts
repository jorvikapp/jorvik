import { describe, expect, it, vi } from "vitest";
import { encodeRecoveryKey } from "matrix-js-sdk/src/crypto-api/recovery-key";

import { coreCryptoCallbacks } from "../../../../src/core/client/cryptoCallbacks";
import {
    completeCrossSigningWithRecoveryKey,
    finishSetupWithRecoveryKey,
    getCrossSigningSituation,
    requestCrossSigningKeysFromOtherSessions,
    resetCrossSigningIdentity,
    StaleCrossSigningKeysError,
} from "../../../../src/core/crypto/crossSigning";
import { bootstrapSecretStorageSetup, newKeyReplacesKeyBackup } from "../../../../src/core/crypto/securityRecoveryFlow";

const ME = "@me:x";
const KEY_ID = "ssss-key";
const KEY_INFO = { algorithm: "m.secret_storage.v1.aes-hmac-sha2" };
const RIGHT_KEY = new Uint8Array(32).fill(7);
const RECOVERY_KEY = encodeRecoveryKey(RIGHT_KEY)!;
const WRONG_RECOVERY_KEY = encodeRecoveryKey(new Uint8Array(32).fill(9))!;

interface FakeState {
    cached: boolean;
    inSecretStorage: boolean;
    onServer: boolean;
    hasSecretStorage: boolean;
    backupVersion: string | null;
    /** This session holds the backup's key, so a new security key can take the backup along. */
    holdsBackupKey: boolean;
    password: string;
}

/** Asks the app's crypto callbacks for the secret storage key, as the SDK does mid-bootstrap. */
async function keySuppliedToSdk(): Promise<number[]> {
    const [, key] = await coreCryptoCallbacks.getSecretStorageKey!({ keys: { [KEY_ID]: KEY_INFO as never } }, "m.cross_signing.master");
    return Array.from(key);
}

function makeClient(initial: Partial<FakeState> = {}) {
    const state: FakeState = {
        cached: false,
        inSecretStorage: false,
        onServer: false,
        hasSecretStorage: true,
        backupVersion: "1",
        holdsBackupKey: true,
        password: "right password",
        ...initial,
    };
    const calls: string[] = [];
    const keysSeen: number[][] = [];
    const uiaAttempts: unknown[] = [];

    // Synapse: replacing existing keys needs the password; a first upload does not (MSC3967).
    const uploadSigningKeys = async (auth: Record<string, unknown> | null): Promise<void> => {
        uiaAttempts.push(auth);
        if (state.onServer && !auth) {
            throw Object.assign(new Error("UIA"), { httpStatus: 401, data: { session: "uia-1" } });
        }
        if (auth && auth.password !== state.password) {
            throw Object.assign(new Error("Invalid password"), { httpStatus: 401, errcode: "M_FORBIDDEN" });
        }
    };

    const crypto = {
        getCrossSigningStatus: vi.fn(async () => ({
            publicKeysOnDevice: state.onServer,
            privateKeysInSecretStorage: state.inSecretStorage,
            privateKeysCachedLocally: { masterKey: state.cached, selfSigningKey: state.cached, userSigningKey: state.cached },
        })),
        userHasCrossSigningKeys: vi.fn(async () => state.onServer),
        getKeyBackupInfo: vi.fn(async () => (state.backupVersion ? { version: state.backupVersion } : null)),
        isKeyBackupTrusted: vi.fn(async () => ({ trusted: state.holdsBackupKey, matchesDecryptionKey: state.holdsBackupKey })),
        bootstrapCrossSigning: vi.fn(
            async (opts: { setupNewCrossSigning?: boolean; authUploadDeviceSigningKeys?: (makeRequest: never) => Promise<void> }) => {
                calls.push(opts.setupNewCrossSigning ? "bootstrapCrossSigning(new)" : "bootstrapCrossSigning");
                if (state.hasSecretStorage) {
                    keysSeen.push(await keySuppliedToSdk());
                }
                if (opts.setupNewCrossSigning || (!state.cached && !state.inSecretStorage)) {
                    await opts.authUploadDeviceSigningKeys!(uploadSigningKeys as never);
                    state.onServer = true;
                }
                state.cached = true;
                state.inSecretStorage = state.hasSecretStorage;
            },
        ),
        bootstrapSecretStorage: vi.fn(async (opts: { setupNewSecretStorage?: boolean; setupNewKeyBackup?: boolean }) => {
            calls.push(`bootstrapSecretStorage(new storage: ${Boolean(opts.setupNewSecretStorage)}, new backup: ${Boolean(opts.setupNewKeyBackup)})`);
            keysSeen.push(await keySuppliedToSdk());
            state.hasSecretStorage = true;
            if (opts.setupNewKeyBackup) {
                state.backupVersion = "2";
                state.holdsBackupKey = true;
            }
        }),
    };

    const authedRequest = vi.fn(async (_method: string, path: string, _query: unknown, body: { auth?: { password?: string; session?: string } }) => {
        calls.push(`POST ${path}`);
        if (!body.auth) {
            throw Object.assign(new Error("UIA"), { httpStatus: 401, data: { session: "uia-check" } });
        }
        if (body.auth.password !== state.password || body.auth.session !== "uia-check") {
            throw Object.assign(new Error("Invalid password"), { httpStatus: 401, errcode: "M_FORBIDDEN" });
        }
        return {};
    });

    const client = {
        getUserId: () => ME,
        getSafeUserId: () => ME,
        getCrypto: () => crypto,
        http: { authedRequest },
        secretStorage: {
            getDefaultKeyId: vi.fn(async () => (state.hasSecretStorage ? KEY_ID : null)),
            getKey: vi.fn(async (keyId: string) => [keyId, KEY_INFO]),
            checkKey: vi.fn(async (key: Uint8Array) => key.every((byte, index) => byte === RIGHT_KEY[index])),
        },
    };
    return { client: client as never, crypto, state, calls, keysSeen, uiaAttempts, authedRequest };
}

describe("getCrossSigningSituation", () => {
    it.each([
        [{ cached: true, inSecretStorage: true, onServer: true }, "ready"],
        [{ cached: true, inSecretStorage: false, onServer: true }, "unsaved"],
        [{ cached: false, inSecretStorage: false, onServer: false }, "missing"],
        [{ cached: false, inSecretStorage: true, onServer: true }, "in_secret_storage"],
        [{ cached: false, inSecretStorage: false, onServer: true }, "on_other_device"],
    ] as const)("%o is %s", async (setup, expected) => {
        const { client } = makeClient(setup);
        expect(await getCrossSigningSituation(client)).toBe(expected);
    });

    it("does not count keys made here that never reached the server", async () => {
        const { client } = makeClient({ cached: true, inSecretStorage: true, onServer: false });
        expect(await getCrossSigningSituation(client)).toBe("missing");
    });

    it("asks the server whether the account has keys, not a cached copy", async () => {
        const { client, crypto } = makeClient();
        await getCrossSigningSituation(client);
        expect(crypto.userHasCrossSigningKeys).toHaveBeenCalledWith(ME, true);
    });
});

describe("completeCrossSigningWithRecoveryKey", () => {
    it("never bootstraps when only another session has the keys, since that would replace them", async () => {
        const { client, crypto } = makeClient({ onServer: true });
        await expect(completeCrossSigningWithRecoveryKey(client, RECOVERY_KEY)).rejects.toThrow(/another session/);
        expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    });

    it("creates missing keys without a password and saves them with the existing key", async () => {
        const { client, calls, keysSeen, uiaAttempts, state } = makeClient();
        await completeCrossSigningWithRecoveryKey(client, RECOVERY_KEY);
        expect(calls).toEqual(["bootstrapCrossSigning(new)"]);
        expect(uiaAttempts).toEqual([null]);
        expect(keysSeen).toEqual([Array.from(RIGHT_KEY)]);
        expect(state).toMatchObject({ cached: true, inSecretStorage: true, onServer: true });
    });

    it("imports keys from secret storage", async () => {
        const { client, calls, uiaAttempts } = makeClient({ onServer: true, inSecretStorage: true });
        await completeCrossSigningWithRecoveryKey(client, RECOVERY_KEY);
        expect(calls).toEqual(["bootstrapCrossSigning"]);
        expect(uiaAttempts).toEqual([]);
    });

    it("reports saved keys that no longer match the account", async () => {
        const { client, crypto } = makeClient({ onServer: true, inSecretStorage: true });
        crypto.bootstrapCrossSigning.mockRejectedValueOnce(new Error("importCrossSigningKeys failed to import the keys"));
        await expect(completeCrossSigningWithRecoveryKey(client, RECOVERY_KEY)).rejects.toBeInstanceOf(StaleCrossSigningKeysError);
    });

    it("refuses a recovery key that does not unlock secret storage", async () => {
        const { client, crypto } = makeClient();
        await expect(completeCrossSigningWithRecoveryKey(client, WRONG_RECOVERY_KEY)).rejects.toThrow(/doesn't unlock/);
        await expect(completeCrossSigningWithRecoveryKey(client, "not a key")).rejects.toThrow(/not a valid security key/);
        expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    });

    it("does nothing when everything is already set up", async () => {
        const { client, crypto } = makeClient({ cached: true, inSecretStorage: true, onServer: true });
        await completeCrossSigningWithRecoveryKey(client, WRONG_RECOVERY_KEY);
        expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    });
});

describe("resetCrossSigningIdentity", () => {
    it("checks the password before anything is written", async () => {
        const { client, crypto } = makeClient({ onServer: true });
        await expect(resetCrossSigningIdentity(client, "wrong password", RECOVERY_KEY)).rejects.toThrow("That password is not right.");
        expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    });

    it("checks the recovery key before the password", async () => {
        const { client, authedRequest } = makeClient({ onServer: true });
        await expect(resetCrossSigningIdentity(client, "right password", WRONG_RECOVERY_KEY)).rejects.toThrow(/doesn't unlock/);
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("replaces the keys with the password and saves them under the existing key", async () => {
        const { client, calls, keysSeen, uiaAttempts, authedRequest } = makeClient({ onServer: true });
        await resetCrossSigningIdentity(client, "right password", RECOVERY_KEY);
        expect(calls).toEqual(["POST /delete_devices", "POST /delete_devices", "bootstrapCrossSigning(new)"]);
        expect(authedRequest.mock.calls[0][3]).toEqual({ devices: [] });
        expect(uiaAttempts).toEqual([
            null,
            { type: "m.login.password", identifier: { type: "m.id.user", user: ME }, password: "right password", session: "uia-1" },
        ]);
        expect(keysSeen).toEqual([Array.from(RIGHT_KEY)]);
    });

    it("passes on errors that are not about the password", async () => {
        const { client, authedRequest, crypto } = makeClient({ onServer: true });
        authedRequest.mockRejectedValueOnce(Object.assign(new Error("slow down"), { httpStatus: 429 }));
        await expect(resetCrossSigningIdentity(client, "right password", RECOVERY_KEY)).rejects.toThrow("slow down");
        expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    });
});

describe("finishSetupWithRecoveryKey", () => {
    it("sets up cross-signing before a new backup, so the backup is signed with it", async () => {
        const { client, calls } = makeClient({ backupVersion: null });
        await finishSetupWithRecoveryKey(client, RECOVERY_KEY);
        expect(calls).toEqual(["bootstrapCrossSigning(new)", "bootstrapSecretStorage(new storage: false, new backup: true)"]);
    });

    it("leaves keys held by another session alone and only adds the missing backup", async () => {
        const { client, calls } = makeClient({ onServer: true, backupVersion: null });
        await finishSetupWithRecoveryKey(client, RECOVERY_KEY);
        expect(calls).toEqual(["bootstrapSecretStorage(new storage: false, new backup: true)"]);
    });

    it("does nothing when there is nothing to finish", async () => {
        const { client, calls } = makeClient({ onServer: true });
        await finishSetupWithRecoveryKey(client, RECOVERY_KEY);
        expect(calls).toEqual([]);
    });
});

describe("bootstrapSecretStorageSetup", () => {
    const newKey = () => ({ privateKey: new Uint8Array(RIGHT_KEY), encodedPrivateKey: RECOVERY_KEY, keyInfo: {} });

    it("creates cross-signing for an account that has none, after the new secret storage", async () => {
        const { client, calls, uiaAttempts, state } = makeClient({ hasSecretStorage: false, backupVersion: null });
        await bootstrapSecretStorageSetup(client, newKey() as never);
        expect(calls).toEqual(["bootstrapSecretStorage(new storage: true, new backup: true)", "bootstrapCrossSigning(new)"]);
        expect(uiaAttempts).toEqual([null]);
        expect(state).toMatchObject({ cached: true, inSecretStorage: true, onServer: true });
    });

    it("still finishes setup if creating cross-signing fails, so the key is not made twice", async () => {
        const { client, crypto, state } = makeClient({ hasSecretStorage: false, backupVersion: null });
        crypto.bootstrapCrossSigning.mockRejectedValueOnce(new Error("network down"));
        await bootstrapSecretStorageSetup(client, newKey() as never);
        expect(state).toMatchObject({ hasSecretStorage: true, backupVersion: "2", onServer: false });
    });

    it("does not touch keys that exist elsewhere", async () => {
        const { client, calls } = makeClient({ hasSecretStorage: false, onServer: true });
        await bootstrapSecretStorageSetup(client, newKey() as never);
        expect(calls).toEqual(["bootstrapSecretStorage(new storage: true, new backup: false)"]);
    });

    it("keeps a backup this session can open, so the SDK moves its key under the new one", async () => {
        const { client, calls, state } = makeClient({ backupVersion: "1", holdsBackupKey: true });
        await bootstrapSecretStorageSetup(client, newKey() as never);
        expect(calls[0]).toBe("bootstrapSecretStorage(new storage: true, new backup: false)");
        expect(state.backupVersion).toBe("1");
    });

    it("replaces a backup this session cannot open, or the new key would be refused at the next sign-in", async () => {
        const { client, calls, state } = makeClient({ backupVersion: "1", holdsBackupKey: false });
        await bootstrapSecretStorageSetup(client, newKey() as never);
        expect(calls).toEqual(["bootstrapSecretStorage(new storage: true, new backup: true)", "bootstrapCrossSigning(new)"]);
        expect(state).toMatchObject({ backupVersion: "2", holdsBackupKey: true, onServer: true });
    });
});

describe("newKeyReplacesKeyBackup", () => {
    it("is false without a backup", async () => {
        expect(await newKeyReplacesKeyBackup(makeClient({ backupVersion: null }).client)).toBe(false);
    });

    it("is false when this session holds the backup's key", async () => {
        expect(await newKeyReplacesKeyBackup(makeClient({ holdsBackupKey: true }).client)).toBe(false);
    });

    it("is true when this session cannot open the backup", async () => {
        expect(await newKeyReplacesKeyBackup(makeClient({ holdsBackupKey: false }).client)).toBe(true);
    });
});

describe("requestCrossSigningKeysFromOtherSessions", () => {
    it("asks the other sessions and sends the request straight away", async () => {
        const requestMissingSecretsIfNeeded = vi.fn(async () => true);
        const doProcessOutgoingRequests = vi.fn(async () => undefined);
        const client = { getCrypto: () => ({ olmMachine: { requestMissingSecretsIfNeeded }, outgoingRequestsManager: { doProcessOutgoingRequests } }) };
        await requestCrossSigningKeysFromOtherSessions(client as never);
        expect(requestMissingSecretsIfNeeded).toHaveBeenCalledOnce();
        expect(doProcessOutgoingRequests).toHaveBeenCalledOnce();
    });

    it("sends nothing when no secret is missing", async () => {
        const doProcessOutgoingRequests = vi.fn(async () => undefined);
        const client = {
            getCrypto: () => ({ olmMachine: { requestMissingSecretsIfNeeded: async () => false }, outgoingRequestsManager: { doProcessOutgoingRequests } }),
        };
        await requestCrossSigningKeysFromOtherSessions(client as never);
        expect(doProcessOutgoingRequests).not.toHaveBeenCalled();
    });
});
