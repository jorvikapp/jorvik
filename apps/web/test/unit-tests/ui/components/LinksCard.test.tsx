import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { LinksCard } from "../../../../src/ui/components/rightPanel/cards/LinksCard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
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
