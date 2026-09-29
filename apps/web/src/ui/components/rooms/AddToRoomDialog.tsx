import React, { useEffect, useMemo, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import { getDirectRoomIds } from "../../adapters/dmAdapter";
import { inviteUsersToRoom } from "../../adapters/inviteAdapter";
import { RoomDialog } from "./RoomDialog";
import { getRoomDisplayName } from "./roomAdminUtils";

interface AddToRoomDialogProps {
    client: MatrixClient;
    /** Who to invite; the dialog is open while this is set. */
    userId: string | null;
    onClose: () => void;
    onInvited: (message: string) => void;
}

interface Candidate {
    room: Room;
    label: string;
    detail: string | null;
}

/**
 * The profile's Add button: invite that person to one of your spaces or
 * channels. Lists only places you may invite to and they are not already in.
 */
export function AddToRoomDialog({ client, userId, onClose, onInvited }: AddToRoomDialogProps): React.ReactElement | null {
    const [filter, setFilter] = useState("");
    const [invitingRoomId, setInvitingRoomId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const open = userId !== null;

    useEffect(() => {
        setFilter("");
        setInvitingRoomId(null);
        setError(null);
    }, [userId]);

    const candidates = useMemo<Candidate[]>(() => {
        const myUserId = client.getUserId();
        if (!userId || !myUserId) {
            return [];
        }
        const directRoomIds = getDirectRoomIds(client);
        const joined = client.getRooms().filter((room) => room.getMyMembership() === "join");
        const spaceNameByChildId = new Map<string, string>();
        for (const space of joined.filter((room) => room.isSpaceRoom())) {
            for (const child of space.currentState.getStateEvents("m.space.child")) {
                const childId = child.getStateKey();
                if (childId && !spaceNameByChildId.has(childId)) {
                    spaceNameByChildId.set(childId, getRoomDisplayName(space));
                }
            }
        }

        return joined
            .filter((room) => !directRoomIds.has(room.roomId))
            .filter((room) => room.canInvite(myUserId))
            .filter((room) => {
                const membership = room.getMember(userId)?.membership;
                return membership !== "join" && membership !== "invite" && membership !== "ban";
            })
            .map((room) => ({
                room,
                label: room.isSpaceRoom() ? getRoomDisplayName(room) : `# ${getRoomDisplayName(room)}`,
                detail: room.isSpaceRoom() ? "Space" : spaceNameByChildId.get(room.roomId) ?? null,
            }))
            .sort((left, right) => {
                const bySpace = Number(right.room.isSpaceRoom()) - Number(left.room.isSpaceRoom());
                return bySpace !== 0 ? bySpace : left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
            });
    }, [client, userId]);

    if (!open) {
        return null;
    }

    const name = client.getUser(userId)?.displayName || userId;
    const needle = filter.trim().toLowerCase();
    const shown = needle
        ? candidates.filter((candidate) => `${candidate.label} ${candidate.detail ?? ""}`.toLowerCase().includes(needle))
        : candidates;

    const invite = async (candidate: Candidate): Promise<void> => {
        setInvitingRoomId(candidate.room.roomId);
        setError(null);
        try {
            const result = await inviteUsersToRoom(client, candidate.room.roomId, userId, "");
            if (result.invited.length === 0) {
                setError(result.failed[0]?.message ?? "Could not send the invite.");
                return;
            }
            onInvited(`Invited ${name} to ${getRoomDisplayName(candidate.room)}.`);
            onClose();
        } catch (inviteError) {
            setError(inviteError instanceof Error ? inviteError.message : "Could not send the invite.");
        } finally {
            setInvitingRoomId(null);
        }
    };

    return (
        <RoomDialog
            open={open}
            title={`Add ${name}`}
            onClose={onClose}
            footer={
                <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={onClose}>
                    Cancel
                </button>
            }
        >
            {candidates.length === 0 ? (
                <p className="room-dialog-muted">There are no spaces or channels you can invite {name} to.</p>
            ) : (
                <>
                    <input
                        className="room-dialog-input"
                        type="text"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder="Search spaces and channels"
                        autoFocus
                    />
                    <div className="add-to-room-list">
                        {shown.map((candidate) => (
                            <button
                                type="button"
                                key={candidate.room.roomId}
                                className="add-to-room-item"
                                disabled={invitingRoomId !== null}
                                onClick={() => void invite(candidate)}
                            >
                                <span className="add-to-room-label">{candidate.label}</span>
                                {candidate.detail ? <span className="add-to-room-detail">{candidate.detail}</span> : null}
                                <span className="add-to-room-action">
                                    {invitingRoomId === candidate.room.roomId ? "Inviting..." : "Invite"}
                                </span>
                            </button>
                        ))}
                        {shown.length === 0 ? <p className="room-dialog-muted">No matches.</p> : null}
                    </div>
                </>
            )}
            {error ? <p className="room-dialog-error">{error}</p> : null}
        </RoomDialog>
    );
}
