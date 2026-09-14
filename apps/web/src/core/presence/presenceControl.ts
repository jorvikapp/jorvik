import { SetPresence } from "matrix-js-sdk/src/sync";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

/** What the user picked, independent of how Matrix encodes it. */
export type PresenceChoice = "online" | "idle" | "dnd" | "invisible";

export interface PresenceSelection {
    choice: PresenceChoice;
    statusMessage: string;
}

const STORAGE_KEY = "jorvik_presence_selection";
export const DEFAULT_SELECTION: PresenceSelection = { choice: "online", statusMessage: "" };
export const MAX_STATUS_MESSAGE_LENGTH = 60;

/** MSC3026. Only honoured by a homeserver with msc3026_enabled. */
const BUSY_PRESENCE = "org.matrix.msc3026.busy";

export const PRESENCE_CHOICES: { choice: PresenceChoice; label: string; description: string }[] = [
    { choice: "online", label: "Online", description: "Visible and active" },
    { choice: "idle", label: "Idle", description: "Shown as away" },
    { choice: "dnd", label: "Do Not Disturb", description: "Shown as busy" },
    { choice: "invisible", label: "Invisible", description: "Appear offline to everyone" },
];

/**
 * The presence value published in m.presence.
 *
 * Note this is deliberately separate from the sync value below: the homeserver
 * re-asserts presence from the sync loop, so setting one without the other lets
 * the server quietly override the user's choice.
 */
function toPresenceValue(choice: PresenceChoice): string {
    switch (choice) {
        case "online":
            return "online";
        case "idle":
            return "unavailable";
        case "dnd":
            return BUSY_PRESENCE;
        case "invisible":
            return "offline";
    }
}

/** The set_presence parameter attached to every /sync call. */
function toSyncPresence(choice: PresenceChoice): SetPresence {
    switch (choice) {
        case "online":
            return SetPresence.Online;
        case "idle":
        case "dnd":
            // There is no busy sync value; Unavailable stops the server forcing
            // us back to online while the m.presence value stays busy.
            return SetPresence.Unavailable;
        case "invisible":
            return SetPresence.Offline;
    }
}

export function sanitizeStatusMessage(raw: string): string {
    return raw.replace(/\s+/g, " ").trim().slice(0, MAX_STATUS_MESSAGE_LENGTH);
}

export function loadPresenceSelection(): PresenceSelection {
    if (typeof window === "undefined") {
        return DEFAULT_SELECTION;
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return DEFAULT_SELECTION;
        }

        const parsed = JSON.parse(raw) as Partial<PresenceSelection>;
        const choice = PRESENCE_CHOICES.some((entry) => entry.choice === parsed.choice)
            ? (parsed.choice as PresenceChoice)
            : DEFAULT_SELECTION.choice;
        return {
            choice,
            statusMessage: sanitizeStatusMessage(
                typeof parsed.statusMessage === "string" ? parsed.statusMessage : "",
            ),
        };
    } catch {
        return DEFAULT_SELECTION;
    }
}

export function savePresenceSelection(selection: PresenceSelection): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch {
        // storage unavailable (private window, quota); the choice still applies
        // for this session, it just will not survive a reload
    }
}

/**
 * Publishes a presence selection, respecting the homeserver's rate limit.
 *
 * Synapse's rc_presence defaults to 0.1/second with a burst of 1 - roughly one
 * update per ten seconds - so flipping status twice in a row, or changing the
 * status message right after, reliably returns 429. Updates are therefore
 * coalesced to the latest selection and retried after the server's stated
 * retry_after_ms rather than surfaced as an error.
 *
 * setSyncPresence is applied immediately and unconditionally: it only changes
 * the set_presence parameter on subsequent /sync calls and is not rate limited.
 * Without it the homeserver marks an actively syncing client online and the
 * user's choice silently reverts.
 */
const MAX_RATE_LIMIT_RETRIES = 4;
const DEFAULT_RETRY_AFTER_MS = 2_000;

let pendingSelection: PresenceSelection | null = null;
let publishInFlight = false;
let lastPublishedKey: string | null = null;

function selectionKey(selection: PresenceSelection): string {
    return `${selection.choice}\u0000${sanitizeStatusMessage(selection.statusMessage)}`;
}

function retryAfterMs(error: unknown): number | null {
    const candidate = error as { errcode?: string; httpStatus?: number; data?: { retry_after_ms?: unknown } };
    const isRateLimited = candidate?.errcode === "M_LIMIT_EXCEEDED" || candidate?.httpStatus === 429;
    if (!isRateLimited) {
        return null;
    }

    const stated = candidate?.data?.retry_after_ms;
    return typeof stated === "number" && Number.isFinite(stated) && stated > 0
        ? Math.min(stated, 30_000)
        : DEFAULT_RETRY_AFTER_MS;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function sendPresence(client: MatrixClient, selection: PresenceSelection): Promise<void> {
    const statusMessage = sanitizeStatusMessage(selection.statusMessage);
    await client.setPresence({
        presence: toPresenceValue(selection.choice) as Parameters<MatrixClient["setPresence"]>[0]["presence"],
        status_msg: statusMessage.length > 0 ? statusMessage : undefined,
    });
}

export async function applyPresenceSelection(
    client: MatrixClient,
    selection: PresenceSelection,
): Promise<void> {
    // Not rate limited, and it is what stops the server overriding the choice.
    client.setSyncPresence(toSyncPresence(selection.choice));

    pendingSelection = selection;
    if (publishInFlight) {
        return;
    }

    publishInFlight = true;
    try {
        while (pendingSelection) {
            const next = pendingSelection;
            pendingSelection = null;

            const key = selectionKey(next);
            if (key === lastPublishedKey) {
                continue;
            }

            let attempt = 0;
            for (;;) {
                try {
                    await sendPresence(client, next);
                    lastPublishedKey = key;
                    break;
                } catch (error) {
                    const waitMs = retryAfterMs(error);
                    if (waitMs === null || attempt >= MAX_RATE_LIMIT_RETRIES) {
                        throw error;
                    }
                    attempt += 1;
                    await sleep(waitMs);
                    // A newer selection while waiting supersedes this one.
                    if (pendingSelection) {
                        break;
                    }
                }
            }
        }
    } finally {
        publishInFlight = false;
    }
}

/** Clears the dedupe cache, e.g. on logout or client swap. */
export function resetPresencePublishState(): void {
    pendingSelection = null;
    publishInFlight = false;
    lastPublishedKey = null;
}
