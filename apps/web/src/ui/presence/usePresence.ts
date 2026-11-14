import { useEffect, useMemo, useState } from "react";
import { UserEvent, type MatrixClient, type User } from "matrix-js-sdk/src/matrix";

import { buildPresenceVm, type PresenceVm } from "./buildPresenceVm";

/**
 * Someone's status message from their latest presence. The SDK keeps the old one after it's cleared (it only
 * stores a status_msg that isn't empty), so the presence event itself is the truth; without one, the SDK's copy.
 */
export function presenceStatusMessage(user: User | null | undefined): string | null {
    const event = user?.events?.presence;
    const message = event ? event.getContent()?.status_msg : user?.presenceStatusMsg;
    return typeof message === "string" && message.trim().length > 0 ? message : null;
}

/** What a presence row shows of someone; an update that changes none of it has nothing to redraw. */
function shownPresence(user: User): string {
    return [user.presence, String(user.currentlyActive), presenceStatusMessage(user) ?? ""].join("\u0000");
}

function sanitizeUserIds(userIds: string[]): string[] {
    const unique = new Set<string>();
    const out: string[] = [];
    for (const userId of userIds) {
        if (typeof userId !== "string" || userId.length === 0 || unique.has(userId)) {
            continue;
        }
        unique.add(userId);
        out.push(userId);
    }
    return out;
}

/** The current time, refreshed every 30 seconds while active: enough for minute labels. */
function usePresenceClock(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) {
            return undefined;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, [active]);
    return now;
}

/**
 * Presence for each user. Pass `now` from a ticking clock where "Last active ..." is shown;
 * without it the labels are worked out once per update, which is enough for status dots.
 */
export function usePresenceMap(
    client: MatrixClient | null,
    userIds: string[],
    enabled: boolean,
    now?: number,
): Map<string, PresenceVm> {
    const idsKey = useMemo(() => userIds.join("\u0000"), [userIds]);
    const normalizedUserIds = useMemo(() => sanitizeUserIds(userIds), [idsKey]);
    const normalizedIdsKey = useMemo(() => normalizedUserIds.join("\u0000"), [normalizedUserIds]);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (!client || !enabled || normalizedUserIds.length === 0) {
            return undefined;
        }

        const trackedUsers = new Set(normalizedUserIds);
        const shown = new Map<string, string>();
        for (const userId of normalizedUserIds) {
            const user = client.getUser(userId);
            if (user) {
                shown.set(userId, shownPresence(user));
            }
        }
        const onPresenceUpdate = (_event: unknown, user: User): void => {
            if (!user?.userId || !trackedUsers.has(user.userId)) {
                return;
            }
            const next = shownPresence(user);
            if (shown.get(user.userId) === next) {
                return;
            }
            shown.set(user.userId, next);
            setRevision((value) => value + 1);
        };

        // Presence and CurrentlyActive fire only when those two change. A status message set, changed or
        // cleared by someone who stays online fires LastPresenceTs alone (every presence update fires it), so
        // without it a new status waited for a reload.
        const events = [UserEvent.Presence, UserEvent.CurrentlyActive, UserEvent.LastPresenceTs] as const;
        for (const event of events) {
            client.on(event, onPresenceUpdate as any);
        }
        return () => {
            for (const event of events) {
                client.removeListener(event, onPresenceUpdate as any);
            }
        };
    }, [client, enabled, normalizedIdsKey, normalizedUserIds]);

    return useMemo(() => {
        const output = new Map<string, PresenceVm>();
        if (!client || !enabled || normalizedUserIds.length === 0) {
            return output;
        }

        for (const userId of normalizedUserIds) {
            const user = client.getUser(userId);
            output.set(
                userId,
                buildPresenceVm(
                    {
                        presence: user?.presence,
                        currentlyActive: user?.currentlyActive,
                        lastActiveAgo: user?.lastActiveAgo,
                        receivedAt: user?.lastPresenceTs,
                        statusMessage: presenceStatusMessage(user),
                    },
                    now ?? Date.now(),
                ),
            );
        }

        return output;
    }, [client, enabled, normalizedIdsKey, normalizedUserIds, revision, now]);
}

export function usePresenceVm(
    client: MatrixClient | null,
    userId: string | null | undefined,
    enabled: boolean,
): PresenceVm | null {
    const normalizedUserId = typeof userId === "string" && userId.length > 0 ? userId : null;
    // One user's presence is shown with its "Last active ..." label, so keep it current.
    const now = usePresenceClock(enabled && normalizedUserId !== null);
    const map = usePresenceMap(client, normalizedUserId ? [normalizedUserId] : [], enabled, now);
    if (!normalizedUserId) {
        return null;
    }

    return map.get(normalizedUserId) ?? null;
}

