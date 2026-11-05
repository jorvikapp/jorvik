import type { Room } from "matrix-js-sdk/src/matrix";

/**
 * What the menu on right-clicking (or long-pressing) someone offers. Two sets: one on a conversation in the
 * direct messages list, one on a member of a Space or the author of a message. Built here from plain facts,
 * so which items show and how they're labelled can be checked without any screen.
 */

export type UserMenuTone = "default" | "danger" | "warning";

export interface UserMenuItem {
    kind: "item";
    id: string;
    label: string;
    tone?: UserMenuTone;
    run: () => void;
}

export type UserMenuEntry = UserMenuItem | { kind: "separator"; id: string } | { kind: "label"; id: string; label: string };

const item = (id: string, label: string, run: () => void, tone: UserMenuTone = "default"): UserMenuItem => ({
    kind: "item",
    id,
    label,
    run,
    tone,
});

/** Separators and labels that would end up first, last or doubled are left out. */
function tidy(entries: UserMenuEntry[]): UserMenuEntry[] {
    const out: UserMenuEntry[] = [];
    for (const entry of entries) {
        const previous = out[out.length - 1];
        if (entry.kind === "separator" && (!previous || previous.kind === "separator")) {
            continue;
        }
        out.push(entry);
    }
    while (out.length > 0 && out[out.length - 1].kind !== "item") {
        out.pop();
    }
    return out;
}

/** Yourself: only what makes sense about you. */
function selfEntries(actions: { profile: () => void; copyUserId: () => void }): UserMenuEntry[] {
    return [item("profile", "Profile", actions.profile), item("copy-id", "Copy user ID", actions.copyUserId)];
}

// ---- A: a conversation in the direct messages list ----

export interface DmMenuFacts {
    /** The other person in a one-to-one conversation; null in a group conversation. */
    partnerId: string | null;
    ownUserId: string;
    muted: boolean;
    favourite: boolean;
}

export interface DmMenuActions {
    profile: () => void;
    startCall: () => void;
    markRead: () => void;
    toggleMute: () => void;
    toggleFavourite: () => void;
    copyUserId: () => void;
    close: () => void;
    block: () => void;
}

export function dmMenuEntries(facts: DmMenuFacts, actions: DmMenuActions): UserMenuEntry[] {
    if (facts.partnerId && facts.partnerId === facts.ownUserId) {
        return selfEntries(actions);
    }
    const person = facts.partnerId !== null;
    return tidy([
        ...(person ? [item("profile", "Profile", actions.profile), item("call", "Start call", actions.startCall)] : []),
        item("mark-read", "Mark as read", actions.markRead),
        item("mute", facts.muted ? "Unmute" : "Mute", actions.toggleMute),
        item("favourite", facts.favourite ? "Unfavourite" : "Favourite", actions.toggleFavourite),
        ...(person ? [item("copy-id", "Copy user ID", actions.copyUserId)] : []),
        { kind: "separator", id: "sep-close" },
        item("close", "Close DM", actions.close),
        ...(person ? [item("block", "Block", actions.block, "danger")] : []),
    ]);
}

// ---- B: a member of a Space, or the author of a message ----

export interface MemberMenuFacts {
    userId: string;
    ownUserId: string;
    /** There's a message box this person can be mentioned in. */
    canMention: boolean;
    /** Removing and banning, by the rank the place asks for; never in a direct message. */
    canKick: boolean;
    canBan: boolean;
    /** "space" for a Space and its channels, "room" for a room on its own. */
    scope: "space" | "room";
}

export interface MemberMenuActions {
    profile: () => void;
    message: () => void;
    mention: () => void;
    copyUserId: () => void;
    block: () => void;
    remove: () => void;
    ban: () => void;
}

export function memberMenuEntries(facts: MemberMenuFacts, actions: MemberMenuActions): UserMenuEntry[] {
    if (facts.userId === facts.ownUserId) {
        return selfEntries(actions);
    }
    const where = facts.scope === "space" ? "space" : "room";
    const moderation = facts.canKick || facts.canBan;
    return tidy([
        item("profile", "Profile", actions.profile),
        item("message", "Message", actions.message),
        ...(facts.canMention ? [item("mention", "Mention", actions.mention)] : []),
        item("copy-id", "Copy user ID", actions.copyUserId),
        { kind: "separator", id: "sep-block" },
        item("block", "Block", actions.block, "danger"),
        ...(moderation
            ? ([
                  { kind: "separator", id: "sep-mod" },
                  { kind: "label", id: "label-mod", label: "Moderators only" },
              ] as UserMenuEntry[])
            : []),
        ...(facts.canKick ? [item("remove", `Remove from ${where}`, actions.remove, "warning")] : []),
        ...(facts.canBan ? [item("ban", `Ban from ${where}`, actions.ban, "danger")] : []),
    ]);
}

// ---- who may remove and ban ----

export function powerLevelOf(room: Room, userId: string): number {
    return room.getMember(userId)?.powerLevel ?? 0;
}

/** Whether you hold the rank this room asks for to remove people, and to ban them. */
export function moderationRights(room: Room | null, ownUserId: string): { canKick: boolean; canBan: boolean } {
    if (!room || !ownUserId) {
        return { canKick: false, canBan: false };
    }
    const level = powerLevelOf(room, ownUserId);
    return {
        canKick: room.currentState.hasSufficientPowerLevelFor("kick", level),
        canBan: room.currentState.hasSufficientPowerLevelFor("ban", level),
    };
}
