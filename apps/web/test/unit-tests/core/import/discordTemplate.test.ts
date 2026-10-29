import { afterEach, describe, expect, it, vi } from "vitest";

import {
    DiscordTemplateError,
    discordTemplateToImport,
    fetchDiscordTemplate,
    parseDiscordTemplateCode,
    readDiscordTemplate,
} from "../../../../src/core/import/discordTemplate";
import type { JsonExport } from "../../../../src/core/import/importJsonFlow";

const VIEW = 1 << 10;
const SEND = 1 << 11;
const ADMINISTRATOR = 1 << 3;
// Kick, ban and manage messages.
const MODERATION = (1 << 1) | (1 << 2) | (1 << 13);

const hideFromEveryone = { id: 0, type: 0, allow: "0", deny: String(VIEW) };
const noPostingForEveryone = { id: 0, type: 0, allow: "0", deny: String(SEND) };

// Shaped like Discord's answer for a real template, with the kinds of channels a community has.
const COMMUNITY_TEMPLATE = {
    code: "hgM48av5Q69A",
    name: "Longship template",
    source_guild_id: "1234",
    updated_at: "2026-10-28T12:00:00+00:00",
    serialized_source_guild: {
        name: "Longship",
        description: "Vikings and friends",
        roles: [
            { id: 0, name: "@everyone", permissions: String(VIEW | SEND | (1 << 6) | (1 << 16)) },
            { id: 1, name: "Jarl", permissions: String(ADMINISTRATOR) },
            { id: 2, name: "Moderator", permissions: String(MODERATION) },
            { id: 3, name: "VIP", permissions: "0" },
            { id: 4, name: "Herald", permissions: "0" },
        ],
        channels: [
            { id: 10, type: 4, name: "Info", position: 0, parent_id: null, permission_overwrites: [] },
            { id: 11, type: 0, name: "rules", position: 0, parent_id: 10, topic: "Read me first", permission_overwrites: [noPostingForEveryone] },
            {
                id: 12,
                type: 0,
                name: "news",
                position: 1,
                parent_id: 10,
                permission_overwrites: [noPostingForEveryone, { id: 4, type: 0, allow: String(SEND), deny: "0" }],
            },
            { id: 20, type: 4, name: "Chat", position: 1, parent_id: null, permission_overwrites: [] },
            { id: 23, type: 2, name: "Lounge", position: 0, parent_id: 20, permission_overwrites: [] },
            { id: 21, type: 0, name: "general", position: 1, parent_id: 20, permission_overwrites: [] },
            {
                id: 22,
                type: 0,
                name: "vip-lounge",
                position: 2,
                parent_id: 20,
                permission_overwrites: [hideFromEveryone, { id: 3, type: 0, allow: String(VIEW), deny: "0" }],
            },
            { id: 41, type: 15, name: "help-forum", position: 3, parent_id: 20, permission_overwrites: [] },
            { id: 42, type: 13, name: "Stage", position: 4, parent_id: 20, permission_overwrites: [] },
            { id: 30, type: 4, name: "Staff", position: 2, parent_id: null, permission_overwrites: [hideFromEveryone] },
            {
                id: 31,
                type: 0,
                name: "mod-chat",
                position: 0,
                parent_id: 30,
                permission_overwrites: [hideFromEveryone, { id: 2, type: 0, allow: String(VIEW), deny: "0" }],
            },
            {
                id: 32,
                type: 2,
                name: "Staff Room",
                position: 1,
                parent_id: 30,
                permission_overwrites: [hideFromEveryone, { id: 2, type: 0, allow: String(VIEW), deny: "0" }],
            },
            { id: 40, type: 0, name: "welcome", position: 0, parent_id: null, permission_overwrites: [] },
            { id: 43, type: 14, name: "directory", position: 0, parent_id: null, permission_overwrites: [] },
            { id: 44, type: 0, name: "orphan", position: 5, parent_id: 99, permission_overwrites: [] },
        ],
    },
};

/** The channel names in each category, in the order the importer puts them: no category first. */
function layout(exportData: JsonExport): Record<string, string[]> {
    const inCategory = (categoryId: string | null): string[] =>
        exportData.channels
            .filter((channel) => channel.category_id === categoryId)
            .sort((a, b) => a.position - b.position)
            .map((channel) => channel.name);
    const result: Record<string, string[]> = { "(none)": inCategory(null) };
    for (const category of [...exportData.categories].sort((a, b) => a.position - b.position)) {
        result[category.name] = inCategory(category.id);
    }
    return result;
}

describe("parseDiscordTemplateCode", () => {
    it.each([
        "https://discord.new/hgM48av5Q69A",
        "discord.new/hgM48av5Q69A",
        "  https://discord.com/template/hgM48av5Q69A  ",
        "https://discordapp.com/template/hgM48av5Q69A/",
        "https://canary.discord.com/template/hgM48av5Q69A?utm_source=x",
        "hgM48av5Q69A",
    ])("finds the code in %s", (input) => {
        expect(parseDiscordTemplateCode(input)).toBe("hgM48av5Q69A");
    });

    it.each(["", "two words", "https://discord.gg/vikings", "https://example.com/template/hgM48av5Q69A", "https://discord.new/"])(
        "finds no code in %j",
        (input) => {
            expect(parseDiscordTemplateCode(input)).toBeNull();
        },
    );
});

describe("discordTemplateToImport", () => {
    const { exportData, channelConfig } = discordTemplateToImport(readDiscordTemplate(COMMUNITY_TEMPLATE)!);
    const byName = (name: string): string => exportData.channels.find((channel) => channel.name === name)!.id;
    const configOf = (name: string) => channelConfig[byName(name)];

    it("keeps the server's name and description, and has no emoji", () => {
        expect(exportData.guild).toEqual({ id: "1234", name: "Longship", description: "Vikings and friends" });
        expect(exportData.emojis).toEqual([]);
    });

    it("lays the channels out as Discord does: text before voice in each category, unknown kinds left out", () => {
        expect(layout(exportData)).toEqual({
            "(none)": ["welcome", "orphan"],
            Info: ["rules", "news"],
            Chat: ["general", "vip-lounge", "help-forum", "Lounge", "Stage"],
            Staff: ["mod-chat", "Staff Room"],
        });
        expect(exportData.channels.find((channel) => channel.name === "help-forum")!.type).toBe("text");
        expect(exportData.channels.find((channel) => channel.name === "Stage")!.type).toBe("voice");
        expect(exportData.channels.find((channel) => channel.name === "rules")!.topic).toBe("Read me first");
    });

    it("opens the channels everyone could see and makes the others invite-only", () => {
        expect(configOf("general").isPublic).toBe(true);
        expect(configOf("Lounge").isPublic).toBe(true);
        expect(configOf("vip-lounge").isPublic).toBe(false);
        expect(configOf("mod-chat").isPublic).toBe(false);
        expect(configOf("Staff Room").isPublic).toBe(false);
    });

    it("lets the lowest rank that could post on Discord post", () => {
        // Everyone could post.
        expect(configOf("general").minPL).toBe(0);
        // Only admins could post.
        expect(configOf("rules").minPL).toBe(100);
        // A member role could post where everyone reads: that's moderators, not everyone.
        expect(configOf("news").minPL).toBe(50);
        // Only a member role could see it, and they could post: anyone invited can.
        expect(configOf("vip-lounge").minPL).toBe(0);
        // Only moderators could see it.
        expect(configOf("mod-chat").minPL).toBe(50);
        // Voice channels have no chat.
        expect(configOf("Staff Room").minPL).toBe(0);
    });

    it("encrypts every channel, as Jorvik does", () => {
        expect(Object.values(channelConfig).every((config) => config.isEncrypted)).toBe(true);
        expect(Object.keys(channelConfig)).toHaveLength(exportData.channels.length);
    });
});

describe("readDiscordTemplate", () => {
    it("reads nothing from an answer that isn't a template", () => {
        expect(readDiscordTemplate(null)).toBeNull();
        expect(readDiscordTemplate({ message: "Unknown server template", code: 10057 })).toBeNull();
        expect(readDiscordTemplate({ code: "x", serialized_source_guild: { name: "x", roles: [] } })).toBeNull();
    });

    it("leaves out channels and roles it can't use", () => {
        const template = readDiscordTemplate({
            code: "x",
            serialized_source_guild: {
                name: "x",
                roles: [{ id: 0, name: "@everyone", permissions: "3072" }, "junk"],
                channels: [{ id: 1, type: 0, name: "general" }, { id: 2, name: "no type" }, null],
            },
        });
        expect(template?.serialized_source_guild.channels.map((channel) => channel.name)).toEqual(["general"]);
        expect(template?.serialized_source_guild.roles).toHaveLength(1);
    });
});

describe("fetchDiscordTemplate", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("asks Discord for the template, without cookies", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(COMMUNITY_TEMPLATE), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const template = await fetchDiscordTemplate("hgM48av5Q69A");

        expect(template.serialized_source_guild.name).toBe("Longship");
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://discord.com/api/v10/guilds/templates/hgM48av5Q69A");
        expect(init.credentials).toBe("omit");
    });

    it.each([
        [404, "Discord has no template at that link."],
        [429, "Discord is getting too many requests."],
        [500, "Discord couldn't send the template (error 500)."],
    ])("says what a %i from Discord means", async (status, message) => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
        const error = await fetchDiscordTemplate("hgM48av5Q69A").catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(DiscordTemplateError);
        expect((error as Error).message).toContain(message);
    });

    it("says when Discord can't be reached, or sends something else", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
        await expect(fetchDiscordTemplate("hgM48av5Q69A")).rejects.toThrow("Couldn't reach Discord.");

        vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
        await expect(fetchDiscordTemplate("hgM48av5Q69A")).rejects.toThrow("Discord sent a template Jorvik can't read.");
    });
});
