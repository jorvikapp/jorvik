import React, { useEffect, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import { deleteSpace, planSpaceDeletion, type SpaceDeletionPlan, type SpaceDeletionResult } from "../../../../core/spaces/deleteSpace";
import { RoomDialog } from "../../../components/rooms/RoomDialog";

interface DeleteSpaceDialogProps {
    client: MatrixClient;
    spaceRoom: Room;
    spaceName: string;
    open: boolean;
    onClose: () => void;
    onDeleted: (result: SpaceDeletionResult) => void;
}

export function DeleteSpaceDialog({ client, spaceRoom, spaceName, open, onClose, onDeleted }: DeleteSpaceDialogProps): React.ReactElement | null {
    const [plan, setPlan] = useState<SpaceDeletionPlan | null>(null);
    const [confirmation, setConfirmation] = useState("");
    const [progress, setProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const running = progress !== null;

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        setPlan(null);
        setConfirmation("");
        setProgress(null);
        setError(null);
        planSpaceDeletion(client, spaceRoom).then(
            (nextPlan) => !cancelled && setPlan(nextPlan),
            (planError) => !cancelled && setError(planError instanceof Error ? planError.message : "Could not check this server."),
        );
        return () => {
            cancelled = true;
        };
    }, [client, open, spaceRoom]);

    const channelCount = plan ? plan.targets.length - 1 : 0;
    const unremovable = plan?.targets.flatMap((target) =>
        target.unremovable.map((userId) => `${userId} in ${target.room.roomId === spaceRoom.roomId ? target.name : `#${target.name}`}`),
    ) ?? [];

    const run = async (): Promise<void> => {
        if (!plan) {
            return;
        }
        setError(null);
        setProgress("Starting...");
        try {
            const result = await deleteSpace(client, spaceRoom, plan, setProgress);
            onDeleted(result);
        } catch (runError) {
            setError(runError instanceof Error ? runError.message : "Deleting stopped part way. Try again.");
            setProgress(null);
        }
    };

    return (
        <RoomDialog
            open={open}
            title={`Delete ${spaceName}?`}
            onClose={() => {
                if (!running) onClose();
            }}
            footer={
                <>
                    <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={onClose} disabled={running}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="room-dialog-button room-dialog-button-danger"
                        onClick={() => void run()}
                        disabled={running || !plan || plan.blockedReason !== null || confirmation !== spaceName}
                    >
                        {running ? "Deleting..." : "Delete server"}
                    </button>
                </>
            }
        >
            {!plan && !error ? <p className="room-dialog-muted">Checking members...</p> : null}
            {plan?.blockedReason ? <p className="room-dialog-warning">{plan.blockedReason}</p> : null}
            {plan && !plan.blockedReason ? (
                <>
                    <p className="room-dialog-muted">
                        This removes everyone from {spaceName}
                        {channelCount > 0 ? ` and its ${channelCount} channel${channelCount === 1 ? "" : "s"}` : ""}, closes
                        {channelCount > 0 ? " them" : " it"} so nobody can rejoin, and takes {channelCount > 0 ? "them" : "it"} off
                        the room directory. Then you leave. Messages stay on servers that already have them. This cannot be
                        undone.
                    </p>
                    {unremovable.length > 0 ? (
                        <div className="room-dialog-warning">
                            These people have the same rank as you or higher, so they cannot be removed and will keep access:
                            <ul className="delete-space-list">
                                {unremovable.map((entry) => (
                                    <li key={entry}>{entry}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {plan.notJoinedChildIds.length > 0 ? (
                        <p className="room-dialog-muted">
                            {plan.notJoinedChildIds.length} channel{plan.notJoinedChildIds.length === 1 ? " you are" : "s you are"} not
                            in will only be unlinked from the server.
                        </p>
                    ) : null}
                    <label className="room-dialog-field">
                        <span>Type {spaceName} to confirm</span>
                        <input
                            className="room-dialog-input"
                            type="text"
                            value={confirmation}
                            onChange={(event) => setConfirmation(event.target.value)}
                            placeholder={spaceName}
                            disabled={running}
                            autoFocus
                        />
                    </label>
                </>
            ) : null}
            {progress ? <p className="room-dialog-muted">{progress}</p> : null}
            {error ? <p className="room-dialog-error">{error}</p> : null}
        </RoomDialog>
    );
}
