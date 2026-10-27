import { ReceiptType } from "matrix-js-sdk/src/matrix";
import { describe, expect, it, vi } from "vitest";

import {
    normalizeKeepPrivate,
    ownReadReceiptType,
    READ_RECEIPTS_EVENT_TYPE,
    serverHasPrivateReceipts,
    setReadMarkers,
} from "../../../../src/ui/notifications/readReceipts";

function client(content?: unknown) {
    return {
        getAccountData: (type: string) =>
            type === READ_RECEIPTS_EVENT_TYPE && content !== undefined ? { getContent: () => content } : undefined,
        setRoomReadMarkers: vi.fn(async () => ({})),
    };
}

describe("read receipts", () => {
    it("are kept private only when the account data says so outright", () => {
        expect(normalizeKeepPrivate({ private: true })).toBe(true);
        for (const content of [undefined, null, [], {}, { private: "true" }, { private: 1 }, { private: false }]) {
            expect(normalizeKeepPrivate(content)).toBe(false);
        }
    });

    it("go out public by default, with the read marker", async () => {
        const c = client();
        const event = { getId: () => "$2" };
        await setReadMarkers(c as never, "!room", "$2", event as never);
        expect(c.setRoomReadMarkers).toHaveBeenCalledWith("!room", "$2", event);
        expect(ownReadReceiptType(c as never)).toBe(ReceiptType.Read);
    });

    it("go out private, never public, when the user keeps them to themselves", async () => {
        const c = client({ private: true });
        const event = { getId: () => "$2" };
        await setReadMarkers(c as never, "!room", "$2", event as never);
        expect(c.setRoomReadMarkers).toHaveBeenCalledWith("!room", "$2", undefined, event);
        expect(ownReadReceiptType(c as never)).toBe(ReceiptType.ReadPrivate);
    });

    it("can be private on servers with Matrix 1.4, or MSC2285 before it", async () => {
        const server = (v14: boolean, msc2285: boolean) => ({
            isVersionSupported: async (version: string) => version === "v1.4" && v14,
            doesServerSupportUnstableFeature: async (feature: string) => feature === "org.matrix.msc2285.stable" && msc2285,
        });
        await expect(serverHasPrivateReceipts(server(true, false) as never)).resolves.toBe(true);
        await expect(serverHasPrivateReceipts(server(false, true) as never)).resolves.toBe(true);
        await expect(serverHasPrivateReceipts(server(false, false) as never)).resolves.toBe(false);
    });
});
