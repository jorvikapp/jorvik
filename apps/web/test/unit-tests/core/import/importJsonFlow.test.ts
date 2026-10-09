import { describe, expect, it, vi } from "vitest";

import { defaultChannelImportConfig, runJsonImport, type JsonExport } from "../../../../src/core/import/importJsonFlow";

const exportData: JsonExport = {
    exported_at: "2026-10-09T00:00:00Z",
    guild: { id: "g1", name: "Longship" },
    categories: [],
    channels: [
        { id: "t1", name: "general", type: "text", position: 0, category_id: null },
        { id: "v1", name: "Hall", type: "voice", position: 1, category_id: null },
    ],
    emojis: [],
};

function makeClient() {
    let next = 0;
    return {
        getDomain: () => "example.org",
        getUserId: () => "@me:example.org",
        createRoom: vi.fn(async (_options: unknown) => ({ room_id: `!room${(next += 1)}:example.org` })),
        sendStateEvent: vi.fn(async () => ({})),
        uploadContent: vi.fn(async () => ({ content_uri: "mxc://example.org/x" })),
    };
}

function createdRoom(client: ReturnType<typeof makeClient>, name: string): { initial_state: Array<{ type: string; content: unknown }> } {
    const call = client.createRoom.mock.calls.find(([options]) => (options as { name?: string }).name === name);
    if (!call) {
        throw new Error(`no room created named ${name}`);
    }
    return call[0] as { initial_state: Array<{ type: string; content: unknown }> };
}

const encryption = (room: { initial_state: Array<{ type: string; content: unknown }> }): unknown =>
    room.initial_state.find((event) => event.type === "m.room.encryption")?.content;

describe("JSON import encryption", () => {
    it("encrypts the Space and every channel by default, voice channels included", async () => {
        const client = makeClient();
        await runJsonImport(client as never, exportData, new Map(), () => undefined, { cancelled: false });

        expect(encryption(createdRoom(client, "Longship"))).toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
        expect(encryption(createdRoom(client, "general"))).toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
        expect(encryption(createdRoom(client, "Hall"))).toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
        expect(defaultChannelImportConfig().isEncrypted).toBe(true);
    });

    it("leaves a channel unencrypted when the import says so", async () => {
        const client = makeClient();
        await runJsonImport(client as never, exportData, new Map(), () => undefined, { cancelled: false }, {
            v1: { ...defaultChannelImportConfig(), isEncrypted: false },
        });

        expect(encryption(createdRoom(client, "Hall"))).toBeUndefined();
        expect(encryption(createdRoom(client, "general"))).toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
    });
});
