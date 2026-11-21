import { afterEach, describe, expect, it, vi } from "vitest";

import { MicrophoneOpenTimeoutError, openMicrophoneForJoin } from "../../../../src/ui/voice/microphoneJoin";

const track = () => ({ stop: vi.fn() });

/** A microphone that opens when `allow` is called: like someone answering the popup. */
function popup() {
    let allow!: (tracks: Array<ReturnType<typeof track>>) => void;
    let deny!: (error: Error) => void;
    const open = vi.fn(
        () =>
            new Promise<Array<ReturnType<typeof track>>>((resolve, reject) => {
                allow = resolve;
                deny = reject;
            }),
    );
    return { open, allow: (tracks: Array<ReturnType<typeof track>>) => allow(tracks), deny: (error: Error) => deny(error) };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("openMicrophoneForJoin", () => {
    it("gives the tracks once the popup is answered, however long that takes within the wait", async () => {
        vi.useFakeTimers();
        const mic = popup();
        const result = openMicrophoneForJoin(mic.open, () => true, 60_000);
        await vi.advanceTimersByTimeAsync(45_000);
        const tracks = [track()];
        mic.allow(tracks);
        await expect(result).resolves.toBe(tracks);
        expect(tracks[0].stop).not.toHaveBeenCalled();
        expect(mic.open).toHaveBeenCalledTimes(1);
    });

    it("gives up after the wait with an error the join doesn't retry, and closes a mic that opens later", async () => {
        vi.useFakeTimers();
        const mic = popup();
        const result = openMicrophoneForJoin(mic.open, () => true, 60_000);
        const failed = expect(result).rejects.toBeInstanceOf(MicrophoneOpenTimeoutError);
        await vi.advanceTimersByTimeAsync(60_000);
        await failed;
        const late = [track()];
        mic.allow(late);
        await vi.advanceTimersByTimeAsync(0);
        expect(late[0].stop).toHaveBeenCalledTimes(1);
        expect(mic.open).toHaveBeenCalledTimes(1);
    });

    it("closes the mic and gives null when the join moved on while the popup was open", async () => {
        const mic = popup();
        let wanted = true;
        const result = openMicrophoneForJoin(mic.open, () => wanted, 60_000);
        wanted = false;
        const tracks = [track(), track()];
        mic.allow(tracks);
        await expect(result).resolves.toBeNull();
        expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    });

    it("passes on a refusal as it is", async () => {
        const mic = popup();
        const result = openMicrophoneForJoin(mic.open, () => true, 60_000);
        const refused = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
        mic.deny(refused);
        await expect(result).rejects.toBe(refused);
    });
});
