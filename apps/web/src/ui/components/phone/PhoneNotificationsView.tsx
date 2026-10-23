import React, { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { memberAvatarSources, roomAvatarSources } from "../../adapters/avatar";
import type { InboxInvite, InboxMention } from "../../notifications/phoneInbox";
import { Avatar } from "../Avatar";

interface PhoneNotificationsViewProps {
    client: MatrixClient;
    invites: InboxInvite[];
    mentions: InboxMention[];
    roomName: (roomId: string) => string;
    roomContext: (roomId: string) => string | null;
    isDirectRoom: (roomId: string) => boolean;
    userName: (roomId: string, userId: string) => string;
    onOpenMention: (mention: InboxMention) => void;
    onAcceptInvite: (invite: InboxInvite) => Promise<void>;
    onDeclineInvite: (invite: InboxInvite) => Promise<void>;
    /** Marks the listed mentions read and takes them off the list. */
    onClearMentions: () => void;
}

// Today shows the time, this week the weekday, anything older the date.
export function inboxTimeLabel(ts: number, now = Date.now()): string {
    if (!ts) {
        return "";
    }
    const date = new Date(ts);
    const today = new Date(now);
    if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    const yesterday = new Date(now - 86_400_000);
    if (date.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
    }
    if (now - ts < 6 * 86_400_000) {
        return date.toLocaleDateString(undefined, { weekday: "long" });
    }
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const INVITE_WHAT: Record<InboxInvite["kind"], string> = {
    space: "the space",
    direct: "a direct chat",
    room: "the channel",
};

export function PhoneNotificationsView({
    client,
    invites,
    mentions,
    roomName,
    roomContext,
    isDirectRoom,
    userName,
    onOpenMention,
    onAcceptInvite,
    onDeclineInvite,
    onClearMentions,
}: PhoneNotificationsViewProps): React.ReactElement {
    const [busyRoomId, setBusyRoomId] = useState<string | null>(null);

    const answer = async (invite: InboxInvite, action: (invite: InboxInvite) => Promise<void>): Promise<void> => {
        setBusyRoomId(invite.roomId);
        try {
            await action(invite);
        } finally {
            setBusyRoomId((current) => (current === invite.roomId ? null : current));
        }
    };

    return (
        <section className="phone-page phone-notifications" aria-label="Notifications">
            <header className="phone-page-head">
                <h2 className="phone-page-title">Notifications</h2>
                {mentions.length > 0 ? (
                    <button type="button" className="phone-page-head-action" onClick={onClearMentions}>
                        Clear mentions
                    </button>
                ) : null}
            </header>
            <div className="phone-page-body">
                {invites.length === 0 && mentions.length === 0 ? (
                    <p className="phone-empty">Nothing new. Mentions of you and invites to spaces and chats show up here.</p>
                ) : null}

                {invites.length > 0 ? <h3 className="phone-section-label">Invites</h3> : null}
                {invites.map((invite) => {
                    const room = client.getRoom(invite.roomId);
                    const inviterName = invite.inviterId ? userName(invite.roomId, invite.inviterId) : "Someone";
                    const busy = busyRoomId === invite.roomId;
                    return (
                        <div key={invite.roomId} className="phone-notif is-unread">
                            <Avatar
                                className="phone-notif-avatar"
                                name={roomName(invite.roomId)}
                                sources={room ? roomAvatarSources(client, room, 64) : []}
                                seed={invite.roomId}
                            />
                            <div className="phone-notif-text">
                                <span>
                                    <b>{inviterName}</b> invited you to {INVITE_WHAT[invite.kind]}{" "}
                                    {invite.kind === "direct" ? null : <b>{roomName(invite.roomId)}</b>}
                                </span>
                                <span className="phone-notif-when">{inboxTimeLabel(invite.ts)}</span>
                                <span className="phone-notif-actions">
                                    <button
                                        type="button"
                                        className="phone-button phone-button-primary"
                                        disabled={busy}
                                        onClick={() => void answer(invite, onAcceptInvite)}
                                    >
                                        {busy ? "Joining…" : "Accept"}
                                    </button>
                                    <button
                                        type="button"
                                        className="phone-button"
                                        disabled={busy}
                                        onClick={() => void answer(invite, onDeclineInvite)}
                                    >
                                        Decline
                                    </button>
                                </span>
                            </div>
                        </div>
                    );
                })}

                {mentions.length > 0 ? <h3 className="phone-section-label">Mentions</h3> : null}
                {mentions.map((mention) => {
                    const room = client.getRoom(mention.roomId);
                    const context = roomContext(mention.roomId);
                    return (
                        <button
                            key={mention.eventId}
                            type="button"
                            className={`phone-notif${mention.unread ? " is-unread" : ""}`}
                            onClick={() => onOpenMention(mention)}
                        >
                            <Avatar
                                className="phone-notif-avatar"
                                name={userName(mention.roomId, mention.senderId)}
                                sources={memberAvatarSources(client, room?.getMember(mention.senderId), 64)}
                                seed={mention.senderId}
                                userId={mention.senderId}
                            />
                            <span className="phone-notif-text">
                                <span>
                                    <b>{userName(mention.roomId, mention.senderId)}</b> mentioned you
                                    {isDirectRoom(mention.roomId) ? null : (
                                        <>
                                            {" "}
                                            in <b>{roomName(mention.roomId)}</b>
                                        </>
                                    )}
                                </span>
                                <span className="phone-notif-quote">{mention.body}</span>
                                <span className="phone-notif-when">
                                    {context ? `${context} · ` : ""}
                                    {inboxTimeLabel(mention.ts)}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
