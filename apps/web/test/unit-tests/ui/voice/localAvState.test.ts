import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("../../../../src/ui/voice/localAvState");

const KEY = "heorot.voice.localAv";

/** Loads the store as the app does when it starts: from whatever this device saved before. */
async function start(): Promise<Store> {
    vi.resetModules();
    return import("../../../../src/ui/voice/localAvState");
}

beforeEach(() => {
    window.localStorage.removeItem(KEY);
});

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(KEY);
});

describe("your mic and sound, outside and between calls", () => {
    it("starts with the mic and sound on, and the camera off", async () => {
        const av = await start();
        expect(av.getLocalAvState()).toEqual({ micMuted: false, deafened: false, cameraOn: false });
    });

    it("keeps mute and deafen across a restart, and drops the camera", async () => {
        let av = await start();
        av.toggleMicMuted();
        av.setCameraOn(true);
        av = await start();
        expect(av.getLocalAvState()).toEqual({ micMuted: true, deafened: false, cameraOn: false });

        av.setMicMuted(false);
        av.toggleDeafened();
        av = await start();
        expect(av.getLocalAvState()).toEqual({ micMuted: true, deafened: true, cameraOn: false });
    });

    it("deafening mutes the mic, and undeafening puts it back on if it was on", async () => {
        const av = await start();
        av.toggleDeafened();
        expect(av.getLocalAvState()).toMatchObject({ deafened: true, micMuted: true });
        av.toggleDeafened();
        expect(av.getLocalAvState()).toMatchObject({ deafened: false, micMuted: false });
    });

    it("leaves a mic that was muted before deafening muted after", async () => {
        const av = await start();
        av.setMicMuted(true);
        av.setDeafened(true);
        av.setDeafened(false);
        expect(av.getLocalAvState()).toMatchObject({ deafened: false, micMuted: true });
    });

    it("remembers how the mic was before deafening across a restart", async () => {
        let av = await start();
        av.setDeafened(true);
        av = await start();
        av.setDeafened(false);
        expect(av.getLocalAvState()).toMatchObject({ deafened: false, micMuted: false });

        av.setMicMuted(true);
        av.setDeafened(true);
        av = await start();
        av.setDeafened(false);
        expect(av.getLocalAvState()).toMatchObject({ deafened: false, micMuted: true });
    });

    it("turning the mic on while deafened undeafens too", async () => {
        const av = await start();
        av.setMicMuted(true);
        av.setDeafened(true);
        av.toggleMicMuted();
        expect(av.getLocalAvState()).toMatchObject({ deafened: false, micMuted: false });
        // And a later deafen and undeafen comes back to that, not to before.
        av.setDeafened(true);
        av.setDeafened(false);
        expect(av.getLocalAvState()).toMatchObject({ deafened: false, micMuted: false });
    });

    it("tells whoever listens about changes, and only about changes", async () => {
        const av = await start();
        const heard = vi.fn();
        const stop = av.subscribeLocalAvState(heard);
        av.setDeafened(false);
        av.setMicMuted(false);
        expect(heard).not.toHaveBeenCalled();
        av.toggleMicMuted();
        expect(heard).toHaveBeenCalledTimes(1);
        stop();
        av.toggleMicMuted();
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it("works without anywhere to save it, and with a broken saved value", async () => {
        window.localStorage.setItem(KEY, "{not json");
        let av = await start();
        expect(av.getLocalAvState()).toEqual({ micMuted: false, deafened: false, cameraOn: false });

        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        av = await start();
        expect(() => av.toggleMicMuted()).not.toThrow();
        expect(av.getLocalAvState().micMuted).toBe(true);
    });

    it("never starts deafened with the mic on, whatever was saved", async () => {
        window.localStorage.setItem(KEY, JSON.stringify({ micMuted: false, deafened: true, micMutedBeforeDeafen: false }));
        const av = await start();
        expect(av.getLocalAvState()).toMatchObject({ deafened: true, micMuted: true });
    });

    it("follows a change made in another window of the app", async () => {
        const av = await start();
        const saved = JSON.stringify({ micMuted: true, deafened: false, micMutedBeforeDeafen: false });
        window.localStorage.setItem(KEY, saved);
        window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: saved }));
        expect(av.getLocalAvState().micMuted).toBe(true);
    });
});
