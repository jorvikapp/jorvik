import { decodeRecoveryKey } from "matrix-js-sdk/src/crypto-api/recovery-key";
import { Method, type MatrixClient, type UIAuthCallback } from "matrix-js-sdk/src/matrix";

import { withSecretStorageKeyProvider } from "../client/cryptoCallbacks";

/**
 * Where this account's cross-signing keys are, as far as this session can tell.
 *
 * Jorvik used to set up secret storage and key backup but never cross-signing,
 * so Element could "verify" against the recovery key and still find nothing to
 * sign with. Everything here keeps one rule: existing keys are never replaced
 * behind the user's back. The SDK's bootstrapCrossSigning would do exactly that
 * when the keys exist but are neither on this device nor in secret storage, so
 * that case is only ever handled by verification or an explicit reset.
 *
 * - ready: this device holds the keys and secret storage has them too.
 * - unsaved: this device holds them, secret storage does not (e.g. received
 *   from another device): the recovery key saves them.
 * - missing: the server has none: create them (no password needed, MSC3967,
 *   which also means this can never replace existing keys without one).
 * - in_secret_storage: the recovery key imports them.
 * - on_other_device: only another session has them (or nobody): verify from
 *   it, or reset with the account password.
 */
export type CrossSigningSituation = "ready" | "unsaved" | "missing" | "in_secret_storage" | "on_other_device";

export async function getCrossSigningSituation(client: MatrixClient): Promise<CrossSigningSituation | null> {
    const crypto = client.getCrypto();
    const userId = client.getUserId();
    if (!crypto || !userId) {
        return null;
    }

    // The server first: keys created here but never uploaded do not count.
    if (!(await crypto.userHasCrossSigningKeys(userId, true))) {
        return "missing";
    }
    const status = await crypto.getCrossSigningStatus();
    const cached = status.privateKeysCachedLocally;
    if (cached.masterKey && cached.selfSigningKey && cached.userSigningKey) {
        return status.privateKeysInSecretStorage ? "ready" : "unsaved";
    }
    return status.privateKeysInSecretStorage ? "in_secret_storage" : "on_other_device";
}

/**
 * Secret storage holds signing keys that no longer match the account's public
 * ones: what a reset interrupted between saving and uploading leaves behind.
 * Only verification or another reset can fix it.
 */
export class StaleCrossSigningKeysError extends Error {
    public constructor() {
        super("The signing keys saved with your security key don't match your account. Verify from another session, or reset your identity.");
        this.name = "StaleCrossSigningKeysError";
    }
}

interface UnlockedSecretStorageKey {
    keyId: string;
    privateKey: Uint8Array<ArrayBuffer>;
}

/** Turns a recovery key into the secret storage key it unlocks, or explains why not. */
export async function unlockSecretStorage(client: MatrixClient, recoveryKey: string): Promise<UnlockedSecretStorageKey> {
    const keyId = await client.secretStorage.getDefaultKeyId();
    if (!keyId) {
        throw new Error("This account has no security key yet.");
    }
    const keyInfo = await client.secretStorage.getKey(keyId);
    let privateKey: Uint8Array<ArrayBuffer>;
    try {
        privateKey = decodeRecoveryKey(recoveryKey.trim()) as Uint8Array<ArrayBuffer>;
    } catch {
        throw new Error("That is not a valid security key.");
    }
    if (!keyInfo || !(await client.secretStorage.checkKey(privateKey, keyInfo[1]))) {
        privateKey.fill(0);
        throw new Error("That security key doesn't unlock this account.");
    }
    return { keyId, privateKey };
}

function withKey<T>(key: UnlockedSecretStorageKey, run: () => Promise<T>): Promise<T> {
    return withSecretStorageKeyProvider(async ({ keyIds }) => [keyIds.includes(key.keyId) ? key.keyId : keyIds[0], key.privateKey], run);
}

/** First-time upload needs no password on Synapse (MSC3967). */
const uploadWithoutPassword: UIAuthCallback<void> = async (makeRequest) => {
    await makeRequest(null);
};

function uploadWithPassword(userId: string, password: string): UIAuthCallback<void> {
    return async (makeRequest) => {
        try {
            await makeRequest(null);
        } catch (error) {
            const session = (error as { data?: { session?: unknown } }).data?.session;
            if ((error as { httpStatus?: number }).httpStatus !== 401 || typeof session !== "string") {
                throw error;
            }
            await makeRequest({ type: "m.login.password", identifier: { type: "m.id.user", user: userId }, password, session });
        }
    };
}

/**
 * With the account's recovery key: creates the keys if the account has none,
 * imports them if secret storage has them, or saves them there if only this
 * device has them. Refuses when the keys exist only elsewhere.
 */
export async function completeCrossSigningWithRecoveryKey(client: MatrixClient, recoveryKey: string): Promise<void> {
    const crypto = client.getCrypto();
    if (!crypto) {
        throw new Error("Encryption is not available for this session.");
    }
    const situation = await getCrossSigningSituation(client);
    if (situation === "ready" || situation === null) {
        return;
    }
    if (situation === "on_other_device") {
        throw new Error("Your signing keys are on another session. Verify this one from it, or reset your identity.");
    }

    const key = await unlockSecretStorage(client, recoveryKey);
    try {
        if (situation === "unsaved") {
            // Save this device's keys under the account's key. bootstrapCrossSigning
            // reads the saved copy first, and a key change made from a session
            // without the keys leaves one under the old key: "bad MAC".
            // This also saves the device's backup key, so refresh which backup
            // is current first, or an old backup's key replaces the right one.
            await crypto.checkKeyBackupAndEnable();
            await withKey(key, () => crypto.bootstrapSecretStorage({}));
        } else {
            await withKey(key, () =>
                crypto.bootstrapCrossSigning({
                    // Fresh keys for an account without any, even if an earlier
                    // attempt left some here that never reached the server.
                    setupNewCrossSigning: situation === "missing",
                    authUploadDeviceSigningKeys: uploadWithoutPassword,
                }),
            );
        }
    } catch (error) {
        if (situation === "in_secret_storage" && String((error as Error | undefined)?.message).includes("importCrossSigningKeys failed")) {
            throw new StaleCrossSigningKeysError();
        }
        throw error;
    } finally {
        key.privateKey.fill(0);
    }
    if ((await getCrossSigningSituation(client)) !== "ready") {
        throw new Error("Setting up your signing keys didn't finish. Try again.");
    }
}

/** Turns on key backup under the account's existing secret storage key, instead of a new key. */
export async function createKeyBackupWithRecoveryKey(client: MatrixClient, recoveryKey: string): Promise<void> {
    const crypto = client.getCrypto();
    if (!crypto) {
        throw new Error("Encryption is not available for this session.");
    }
    const key = await unlockSecretStorage(client, recoveryKey);
    try {
        await withKey(key, () => crypto.bootstrapSecretStorage({ setupNewSecretStorage: false, setupNewKeyBackup: true }));
    } finally {
        key.privateKey.fill(0);
    }
}

/**
 * Everything the account's existing recovery key can finish on this session:
 * cross-signing (unless only another session has the keys) and a key backup
 * if the account has none. Cross-signing goes first so a new backup is signed
 * with it.
 */
export async function finishSetupWithRecoveryKey(client: MatrixClient, recoveryKey: string): Promise<void> {
    const crypto = client.getCrypto();
    if (!crypto) {
        throw new Error("Encryption is not available for this session.");
    }
    if ((await getCrossSigningSituation(client)) !== "on_other_device") {
        await completeCrossSigningWithRecoveryKey(client, recoveryKey);
    }
    if (!(await crypto.getKeyBackupInfo())?.version) {
        await createKeyBackupWithRecoveryKey(client, recoveryKey);
    }
}

/**
 * Proves the password with a request that changes nothing: deleting zero
 * devices still needs the password. A reset writes the new keys to secret
 * storage before uploading them, so a wrong password must be caught first.
 */
async function checkPassword(client: MatrixClient, password: string): Promise<void> {
    const userId = client.getSafeUserId();
    try {
        await client.http.authedRequest(Method.Post, "/delete_devices", undefined, { devices: [] });
        return;
    } catch (error) {
        const session = (error as { data?: { session?: unknown } }).data?.session;
        if ((error as { httpStatus?: number }).httpStatus !== 401 || typeof session !== "string") {
            throw error;
        }
        try {
            await client.http.authedRequest(Method.Post, "/delete_devices", undefined, {
                devices: [],
                auth: { type: "m.login.password", identifier: { type: "m.id.user", user: userId }, password, session },
            });
        } catch (authError) {
            const status = (authError as { httpStatus?: number }).httpStatus;
            if (status === 401 || status === 403) {
                throw new Error("That password is not right.");
            }
            throw authError;
        }
    }
}

/**
 * Replaces the account's cross-signing identity: only for when the old keys
 * are gone. Needs the password (replacing keys requires it) and the recovery
 * key, so the new keys land in secret storage where other clients find them.
 */
export async function resetCrossSigningIdentity(client: MatrixClient, password: string, recoveryKey: string): Promise<void> {
    const crypto = client.getCrypto();
    if (!crypto) {
        throw new Error("Encryption is not available for this session.");
    }
    const key = await unlockSecretStorage(client, recoveryKey);
    try {
        await checkPassword(client, password);
        await withKey(key, () =>
            crypto.bootstrapCrossSigning({
                setupNewCrossSigning: true,
                authUploadDeviceSigningKeys: uploadWithPassword(client.getSafeUserId(), password),
            }),
        );
    } finally {
        key.privateKey.fill(0);
    }
    if ((await getCrossSigningSituation(client)) !== "ready") {
        throw new Error("The reset did not finish. Try again.");
    }
}

/**
 * After this session is verified from another one, ask it for the signing keys,
 * in case the SDK has not already done so.
 */
export async function requestCrossSigningKeysFromOtherSessions(client: MatrixClient): Promise<void> {
    const crypto = client.getCrypto() as unknown as
        | {
              olmMachine?: { requestMissingSecretsIfNeeded?: () => Promise<boolean> };
              outgoingRequestsManager?: { doProcessOutgoingRequests?: () => Promise<void> };
          }
        | undefined;
    try {
        if (await crypto?.olmMachine?.requestMissingSecretsIfNeeded?.()) {
            // Otherwise the request only goes out after the next sync.
            await crypto?.outgoingRequestsManager?.doProcessOutgoingRequests?.();
        }
    } catch {
        // Best effort: after a self-verification the SDK often asks on its own,
        // and asking again for a secret already requested fails in its store.
    }
}

/** Waits for keys asked for from another session to arrive; returns the situation at the end. */
export async function waitForCrossSigningKeys(client: MatrixClient, timeoutMs: number): Promise<CrossSigningSituation | null> {
    const deadline = Date.now() + timeoutMs;
    let situation = await getCrossSigningSituation(client);
    while (situation === "on_other_device" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        situation = await getCrossSigningSituation(client);
    }
    return situation;
}
