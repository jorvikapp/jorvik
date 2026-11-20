import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

const fetchFromRelay = vi.fn();
vi.mock("../../../../src/core/voice/relayAuth", () => ({ fetchFromRelay: (...args: unknown[]) => fetchFromRelay(...args) }));

import { LinksCard } from "../../../../src/ui/components/rightPanel/cards/LinksCard";
import { clearTwitchStreams } from "../../../../src/core/users/twitchLive";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    clearTwitchStreams();
    fetchFromRelay.mockReset();
    act(() => root.unmount());
    container.remove();
});

it("shows each link with its site, opening outside the app", () => {
    act(() => root.render(<LinksCard links={["https://twitch.tv/xuruh", "https://jorvik.app/"]} />));
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.map((a) => a.textContent)).toEqual(["Twitchxuruh↗", "Websitejorvik.app↗"]);
    expect(anchors[0].getAttribute("href")).toBe("https://twitch.tv/xuruh");
    expect(anchors[0].getAttribute("target")).toBe("_blank");
    expect(anchors[0].getAttribute("rel")).toBe("noopener noreferrer");
});

it("shows nothing without links", () => {
    act(() => root.render(<LinksCard links={[]} />));
    expect(container.innerHTML).toBe("");
});

it("a live Twitch channel gets LIVE and what's on", async () => {
    fetchFromRelay.mockResolvedValue(new Response(JSON.stringify({ live: { xuruh: { title: "Raid night", game: "World of Warcraft", startedAt: "" } } })));
    await act(async () => root.render(<LinksCard client={{} as MatrixClient} links={["https://twitch.tv/xuruh", "https://youtube.com/@xuruh"]} />));
    await act(async () => {});
    const rows = [...container.querySelectorAll("a")];
    expect(rows[0].querySelector(".rp-link-live")?.textContent).toBe("LIVE");
    expect(rows[0].querySelector(".rp-link-stream")?.textContent).toBe("World of Warcraft · Raid night");
    expect(rows[1].querySelector(".rp-link-live")).toBeNull();
    expect(fetchFromRelay).toHaveBeenCalledTimes(1);
});

it("not live: no tag", async () => {
    fetchFromRelay.mockResolvedValue(new Response(JSON.stringify({ live: {} })));
    await act(async () => root.render(<LinksCard client={{} as MatrixClient} links={["https://twitch.tv/sleepy"]} />));
    await act(async () => {});
    expect(container.querySelector(".rp-link-live")).toBeNull();
    expect(container.querySelector(".rp-link-stream")).toBeNull();
});
