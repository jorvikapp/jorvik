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

    it("gives the Space the server's description", async () => {
        const client = makeClient();
        const described = { ...exportData, guild: { ...exportData.guild, description: "Vikings and friends" } };
        await runJsonImport(client as never, described, new Map(), () => undefined, { cancelled: false });

        expect((createdRoom(client, "Longship") as { topic?: string }).topic).toBe("Vikings and friends");
    });

    it("limits who can post through the server's usual power levels, so the creator keeps theirs", async () => {
        const client = makeClient();
        const result = await runJsonImport(client as never, exportData, new Map(), () => undefined, { cancelled: false }, {
            t1: { ...defaultChannelImportConfig(), minPL: 50 },
        });

        const general = createdRoom(client, "general") as ReturnType<typeof createdRoom> & {
            power_level_content_override?: unknown;
        };
        expect(general.power_level_content_override).toEqual({ events_default: 50 });
        // A power levels event of its own would replace the server's, and leave the creator with no rights.
        expect(general.initial_state.some((event) => event.type === "m.room.power_levels")).toBe(false);
        expect((createdRoom(client, "Hall") as { power_level_content_override?: unknown }).power_level_content_override).toBeUndefined();
        expect(result.errors).toEqual([]);
    });

    it("makes channels one at a time, and waits as long as the server asks when it refuses one", async () => {
        const client = makeClient();
        const make = client.createRoom.getMockImplementation()!;
        let inFlight = 0;
        let mostInFlight = 0;
        let refused = false;
        client.createRoom.mockImplementation(async (options: unknown) => {
            inFlight += 1;
            mostInFlight = Math.max(mostInFlight, inFlight);
            try {
                await new Promise((resolve) => setTimeout(resolve, 5));
                if ((options as { name?: string }).name === "Hall" && !refused) {
                    refused = true;
                    throw Object.assign(new Error("Too Many Requests"), {
                        httpStatus: 429,
                        data: { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 300 },
                    });
                }
                return make(options);
            } finally {
                inFlight -= 1;
            }
        });
        const messages: string[] = [];

        const result = await runJsonImport(client as never, exportData, new Map(), (progress) => messages.push(progress.message), {
            cancelled: false,
        });

        expect(result.errors).toEqual([]);
        expect(result.channelsCreated).toBe(2);
        expect(mostInFlight).toBe(1);
        expect(messages).toContain("Your server limits how fast channels can be made. Next one in 1 s, 1 to go.");
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
