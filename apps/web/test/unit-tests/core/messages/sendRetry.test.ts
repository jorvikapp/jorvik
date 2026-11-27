import { EventEmitter } from "events";
import { describe, expect, it, vi, afterEach } from "vitest";
import { ClientEvent, EventStatus, MatrixError, MatrixEvent, SyncState, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import {
    SEND_SHOWN_FAILED_AFTER_MS,
    canRemoveUnsent,
    isRetryableSendError,
    retryUnsent,
    sendDisplayState,
    sendRetryDelayMs,
    startSendRetryKeeper,
    withSendTimeout,
} from "../../../../src/core/messages/sendRetry";

function ourMessage(status: EventStatus | null, ageMs: number, error?: unknown): MatrixEvent {
    const event = new MatrixEvent({
        type: "m.room.message",
        room_id: "!r:example.org",
        sender: "@me:example.org",
        event_id: "~!r:example.org:m1",
        origin_server_ts: Date.now() - ageMs,
        content: { msgtype: "m.text", body: "hi" },
    });
    event.setStatus(status);
    if (error !== undefined) {
        event.error = error as MatrixError;
    }
    return event;
}

const refused = (status: number, errcode = "M_FORBIDDEN"): MatrixError => new MatrixError({ errcode, error: "no" }, status);
const noAnswer = Object.assign(new Error("fetch failed"), { name: "ConnectionError" });

afterEach(() => {
    vi.useRealTimers();
});

describe("isRetryableSendError", () => {
    it("tries again when the server didn't answer, failed, or asked us to slow down", () => {
        expect(isRetryableSendError(noAnswer)).toBe(true);
        expect(isRetryableSendError(refused(502, "M_UNKNOWN"))).toBe(true);
        expect(isRetryableSendError(refused(429, "M_LIMIT_EXCEEDED"))).toBe(true);
        expect(isRetryableSendError(undefined)).toBe(true);
    });

    it("doesn't when the server refused the message", () => {
        expect(isRetryableSendError(refused(403))).toBe(false);
        expect(isRetryableSendError(refused(413, "M_TOO_LARGE"))).toBe(false);
    });
});

describe("sendRetryDelayMs", () => {
    it("retries a young message with short waits that never run past the red point", () => {
        const now = Date.now();
        const event = ourMessage(EventStatus.SENDING, 0);
        expect(sendRetryDelayMs(event, 1, noAnswer, now)).toBe(1000);
        expect(sendRetryDelayMs(event, 2, noAnswer, now)).toBe(2000);
        expect(sendRetryDelayMs(event, 5, noAnswer, now)).toBe(4000);
        const nearlyRed = ourMessage(EventStatus.SENDING, 0);
        const later = nearlyRed.getTs() + SEND_SHOWN_FAILED_AFTER_MS - 500;
        expect(sendRetryDelayMs(nearlyRed, 3, noAnswer, later)).toBe(500);
    });

    it("hands the message back as not sent once it's old enough to show red", () => {
        expect(sendRetryDelayMs(ourMessage(EventStatus.SENDING, SEND_SHOWN_FAILED_AFTER_MS), 1, noAnswer)).toBe(-1);
    });

    it("never retries a refusal", () => {
        expect(sendRetryDelayMs(ourMessage(EventStatus.SENDING, 0), 1, refused(403))).toBe(-1);
    });
});

describe("sendDisplayState", () => {
    it("is faded at first, red after the wait, and plain once sent", () => {
        expect(sendDisplayState(ourMessage(EventStatus.SENDING, 1000))).toBe("sending");
        // A refused connection fails at once, but the message still looks like it's sending for a while.
        expect(sendDisplayState(ourMessage(EventStatus.NOT_SENT, 1000, noAnswer))).toBe("sending");
        expect(sendDisplayState(ourMessage(EventStatus.SENDING, SEND_SHOWN_FAILED_AFTER_MS + 1))).toBe("failed");
        expect(sendDisplayState(ourMessage(EventStatus.QUEUED, SEND_SHOWN_FAILED_AFTER_MS + 1))).toBe("failed");
        expect(sendDisplayState(ourMessage(null, SEND_SHOWN_FAILED_AFTER_MS + 1))).toBe("sent");
        expect(sendDisplayState(ourMessage(EventStatus.SENT, SEND_SHOWN_FAILED_AFTER_MS + 1))).toBe("sent");
    });

    it("is red straight away when the server refused it", () => {
        expect(sendDisplayState(ourMessage(EventStatus.NOT_SENT, 0, refused(403)))).toBe("failed");
    });
});

describe("canRemoveUnsent", () => {
    it("can take back a message that isn't on its way to the server right now", () => {
        expect(canRemoveUnsent(ourMessage(EventStatus.NOT_SENT, 0))).toBe(true);
        expect(canRemoveUnsent(ourMessage(EventStatus.QUEUED, 0))).toBe(true);
        expect(canRemoveUnsent(ourMessage(EventStatus.SENDING, 0))).toBe(false);
    });
});

describe("withSendTimeout", () => {
    it("puts a time limit on sending and deleting messages only", async () => {
        const seen: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
        const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            seen.push({ url: String(input), signal: init?.signal });
            return new Response("{}");
        });
        const wrapped = withSendTimeout(base as unknown as typeof fetch, 50);
        await wrapped("https://hs/_matrix/client/v3/rooms/!r%3Ahs/send/m.room.message/txn1", { method: "PUT" });
        await wrapped("https://hs/_matrix/client/v3/rooms/!r%3Ahs/redact/%24e/txn2", { method: "PUT" });
        await wrapped("https://hs/_matrix/client/v3/sync?timeout=30000", { method: "GET" });
        await wrapped("https://hs/_matrix/media/v3/upload", { method: "POST" });
        expect(seen[0].signal).toBeInstanceOf(AbortSignal);
        expect(seen[1].signal).toBeInstanceOf(AbortSignal);
        expect(seen[2].signal).toBeUndefined();
        expect(seen[3].signal).toBeUndefined();
    });

    it("gives up on a server that never answers", async () => {
        const hangs = ((_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
            })) as typeof fetch;
        const wrapped = withSendTimeout(hangs, 30);
        await expect(wrapped("https://hs/_matrix/client/v3/rooms/!r/send/m.room.message/t", { method: "PUT" })).rejects.toBeTruthy();
    });

    it("still lets the caller cancel", async () => {
        const hangs = ((_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")));
            })) as typeof fetch;
        const controller = new AbortController();
        const pending = withSendTimeout(hangs, 60_000)("https://hs/_matrix/client/v3/rooms/!r/send/x/t", {
            method: "PUT",
            signal: controller.signal,
        });
        controller.abort();
        await expect(pending).rejects.toThrow("cancelled");
    });
});

function fakeRoom(pending: MatrixEvent[]): Room {
    return { roomId: "!r:example.org", getPendingEvents: () => pending } as unknown as Room;
}

describe("retryUnsent", () => {
    it("sends the not-sent messages again, oldest first, and leaves the rest alone", () => {
        const first = ourMessage(EventStatus.NOT_SENT, 30_000, noAnswer);
        const sending = ourMessage(EventStatus.SENDING, 20_000);
        const second = ourMessage(EventStatus.NOT_SENT, 10_000);
        const resendEvent = vi.fn(() => Promise.resolve({ event_id: "$x" }));
        const client = { resendEvent } as unknown as MatrixClient;
        expect(retryUnsent(client, fakeRoom([first, sending, second]))).toBe(2);
        expect(resendEvent.mock.calls.map((call) => call[0])).toEqual([first, second]);
    });

    it("skips a refused message unless the person asked", () => {
        const forbidden = ourMessage(EventStatus.NOT_SENT, 30_000, refused(403));
        const after = ourMessage(EventStatus.NOT_SENT, 10_000);
        const resendEvent = vi.fn(() => Promise.reject(new Error("still down")));
        const client = { resendEvent } as unknown as MatrixClient;
        expect(retryUnsent(client, fakeRoom([forbidden, after]))).toBe(1);
        expect(resendEvent.mock.calls[0][0]).toBe(after);
        resendEvent.mockClear();
        expect(retryUnsent(client, fakeRoom([forbidden, after]), { includeRefused: true })).toBe(2);
    });
});

describe("startSendRetryKeeper", () => {
    function fakeClient(rooms: Room[]): MatrixClient & EventEmitter {
        const emitter = new EventEmitter() as MatrixClient & EventEmitter;
        Object.assign(emitter, {
            getRooms: () => rooms,
            resendEvent: vi.fn(() => Promise.resolve({ event_id: "$x" })),
        });
        return emitter;
    }

    it("sends waiting messages as soon as the server is back", () => {
        const waiting = ourMessage(EventStatus.NOT_SENT, 60_000, noAnswer);
        const client = fakeClient([fakeRoom([waiting])]);
        const stop = startSendRetryKeeper(client, { everyMs: 1_000_000 });
        client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        expect(client.resendEvent).not.toHaveBeenCalled();
        client.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
        client.emit(ClientEvent.Sync, SyncState.Error, SyncState.Error);
        expect(client.resendEvent).not.toHaveBeenCalled();
        client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Error);
        expect(client.resendEvent).toHaveBeenCalledTimes(1);
        stop();
        client.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
        client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Error);
        expect(client.resendEvent).toHaveBeenCalledTimes(1);
    });

    it("keeps trying every so often while the server stays away", () => {
        vi.useFakeTimers();
        const waiting = ourMessage(EventStatus.NOT_SENT, 60_000, noAnswer);
        const client = fakeClient([fakeRoom([waiting])]);
        const stop = startSendRetryKeeper(client, { everyMs: 30_000 });
        vi.advanceTimersByTime(29_000);
        expect(client.resendEvent).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1_000);
        expect(client.resendEvent).toHaveBeenCalledTimes(1);
        stop();
        vi.advanceTimersByTime(60_000);
        expect(client.resendEvent).toHaveBeenCalledTimes(1);
    });
});
