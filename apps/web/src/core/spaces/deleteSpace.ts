import { EventType, JoinRule, Visibility, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

/**
 * Matrix has no "delete room". What a space owner can do is empty it: remove
 * everyone, close it to invites only, take it off the directory, and leave.
 * That is what deleting a server means here, for the space and every channel
 * in it. Messages stay on servers that already have them, and a server admin
 * can purge the emptied rooms afterwards.
 */

export interface DeletionTarget {
    room: Room;
    name: string;
    /** Members who cannot be removed: same or higher power level than us. */
    unremovable: string[];
}

export interface SpaceDeletionPlan {
    /** Channels first, then the space itself. */
    targets: DeletionTarget[];
    /** Children we are not in, so we can only unlink them. */
    notJoinedChildIds: string[];
    /** Why this user cannot delete the space, if they cannot. */
    blockedReason: string | null;
}

export interface SpaceDeletionResult {
    /** People who still have access, per room. */
    remaining: Array<{ roomName: string; userId: string }>;
}

const REMOVE_REASON = "Server deleted";
const MAX_RATE_LIMIT_RETRIES = 12;

function roomName(room: Room): string {
    return room.name || room.getCanonicalAlias() || room.roomId;
}

function childRoomIds(space: Room): string[] {
    return space.currentState
        .getStateEvents(EventType.SpaceChild)
        .filter((event) => Array.isArray(event.getContent().via) && event.getContent().via.length > 0)
        .map((event) => event.getStateKey())
        .filter((stateKey): stateKey is string => typeof stateKey === "string" && stateKey.length > 0);
}

function powerLevelOf(room: Room, userId: string): number {
    return room.getMember(userId)?.powerLevel ?? 0;
}

function canClose(room: Room, userId: string): boolean {
    const state = room.currentState;
    return state.maySendStateEvent(EventType.RoomJoinRules, userId) && state.hasSufficientPowerLevelFor("kick", powerLevelOf(room, userId));
}

/** Everyone else still in the room or invited to it. */
function otherMembers(room: Room, userId: string): string[] {
    return room
        .getMembers()
        .filter((member) => member.userId !== userId && (member.membership === "join" || member.membership === "invite"))
        .map((member) => member.userId);
}

export async function planSpaceDeletion(client: MatrixClient, space: Room): Promise<SpaceDeletionPlan> {
    const userId = client.getSafeUserId();
    if (!canClose(space, userId)) {
        return {
            targets: [],
            notJoinedChildIds: [],
            blockedReason: "Only someone who can remove members and change settings in this server can delete it.",
        };
    }

    const children: Room[] = [];
    const notJoinedChildIds: string[] = [];
    for (const childId of childRoomIds(space)) {
        const child = client.getRoom(childId);
        if (child?.getMyMembership() === "join") {
            children.push(child);
        } else {
            notJoinedChildIds.push(childId);
        }
    }

    const targets: DeletionTarget[] = [];
    for (const room of [...children, space]) {
        // Lazy-loaded member lists miss people; everyone has to be known to remove them.
        await room.loadMembersIfNeeded();
        const myLevel = powerLevelOf(room, userId);
        const unremovable = canClose(room, userId)
            ? otherMembers(room, userId).filter((memberId) => powerLevelOf(room, memberId) >= myLevel)
            : otherMembers(room, userId);
        targets.push({ room, name: roomName(room), unremovable });
    }
    return { targets, notJoinedChildIds, blockedReason: null };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Synapse allows a burst of about ten events, then one every few seconds. */
async function withRateLimitRetry<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await action();
        } catch (error) {
            const candidate = error as { errcode?: string; httpStatus?: number; data?: { retry_after_ms?: unknown } };
            const rateLimited = candidate?.errcode === "M_LIMIT_EXCEEDED" || candidate?.httpStatus === 429;
            if (!rateLimited || attempt >= MAX_RATE_LIMIT_RETRIES) {
                throw error;
            }
            const stated = candidate?.data?.retry_after_ms;
            await sleep(typeof stated === "number" && stated > 0 ? Math.min(stated, 30_000) : 2_000);
        }
    }
}

export async function deleteSpace(
    client: MatrixClient,
    space: Room,
    plan: SpaceDeletionPlan,
    onProgress: (message: string) => void,
): Promise<SpaceDeletionResult> {
    const userId = client.getSafeUserId();
    const remaining: SpaceDeletionResult["remaining"] = [];

    for (const childId of plan.notJoinedChildIds) {
        onProgress("Unlinking channels you are not in...");
        await withRateLimitRetry(() => client.sendStateEvent(space.roomId, EventType.SpaceChild, {}, childId)).catch(() => undefined);
    }

    for (const target of plan.targets) {
        const { room, name } = target;
        const label = room.roomId === space.roomId ? name : `#${name}`;

        onProgress(`Closing ${label}...`);
        await withRateLimitRetry(() => client.sendStateEvent(room.roomId, EventType.RoomJoinRules, { join_rule: JoinRule.Invite }, ""));
        await withRateLimitRetry(() => client.setRoomDirectoryVisibility(room.roomId, Visibility.Private)).catch(() => undefined);

        const removable = otherMembers(room, userId).filter((memberId) => !target.unremovable.includes(memberId));
        for (const [index, memberId] of removable.entries()) {
            onProgress(`Removing members from ${label} (${index + 1} of ${removable.length})...`);
            try {
                await withRateLimitRetry(() => client.kick(room.roomId, memberId, REMOVE_REASON));
            } catch {
                remaining.push({ roomName: label, userId: memberId });
            }
        }
        for (const memberId of target.unremovable) {
            remaining.push({ roomName: label, userId: memberId });
        }

        if (room.roomId !== space.roomId) {
            await withRateLimitRetry(() => client.sendStateEvent(space.roomId, EventType.SpaceChild, {}, room.roomId)).catch(() => undefined);
        }

        onProgress(`Leaving ${label}...`);
        await withRateLimitRetry(() => client.leave(room.roomId));
        await client.forget(room.roomId).catch(() => undefined);
    }

    return { remaining };
}
