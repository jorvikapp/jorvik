import React, { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    BADGE_IDS,
    BADGE_LABELS,
    BADGES_WELL_KNOWN_KEY,
    createBadgesRoom,
    getUserBadges,
    saveUserBadges,
    type BadgeId,
} from "../../../core/badges/userBadges";
import { useBadgeSettings } from "../../hooks/useUserBadges";
import { RoomDialog } from "../rooms/RoomDialog";
import { BadgeIcon } from "./UserBadges";

const BADGE_DESCRIPTIONS: Record<BadgeId, string> = {
    staff: "Runs or helps run Jorvik.",
    bug_finder: "Found bugs that got fixed.",
    tester: "Tries new versions first.",
    contributor: "Helped build Jorvik.",
    early_supporter: "Was here early.",
};

interface BadgesDialogProps {
    client: MatrixClient;
    userId: string;
    displayName: string;
    open: boolean;
    onClose: () => void;
}

export function BadgesDialog({ client, userId, displayName, open, onClose }: BadgesDialogProps): React.ReactElement | null {
    const settings = useBadgeSettings();
    const [selected, setSelected] = useState<readonly BadgeId[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (open) {
            setSelected(getUserBadges(userId));
            setBusy(false);
            setError(null);
            setCopied(false);
        }
    }, [open, userId]);

    const toggle = (id: BadgeId, on: boolean): void => {
        setSelected((current) => (on ? [...current, id] : current.filter((badge) => badge !== id)));
    };

    const save = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            await saveUserBadges(client, userId, selected);
            onClose();
        } catch (saveError) {
            setError(`Couldn't save the badges: ${messageOf(saveError)}`);
            setBusy(false);
        }
    };

    const setUp = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            setCreatedRoomId(await createBadgesRoom(client, settings.managers));
        } catch (setupError) {
            setError(`Couldn't set up badges: ${messageOf(setupError)}`);
        } finally {
            setBusy(false);
        }
    };

    if (!settings.roomId) {
        const snippet = createdRoomId
            ? `"${BADGES_WELL_KNOWN_KEY}": ${JSON.stringify({ room_id: createdRoomId, managers: settings.managers })}`
            : "";
        const copy = async (): Promise<void> => {
            try {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
            } catch {
                setError("Couldn't copy. Select the text and copy it instead.");
            }
        };

        return (
            <RoomDialog
                open={open}
                title="Set up badges"
                onClose={onClose}
                footer={
                    createdRoomId ? (
                        <button type="button" className="room-dialog-button room-dialog-button-primary" onClick={onClose}>
                            Done
                        </button>
                    ) : (
                        <>
                            <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={onClose} disabled={busy}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="room-dialog-button room-dialog-button-primary"
                                onClick={() => void setUp()}
                                disabled={busy}
                            >
                                {busy ? "Setting up..." : "Set up badges"}
                            </button>
                        </>
                    )
                }
            >
                {createdRoomId ? (
                    <>
                        <p className="room-dialog-muted">
                            The badges room is ready. One last step for whoever runs the server: add this to the server's
                            /.well-known/matrix/client, and badges can be handed out.
                        </p>
                        <pre className="badges-dialog-snippet">{snippet}</pre>
                        <div>
                            <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={() => void copy()}>
                                {copied ? "Copied" : "Copy"}
                            </button>
                        </div>
                    </>
                ) : (
                    <p className="room-dialog-muted">
                        Badges aren't set up on this server yet. Setting up makes a small locked room on the server that
                        holds the list. Badge managers can change it; everyone else can only read it.
                    </p>
                )}
                {error ? <p className="room-dialog-error">{error}</p> : null}
            </RoomDialog>
        );
    }

    const unchanged =
        selected.length === getUserBadges(userId).length && selected.every((id) => getUserBadges(userId).includes(id));

    return (
        <RoomDialog
            open={open}
            title={`Badges for ${displayName}`}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={onClose} disabled={busy}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="room-dialog-button room-dialog-button-primary"
                        onClick={() => void save()}
                        disabled={busy || unchanged}
                    >
                        {busy ? "Saving..." : "Save"}
                    </button>
                </>
            }
        >
            <div className="badges-dialog-list">
                {BADGE_IDS.map((id) => (
                    <label key={id} className={`badges-dialog-option user-badge-${id}`}>
                        <input
                            type="checkbox"
                            checked={selected.includes(id)}
                            onChange={(event) => toggle(id, event.target.checked)}
                            disabled={busy}
                        />
                        <span className="badges-dialog-icon">
                            <BadgeIcon id={id} />
                        </span>
                        <span className="badges-dialog-text">
                            <span className="badges-dialog-name">{BADGE_LABELS[id]}</span>
                            <span className="room-dialog-helper">{BADGE_DESCRIPTIONS[id]}</span>
                        </span>
                    </label>
                ))}
            </div>
            <p className="room-dialog-helper">Everyone sees the change within a few minutes.</p>
            {error ? <p className="room-dialog-error">{error}</p> : null}
        </RoomDialog>
    );
}

function messageOf(error: unknown): string {
    return error instanceof Error && error.message ? error.message : "try again.";
}
