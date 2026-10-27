import { encodeUnpaddedBase64 } from "matrix-js-sdk/src/base64";

import { buildAndEncodePickleKey, encryptPickleKey, type EncryptedPickleKey } from "../storage/pickling";
import { idbDelete, idbLoad, idbSave } from "../storage/storageAccess";

export class WebPlatform {
    public async getPickleKey(userId: string, deviceId: string): Promise<string | null> {
        const data = await idbLoad<EncryptedPickleKey>("pickleKey", [userId, deviceId]);
        const pickledKey = await buildAndEncodePickleKey(data, userId, deviceId);
        return pickledKey ?? null;
    }

    public async createPickleKey(userId: string, deviceId: string): Promise<string | null> {
        if (!crypto?.subtle) {
            return null;
        }

        const randomKey = new Uint8Array(32);
        crypto.getRandomValues(randomKey);

        const encrypted = await encryptPickleKey(randomKey, userId, deviceId);
        if (!encrypted) {
            return null;
        }

        await idbSave("pickleKey", [userId, deviceId], encrypted);
        return encodeUnpaddedBase64(randomKey);
    }

    public async destroyPickleKey(userId: string, deviceId: string): Promise<void> {
        await idbDelete("pickleKey", [userId, deviceId]);
    }
}
