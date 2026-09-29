import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClientEvent, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GifPicker } from "../../../../src/ui/components/composer/GifPicker";
import { GIF_FAVOURITES_EVENT_TYPE } from "../../../../src/ui/components/composer/gifFavourites";

const TRENDING = [
    { url: "https://static.klipy.com/a.gif", previewUrl: "https://static.klipy.com/a.webp", title: "Taco" },
    { url: "https://static.klipy.com/b.gif", previewUrl: "https://static.klipy.com/b.webp", title: "Cat" },
];

let container: HTMLDivElement;
let root: Root;

function makeClient() {
    const emitter = new EventEmitter();
    let saved: unknown = undefined;
    const client = Object.assign(emitter, {
        getAccountData: (type: string) =>
            type === GIF_FAVOURITES_EVENT_TYPE && saved ? new MatrixEvent({ type, content: saved as object }) : undefined,
        setAccountData: vi.fn(async (type: string, content: unknown) => {
            saved = content;
            emitter.emit(ClientEvent.AccountData, new MatrixEvent({ type, content: content as object }));
        }),
        removeListener: emitter.removeListener.bind(emitter),
    });
    return client;
}

async function flush(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

const tiles = () => [...container.querySelectorAll(".composer-gif-item img")].map((img) => img.getAttribute("alt"));
const button = (label: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label) || b.getAttribute("aria-label") === label) as HTMLButtonElement;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.removeItem("jorvik.gif_picker_tab");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => ({
            ok: url.endsWith("/gif/trending"),
            json: async () => ({ results: TRENDING }),
        })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe("GifPicker", () => {
    it("opens on trending instead of an empty box", async () => {
        const client = makeClient();
        act(() => root.render(<GifPicker client={client as never} onSelect={vi.fn()} onClose={vi.fn()} />));
        await flush();
        expect(fetch).toHaveBeenCalledWith("https://matrix.jorvik.app/gif/trending", expect.anything());
        expect(tiles()).toEqual(["Taco", "Cat"]);
    });

    it("stars a GIF into favourites without sending it", async () => {
        const client = makeClient();
        const onSelect = vi.fn();
        act(() => root.render(<GifPicker client={client as never} onSelect={onSelect} onClose={vi.fn()} />));
        await flush();

        act(() => container.querySelectorAll<HTMLButtonElement>(".composer-gif-star")[1].click());
        await flush();
        expect(onSelect).not.toHaveBeenCalled();
        expect(client.setAccountData).toHaveBeenCalledWith(GIF_FAVOURITES_EVENT_TYPE, { gifs: [TRENDING[1]] });

        act(() => button("Favourites").click());
        expect(tiles()).toEqual(["Cat"]);
        expect(button("Favourites").textContent).toBe("Favourites (1)");

        act(() => container.querySelector<HTMLButtonElement>(".composer-gif-send")!.click());
        expect(onSelect).toHaveBeenCalledWith(TRENDING[1].url, "Cat");
    });

    it("says so when there are no favourites yet, and when trending fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
        const client = makeClient();
        act(() => root.render(<GifPicker client={client as never} onSelect={vi.fn()} onClose={vi.fn()} />));
        await flush();
        expect(container.textContent).toContain("Could not load trending GIFs");

        act(() => button("Favourites").click());
        expect(container.textContent).toContain("No favourites yet");
    });
});
