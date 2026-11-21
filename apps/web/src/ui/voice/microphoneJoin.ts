/**
 * Opening the microphone when someone joins a call. The first time, it can bring up the browser's or the
 * system's popup asking to allow it, and people take their time with those: so this waits far longer than
 * the network steps of a join, and it is never retried, since a retry would ask again. Whatever opens after
 * nobody wants it any more (too late, or the join moved on) is closed at once, so the mic never stays on
 * outside a call.
 */

/** How long to wait for the microphone, popup included, before the join gives up. */
export const MICROPHONE_OPEN_WAIT_MS = 60_000;

/** The microphone didn't open in time. Not worth retrying the join for: that would only ask again. */
export class MicrophoneOpenTimeoutError extends Error {
    public constructor() {
        super("Your microphone didn't start. Check that Jorvik is allowed to use it, then join again.");
        this.name = "MicrophoneOpenTimeoutError";
    }
}

interface Stoppable {
    stop(): void;
}

export function stopAll(tracks: readonly Stoppable[]): void {
    for (const track of tracks) {
        track.stop();
    }
}

/**
 * The tracks `open` gives, or null when they're no longer wanted by the time they come (they're closed then).
 * Throws MicrophoneOpenTimeoutError after `waitMs`; if the tracks still come after that, they're closed.
 */
export async function openMicrophoneForJoin<T extends Stoppable>(
    open: () => Promise<T[]>,
    stillWanted: () => boolean,
    waitMs = MICROPHONE_OPEN_WAIT_MS,
): Promise<T[] | null> {
    const opening = open();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            reject(new MicrophoneOpenTimeoutError());
        }, waitMs);
    });
    try {
        const tracks = await Promise.race([opening, timeout]);
        if (!stillWanted()) {
            stopAll(tracks);
            return null;
        }
        return tracks;
    } catch (error) {
        if (timedOut) {
            opening.then(stopAll, () => undefined);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
