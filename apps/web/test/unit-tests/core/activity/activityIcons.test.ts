// @vitest-environment node
// (jsdom's ArrayBuffers aren't the ones Node's WebCrypto accepts.)
import * as encrypt from "matrix-encrypt-attachment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    clearGameIconUrls,
    loadGameIconUrl,
    peekGameIconUrl,
    rememberedGameIcon,
    uploadGameIcon,
} from "../../../../src/core/activity/activityIcons";
import { cleanIcon, type ActivityIconFile } from "../../../../src/core/activity/activityWire";

// A 1x1 PNG.
const PNG = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
    (char) => char.charCodeAt(0),
);

function fakeClient() {
    return {
        uploadContent: vi.fn(async (_blob: Blob) => ({ content_uri: "mxc://s/uploaded" })),
        mxcUrlToHttp: (mxc: string, _w?: number, _h?: number, _m?: string, _d?: boolean, _r?: boolean, auth?: boolean) =>
            `https://hs.example/_matrix/${auth ? "client/v1/media" : "media/v3"}/download/${mxc.slice("mxc://".length)}`,
        getAccessToken: () => "TOKEN",
    };
}

async function encryptedIcon(data: Uint8Array): Promise<{ icon: ActivityIconFile; ciphertext: ArrayBuffer }> {
    const encrypted = await encrypt.encryptAttachment(data.slice().buffer);
    const icon = cleanIcon({ ...encrypted.info, url: "mxc://other.example/icon" });
    if (!icon) {
        throw new Error("encryptAttachment made an icon cleanIcon refuses");
    }
    return { icon, ciphertext: encrypted.data };
}

let objectUrls = 0;
const storage = new Map<string, string>();

beforeEach(() => {
    objectUrls = 0;
    storage.clear();
    vi.stubGlobal("window", {
        localStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => void storage.set(key, value),
        },
    });
    URL.createObjectURL = vi.fn(() => `blob:icon-${++objectUrls}`);
    URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
    clearGameIconUrls();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("sending a game's icon", () => {
    it("uploads it encrypted, once, and remembers it for that account only", async () => {
        const client = fakeClient();
        const [first, second] = await Promise.all([
            uploadGameIcon(client as never, "@me:s", "steam-413150", PNG),
            uploadGameIcon(client as never, "@me:s", "steam-413150", PNG),
        ]);
        expect(client.uploadContent).toHaveBeenCalledTimes(1);
        expect(first).toEqual(second);
        expect(first).toMatchObject({ url: "mxc://s/uploaded", v: "v2", key: { alg: "A256CTR" } });

        // What the homeserver got isn't the picture.
        const uploaded = new Uint8Array(await (client.uploadContent.mock.calls[0][0] as Blob).arrayBuffer());
        expect(uploaded).toHaveLength(PNG.length);
        expect(uploaded).not.toEqual(PNG);

        expect(rememberedGameIcon("@me:s", "steam-413150")).toEqual(first);
        expect(rememberedGameIcon("@someone-else:s", "steam-413150")).toBeNull();
        expect(rememberedGameIcon("@me:s", "steam-570")).toBeNull();
        // The user's own icon shows from the picture they have, without a download.
        expect(peekGameIconUrl(first!)).toMatch(/^blob:/);
    });

    it("rejects when the upload fails, so the next game run tries again", async () => {
        const client = fakeClient();
        client.uploadContent.mockRejectedValueOnce(new Error("M_LIMIT_EXCEEDED"));
        await expect(uploadGameIcon(client as never, "@me:s", "steam-1", PNG)).rejects.toThrow("M_LIMIT_EXCEEDED");
        expect(rememberedGameIcon("@me:s", "steam-1")).toBeNull();
        await expect(uploadGameIcon(client as never, "@me:s", "steam-1", PNG)).resolves.toMatchObject({ url: "mxc://s/uploaded" });
    });
});

describe("showing someone's game icon", () => {
    it("downloads it from the user's own homeserver with their token, decrypts it, and keeps it", async () => {
        const { icon, ciphertext } = await encryptedIcon(PNG);
        const fetchMock = vi.fn(async () => new Response(ciphertext.slice(0)));
        vi.stubGlobal("fetch", fetchMock);

        expect(peekGameIconUrl(icon)).toBeUndefined();
        const [url, again] = await Promise.all([loadGameIconUrl(fakeClient() as never, icon), loadGameIconUrl(fakeClient() as never, icon)]);
        expect(url).toBe("blob:icon-1");
        expect(again).toBe(url);
        expect(await loadGameIconUrl(fakeClient() as never, icon)).toBe(url);
        expect(peekGameIconUrl(icon)).toBe(url);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("https://hs.example/_matrix/client/v1/media/download/other.example/icon", {
            headers: { Authorization: "Bearer TOKEN" },
        });
    });

    it("refuses something that isn't a PNG, is too big, or doesn't match its hash, and tries again later", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const notPng = await encryptedIcon(new TextEncoder().encode("<svg onload=alert(1)>"));
        vi.stubGlobal("fetch", vi.fn(async () => new Response(notPng.ciphertext.slice(0))));
        expect(await loadGameIconUrl(fakeClient() as never, notPng.icon)).toBeNull();
        expect(peekGameIconUrl(notPng.icon)).toBeNull();

        const huge = await encryptedIcon(PNG);
        vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(300 * 1024))));
        expect(await loadGameIconUrl(fakeClient() as never, huge.icon)).toBeNull();

        const tampered = await encryptedIcon(PNG);
        const bytes = new Uint8Array(tampered.ciphertext.slice(0));
        bytes[0] ^= 0xff;
        vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
        expect(await loadGameIconUrl(fakeClient() as never, tampered.icon)).toBeNull();

        vi.setSystemTime(Date.now() + 11 * 60_000);
        expect(peekGameIconUrl(notPng.icon)).toBeUndefined();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
});
