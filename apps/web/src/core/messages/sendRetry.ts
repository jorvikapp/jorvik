import {
    ClientEvent,
    EventStatus,
    MatrixScheduler,
    RoomEvent,
    SyncState,
    type MatrixClient,
    type MatrixError,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";

/**
 * Sending while the server is down.
 *
 * A message goes into the chat at once and the composer is free again. The SDK's scheduler sends messages
 * one at a time in order, and retries a failed send for its first 15 seconds. After that the message is
 * left "not sent": the chat shows it in red with Retry, and this keeper sends it again by itself when the
 * server answers again (and every so often while it doesn't). A message is never dropped to make room for
 * the next one.
 */

/**
 * How long a message may be on its way to the server before the chat shows it in red as not sent. Counted
 * from when it actually leaves (sendStartedAt), not from Enter: in an encrypted chat the first message
 * shares a new key with every device first, which on a slow line takes seconds before the send begins.
 */
export const SEND_SHOWN_FAILED_AFTER_MS = 15_000;

/**
 * A message that hasn't even left after this long (still encrypting or waiting in line) is shown red too,
 * so a server that stops answering during the key sharing doesn't leave it faded forever.
 */
export const SEND_NEVER_LEFT_AFTER_MS = 30_000;

const sendStarts = new WeakMap<MatrixEvent, number>();

/** Note the first time this message started going to the server (its first "sending"). */
export function noteSendStart(event: MatrixEvent, at: number = Date.now()): void {
    if (event.status === EventStatus.SENDING && !sendStarts.has(event)) {
        sendStarts.set(event, at);
    }
}

/** When this message first started going to the server, if it has. */
export function sendStartedAt(event: MatrixEvent): number | undefined {
    return sendStarts.get(event);
}

/**
 * How long this message has been failing to get out, for the red point and the retry rule: since it first
 * started sending; or since Enter if it was turned down before it could start (held behind an unsent one,
 * or the encryption step failed).
 */
function sendAge(event: MatrixEvent, now: number): number {
    const started = sendStarts.get(event);
    return now - (started ?? event.getTs());
}

/** One attempt at sending a message gives up after this long, so a server that never answers can't hold it. */
export const SEND_REQUEST_TIMEOUT_MS = 15_000;

/** How often the keeper tries the waiting messages again while the server stays away. */
export const SEND_AUTO_RETRY_EVERY_MS = 30_000;

function httpStatusOf(error: unknown): number | undefined {
    const status = (error as Partial<MatrixError> | null | undefined)?.httpStatus;
    return typeof status === "number" ? status : undefined;
}

/**
 * True when sending again later might work: no answer, a timeout, the server or its proxy failing (5xx),
 * or a rate limit. False when the server refused this message for good (forbidden, too large, and so on).
 */
export function isRetryableSendError(error: unknown): boolean {
    if (!error) {
        // Held back behind an earlier message that hadn't gone out; nothing is wrong with this one.
        return true;
    }
    const status = httpStatusOf(error);
    if (status === undefined) {
        return (error as { name?: string }).name !== "M_TOO_LARGE";
    }
    return status >= 500 || status === 429;
}

/** The server refused this message; trying again on its own won't help (Retry still lets the person try). */
export function isPermanentSendFailure(event: MatrixEvent): boolean {
    return event.status === EventStatus.NOT_SENT && !isRetryableSendError(event.error);
}

/**
 * The scheduler's retry rule: keep trying a message that failed for a reason that may pass, with short
 * waits, until it's SEND_SHOWN_FAILED_AFTER_MS old. Then hand it back as not sent, which is when the chat
 * turns it red and the keeper takes over.
 */
export function sendRetryDelayMs(
    event: MatrixEvent | null,
    attempts: number,
    error: unknown,
    now: number = Date.now(),
): number {
    if (!isRetryableSendError(error)) {
        return -1;
    }
    if (event) {
        noteSendStart(event, now);
    }
    const age = event ? sendAge(event, now) : Number.POSITIVE_INFINITY;
    if (age >= SEND_SHOWN_FAILED_AFTER_MS) {
        return -1;
    }
    const wait = Math.min(1000 * 2 ** Math.max(0, attempts - 1), 4000);
    return Math.min(wait, Math.max(0, SEND_SHOWN_FAILED_AFTER_MS - age));
}

/** The scheduler every client uses: messages in order, retried by sendRetryDelayMs. */
export function createSendScheduler(): MatrixScheduler {
    return new MatrixScheduler((event, attempts, error) => sendRetryDelayMs(event, attempts, error));
}

const SEND_PATH = /\/_matrix\/client\/[^/]+\/rooms\/[^/]+\/(send|redact)\//;

function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return input;
    }
    if (input instanceof URL) {
        return input.href;
    }
    return input.url;
}

function timeoutSignal(ms: number, outer: AbortSignal | null | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(ms);
    if (!outer) {
        return timeout;
    }
    if (typeof AbortSignal.any === "function") {
        return AbortSignal.any([outer, timeout]);
    }
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    outer.addEventListener("abort", abort, { once: true });
    timeout.addEventListener("abort", abort, { once: true });
    return controller.signal;
}

/**
 * Gives sending a message (and deleting one) a time limit. The SDK sends them with none, so a server that
 * stops answering left a message "sending" forever and everything typed after it waiting behind it. The
 * failed attempt is safe to repeat: the retry uses the same transaction ID, and the server keeps one copy.
 */
export function withSendTimeout(fetchFn: typeof fetch, timeoutMs: number = SEND_REQUEST_TIMEOUT_MS): typeof fetch {
    return (input, init) => {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method !== "PUT" || !SEND_PATH.test(requestUrl(input))) {
            return fetchFn(input, init);
        }
        return fetchFn(input, { ...init, signal: timeoutSignal(timeoutMs, init?.signal) });
    };
}

/** Messages in this room that aren't out yet and are waiting for another try, oldest first. */
export function unsentEvents(room: Room): MatrixEvent[] {
    try {
        return room.getPendingEvents().filter((event) => event.status === EventStatus.NOT_SENT);
    } catch {
        // getPendingEvents throws when the room doesn't keep pending events apart; nothing to retry then.
        return [];
    }
}

/**
 * Send this room's not-sent messages again, oldest first. The scheduler sends them one at a time, so they
 * arrive in the order they were written. Automatic tries skip a message the server refused for good;
 * Retry (`includeRefused`) tries everything.
 */
export function retryUnsent(client: MatrixClient, room: Room, { includeRefused = false } = {}): number {
    let resent = 0;
    for (const event of unsentEvents(room)) {
        if (!includeRefused && isPermanentSendFailure(event)) {
            continue;
        }
        resent += 1;
        client.resendEvent(event, room).catch(() => {
            // It is back to not sent and shown in red; the keeper tries again later.
        });
    }
    return resent;
}

function retryAllRooms(client: MatrixClient): void {
    for (const room of client.getRooms()) {
        retryUnsent(client, room);
    }
}

const DOWN_STATES = new Set<SyncState | null>([SyncState.Error, SyncState.Reconnecting]);
const UP_STATES = new Set<SyncState | null>([SyncState.Syncing, SyncState.Prepared, SyncState.Catchup]);

/**
 * Sends not-sent messages again by themselves: as soon as the server answers sync again after a failure,
 * and every SEND_AUTO_RETRY_EVERY_MS while any are waiting. Returns a function that stops it.
 */
export function startSendRetryKeeper(
    client: MatrixClient,
    { everyMs = SEND_AUTO_RETRY_EVERY_MS }: { everyMs?: number } = {},
): () => void {
    // Note when each message starts going out, so the red point counts from then (sendStartedAt).
    const onLocalEcho = (event: MatrixEvent): void => noteSendStart(event);
    client.on(RoomEvent.LocalEchoUpdated, onLocalEcho);
    let wasDown = false;
    const onSync = (state: SyncState, previous: SyncState | null): void => {
        if (DOWN_STATES.has(state)) {
            wasDown = true;
            return;
        }
        if (UP_STATES.has(state) && (wasDown || DOWN_STATES.has(previous))) {
            wasDown = false;
            retryAllRooms(client);
        }
    };
    client.on(ClientEvent.Sync, onSync);
    const timer = setInterval(() => retryAllRooms(client), everyMs);
    return () => {
        client.off(ClientEvent.Sync, onSync);
        client.off(RoomEvent.LocalEchoUpdated, onLocalEcho);
        clearInterval(timer);
    };
}

export type SendDisplayState = "sent" | "sending" | "failed";

/**
 * What the chat shows for one of our messages: "sending" (faded) until it has been on its way for
 * SEND_SHOWN_FAILED_AFTER_MS (or hasn't left after SEND_NEVER_LEFT_AFTER_MS), then "failed" (red, with
 * Retry) until it is out. A message the server refused is red straight away.
 */
export function sendDisplayState(event: MatrixEvent, now: number = Date.now()): SendDisplayState {
    const status = event.status;
    if (
        status !== EventStatus.NOT_SENT &&
        status !== EventStatus.SENDING &&
        status !== EventStatus.QUEUED &&
        status !== EventStatus.ENCRYPTING
    ) {
        return "sent";
    }
    if (isPermanentSendFailure(event)) {
        return "failed";
    }
    noteSendStart(event, now);
    const left = sendStarts.has(event) || status === EventStatus.NOT_SENT;
    const limit = left ? SEND_SHOWN_FAILED_AFTER_MS : SEND_NEVER_LEFT_AFTER_MS;
    return sendAge(event, now) >= limit ? "failed" : "sending";
}

/** True when the message can be taken back out of the queue now (it isn't on its way to the server). */
export function canRemoveUnsent(event: MatrixEvent): boolean {
    return (
        event.status === EventStatus.NOT_SENT ||
        event.status === EventStatus.QUEUED ||
        event.status === EventStatus.ENCRYPTING
    );
}
