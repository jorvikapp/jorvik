import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportJsonWizard } from "../../../../src/ui/components/rooms/ImportJsonWizard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
});

const VIEW = 1 << 10;
const SEND = 1 << 11;

const TEMPLATE = {
    code: "hgM48av5Q69A",
    source_guild_id: "1234",
    serialized_source_guild: {
        name: "Longship",
        description: "Vikings and friends",
        roles: [
            { id: 0, name: "@everyone", permissions: String(VIEW | SEND) },
            { id: 1, name: "Jarl", permissions: String(1 << 3) },
        ],
        channels: [
            { id: 1, type: 4, name: "Hall", position: 0, parent_id: null, permission_overwrites: [] },
            { id: 2, type: 0, name: "rules", position: 0, parent_id: 1, permission_overwrites: [{ id: 0, type: 0, allow: "0", deny: String(SEND) }] },
            { id: 3, type: 0, name: "general", position: 1, parent_id: 1, permission_overwrites: [] },
            { id: 4, type: 0, name: "jarls", position: 2, parent_id: 1, permission_overwrites: [{ id: 0, type: 0, allow: "0", deny: String(VIEW) }] },
            { id: 5, type: 2, name: "Fire", position: 3, parent_id: 1, permission_overwrites: [] },
        ],
    },
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

function buttonNamed(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
    if (!button) {
        throw new Error(`expected a "${text}" button`);
    }
    return button;
}

function selectFor(label: string): HTMLSelectElement {
    const select = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
    if (!select) {
        throw new Error(`expected a select labelled "${label}"`);
    }
    return select;
}

async function renderWizard(client: ReturnType<typeof makeClient>, onImported = vi.fn()): Promise<void> {
    await act(async () => {
        root.render(
            <ImportJsonWizard client={client as never} open source="discord" onClose={() => undefined} onImported={onImported} />,
        );
    });
}

async function pasteLink(link: string): Promise<void> {
    const input = container.querySelector('input[placeholder="https://discord.new/..."]') as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, link);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
        buttonNamed("Next").click();
    });
}

function createdRoom(client: ReturnType<typeof makeClient>, name: string): Record<string, unknown> {
    const call = client.createRoom.mock.calls.find(([options]) => (options as { name?: string }).name === name);
    if (!call) {
        throw new Error(`no room created named ${name}`);
    }
    return call[0] as Record<string, unknown>;
}

function joinRule(room: Record<string, unknown>): unknown {
    const state = room.initial_state as Array<{ type: string; content: { join_rule?: string } }>;
    return state.find((event) => event.type === "m.room.join_rules")?.content.join_rule;
}

describe("ImportJsonWizard from Discord", () => {
    it("reads the template link, shows each channel matched to Discord, and imports it", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(TEMPLATE), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const client = makeClient();
        const onImported = vi.fn();
        await renderWizard(client, onImported);

        await pasteLink("https://discord.new/hgM48av5Q69A");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(container.querySelector(".room-dialog-title")?.textContent).toBe("Check the channels");
        expect(container.querySelector(".import-wizard-summary-name")?.textContent).toBe("Longship");
        expect(selectFor("Who can post in rules").value).toBe("100");
        expect(selectFor("Who can join jarls").value).toBe("invite");
        expect(selectFor("Who can join general").value).toBe("public");
        // Voice channels have no chat, so there's no choice of who can post.
        expect(selectFor("Who can post in Fire").getAttribute("aria-hidden")).toBe("true");

        await act(async () => {
            buttonNamed("Start import").click();
        });

        expect(createdRoom(client, "Longship").topic).toBe("Vikings and friends");
        expect(createdRoom(client, "rules").power_level_content_override).toEqual({ events_default: 100 });
        expect(joinRule(createdRoom(client, "general"))).toBe("public");
        expect(joinRule(createdRoom(client, "jarls"))).toBeUndefined();
        expect(container.textContent).toContain("Your Space is ready.");
        expect(container.textContent).toContain("Channels created: 4");
        expect(container.textContent).not.toContain("Emoji uploaded");

        await act(async () => {
            buttonNamed("Go to Space").click();
        });
        expect(onImported).toHaveBeenCalledWith("!room1:example.org");
    });

    it("keeps the changes made to the channels when going back to the same link", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(TEMPLATE), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await renderWizard(makeClient());
        await pasteLink("discord.new/hgM48av5Q69A");

        await act(async () => {
            const select = selectFor("Who can join general");
            select.value = "invite";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await act(async () => {
            buttonNamed("Back").click();
        });
        await act(async () => {
            buttonNamed("Next").click();
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(selectFor("Who can join general").value).toBe("invite");
    });

    it("warns when the server's limit on making rooms will make the import take a while", async () => {
        const big = structuredClone(TEMPLATE);
        for (let id = 10; id < 22; id++) {
            big.serialized_source_guild.channels.push({ id, type: 0, name: `channel-${id}`, position: id, parent_id: 1, permission_overwrites: [] });
        }
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(big), { status: 200 })));
        await renderWizard(makeClient());
        await pasteLink("https://discord.new/hgM48av5Q69A");

        // 16 channels and the Space: 10 at once, then 7 more at about one a minute.
        expect(container.textContent).toContain("so this could take about 7 minutes. Keep Jorvik open until it's done.");
    });

    it("says what's wrong with a link, and stays on it", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Unknown server template", code: 10057 }), { status: 404 }));
        vi.stubGlobal("fetch", fetchMock);
        await renderWizard(makeClient());

        await pasteLink("https://discord.gg/vikings");
        expect(container.querySelector(".room-dialog-error")?.textContent).toContain("That isn't a Discord template link.");
        expect(fetchMock).not.toHaveBeenCalled();

        await pasteLink("https://discord.new/gone12345678");
        expect(container.querySelector(".room-dialog-error")?.textContent).toContain("Discord has no template at that link.");
        expect(container.querySelector(".room-dialog-title")?.textContent).toBe("Import from Discord");
    });
});
