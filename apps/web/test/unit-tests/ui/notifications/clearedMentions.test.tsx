import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClientEvent, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    MENTIONS_CLEARED_EVENT_TYPE,
    normalizeClearedUpTo,
    useClearedMentions,
    type ClearedMentionsController,
} from "../../../../src/ui/notifications/clearedMentions";

let container: HTMLDivElement;
let root: Root;
let controller: ClearedMentionsController;

function clearedEvent(clearedUpTo: number): MatrixEvent {
    return new MatrixEvent({ type: MENTIONS_CLEARED_EVENT_TYPE, content: { cleared_up_to: clearedUpTo } });
}

function makeClient(initial: number | null = null, { failSaves = false } = {}) {
    const emitter = new EventEmitter();
    let saved = initial === null ? undefined : clearedEvent(initial);
    return Object.assign(emitter, {
        getAccountData: (type: string) => (type === MENTIONS_CLEARED_EVENT_TYPE ? saved : undefined),
        setAccountData: vi.fn(async (type: string, content: { cleared_up_to: number }) => {
            if (failSaves) {
                throw new Error("offline");
            }
            saved = clearedEvent(content.cleared_up_to);
            emitter.emit(ClientEvent.AccountData, saved);
            return {};
        }),
        removeListener: emitter.removeListener.bind(emitter),
    });
}

function Probe({ client }: { client: ReturnType<typeof makeClient> }): null {
    controller = useClearedMentions(client as never);
    return null;
}

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

describe("normalizeClearedUpTo", () => {
    it("takes a time, and treats anything else as never cleared", () => {
        expect(normalizeClearedUpTo({ cleared_up_to: 1700 })).toBe(1700);
        expect(normalizeClearedUpTo({ cleared_up_to: "1700" })).toBe(0);
        expect(normalizeClearedUpTo({ cleared_up_to: -5 })).toBe(0);
        expect(normalizeClearedUpTo({ cleared_up_to: Number.NaN })).toBe(0);
        expect(normalizeClearedUpTo(null)).toBe(0);
        expect(normalizeClearedUpTo(undefined)).toBe(0);
    });
});

describe("useClearedMentions", () => {
    it("starts from what was saved, and saves a new clear for every device", async () => {
        const client = makeClient(100);
        act(() => root.render(<Probe client={client} />));
        expect(controller.clearedUpTo).toBe(100);

        await act(async () => controller.clearUpTo(250));

        expect(client.setAccountData).toHaveBeenLastCalledWith(MENTIONS_CLEARED_EVENT_TYPE, { cleared_up_to: 250 });
        expect(controller.clearedUpTo).toBe(250);
    });

    it("never brings back mentions an earlier clear hid", async () => {
        const client = makeClient(300);
        act(() => root.render(<Probe client={client} />));

        await act(async () => controller.clearUpTo(200));

        expect(client.setAccountData).toHaveBeenLastCalledWith(MENTIONS_CLEARED_EVENT_TYPE, { cleared_up_to: 300 });
        expect(controller.clearedUpTo).toBe(300);
    });

    it("shows the mentions again if the clear can't be saved", async () => {
        const client = makeClient(100, { failSaves: true });
        act(() => root.render(<Probe client={client} />));

        let failed = false;
        await act(async () => {
            await controller.clearUpTo(250).catch(() => {
                failed = true;
            });
        });

        expect(failed).toBe(true);
        expect(controller.clearedUpTo).toBe(100);
    });

    it("follows a clear made on another device", () => {
        const client = makeClient();
        act(() => root.render(<Probe client={client} />));
        expect(controller.clearedUpTo).toBe(0);

        act(() => {
            client.emit(ClientEvent.AccountData, clearedEvent(900));
        });

        expect(controller.clearedUpTo).toBe(900);
    });
});
