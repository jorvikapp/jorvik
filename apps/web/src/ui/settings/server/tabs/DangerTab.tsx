import React, { useState } from "react";
import { EventType, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import type { ToastState } from "../../../components/Toast";
import { DeleteSpaceDialog } from "./DeleteSpaceDialog";

interface DangerTabProps {
    client: MatrixClient;
    spaceRoom: Room;
    onLeftSpace: (spaceId: string) => void;
    onToast: (toast: Omit<ToastState, "id">) => void;
}

export function DangerTab({ client, spaceRoom, onLeftSpace, onToast }: DangerTabProps): React.ReactElement {
    const [leaving, setLeaving] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const spaceName = spaceRoom.name || spaceRoom.getCanonicalAlias() || spaceRoom.roomId;
    const myUserId = client.getUserId() ?? "";
    const myLevel = spaceRoom.getMember(myUserId)?.powerLevel ?? 0;
    const canDelete =
        spaceRoom.currentState.maySendStateEvent(EventType.RoomJoinRules, myUserId) &&
        spaceRoom.currentState.hasSufficientPowerLevelFor("kick", myLevel);

    const leaveSpace = async (): Promise<void> => {
        const confirmed = window.confirm(`Leave "${spaceName}"?`);
        if (!confirmed) {
            return;
        }

        setLeaving(true);
        try {
            await client.leave(spaceRoom.roomId);
            onLeftSpace(spaceRoom.roomId);
            onToast({ type: "success", message: `Left ${spaceName}.` });
        } catch (error) {
            onToast({
                type: "error",
                message: error instanceof Error ? error.message : "Failed to leave server.",
            });
        } finally {
            setLeaving(false);
        }
    };

    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Danger zone</h2>
            <p className="settings-tab-description">Irreversible actions for this server.</p>

            <div className="settings-danger-card">
                <div>
                    <h3>Leave server</h3>
                    <p>
                        You will leave this Space and lose quick access to its channels until invited again or re-joined.
                    </p>
                </div>
                <button
                    type="button"
                    className="settings-button settings-button-danger"
                    onClick={() => void leaveSpace()}
                    disabled={leaving}
                >
                    {leaving ? "Leaving..." : "Leave server"}
                </button>
            </div>

            <div className="settings-danger-card">
                <div>
                    <h3>Delete server</h3>
                    <p>
                        {canDelete
                            ? "Removes everyone from this server and its channels, closes them so nobody can rejoin, and leaves. Messages stay on servers that already have them."
                            : "Only someone who can remove members and change settings in this server can delete it."}
                    </p>
                </div>
                <button
                    type="button"
                    className="settings-button settings-button-danger"
                    onClick={() => setDeleteOpen(true)}
                    disabled={!canDelete || leaving}
                >
                    Delete server
                </button>
            </div>

            <DeleteSpaceDialog
                client={client}
                spaceRoom={spaceRoom}
                spaceName={spaceName}
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onDeleted={({ remaining }) => {
                    setDeleteOpen(false);
                    onLeftSpace(spaceRoom.roomId);
                    onToast(
                        remaining.length === 0
                            ? { type: "success", message: `Deleted ${spaceName}.` }
                            : {
                                  type: "info",
                                  message: `Deleted ${spaceName}, but ${remaining.length} ${remaining.length === 1 ? "person" : "people"} could not be removed and still have access.`,
                              },
                    );
                }}
            />
        </div>
    );
}
