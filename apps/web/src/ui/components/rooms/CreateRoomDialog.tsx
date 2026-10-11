import React, { useEffect, useState } from "react";
import { EventType, Preset, Visibility, type MatrixClient } from "matrix-js-sdk/src/matrix";

import { waitForSpaceChild } from "../../../core/spaces/waitForSpaceChild";
import { formatUserIdForDisplay } from "../../../core/users/formatUserId";
import { resolveInviteTargets } from "../../adapters/inviteAdapter";
import { RoomDialog } from "./RoomDialog";
import {
    HEOROT_SPACE_CHILD_CHANNEL_TYPE_KEY,
    HEOROT_SPACE_CHILD_VOICE_KEY,
    HEOROT_VOICE_CHANNEL_EVENT,
    MATRIX_CALL_COMPAT_EVENT,
} from "../../voice/voiceChannel";

interface CreateRoomDialogProps {
    client: MatrixClient;
    open: boolean;
    spaceParentId?: string | null;
    onClose: () => void;
    onCreated?: (roomId: string) => void;
}

function normalizeAliasLocalPart(input: string): string {
    let normalized = input.trim();
    if (normalized.startsWith("#")) {
        normalized = normalized.slice(1);
    }

    const serverSeparator = normalized.indexOf(":");
    if (serverSeparator > 0) {
        normalized = normalized.slice(0, serverSeparator);
    }

    return normalized;
}

function getViaServerFromUserId(userId: string | null): string | null {
    if (!userId) {
        return null;
    }

    const separatorIndex = userId.indexOf(":");
    if (separatorIndex < 0 || separatorIndex === userId.length - 1) {
        return null;
    }

    const domain = userId.slice(separatorIndex + 1).trim();
    return domain.length > 0 ? domain : null;
}

export function CreateRoomDialog({
    client,
    open,
    spaceParentId = null,
    onClose,
    onCreated,
}: CreateRoomDialogProps): React.ReactElement | null {
    const [name, setName] = useState("");
    const [topic, setTopic] = useState("");
    const [visibility, setVisibility] = useState<Visibility>(Visibility.Private);
    const [aliasLocalPart, setAliasLocalPart] = useState("");
    const [inviteInput, setInviteInput] = useState("");
    const [enableEncryption, setEnableEncryption] = useState(true);
    const [voiceChannel, setVoiceChannel] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Adding a room to a space is sending the space's m.space.child for it. Without
    // that right the room would be made and then left outside the space.
    const myUserId = client.getUserId() ?? "";
    const spaceRoom = spaceParentId ? client.getRoom(spaceParentId) : null;
    const canAddToSpace =
        !spaceParentId || Boolean(spaceRoom && myUserId && spaceRoom.currentState.maySendStateEvent(EventType.SpaceChild, myUserId));

    useEffect(() => {
        if (!open) {
            return;
        }

        setName("");
        setTopic("");
        setVisibility(Visibility.Private);
        setAliasLocalPart("");
        setInviteInput("");
        setEnableEncryption(true);
        setVoiceChannel(false);
        setSaving(false);
        setError(null);
    }, [open]);

    const submit = async (): Promise<void> => {
        const normalizedAlias = normalizeAliasLocalPart(aliasLocalPart);

        setSaving(true);
        setError(null);

        try {
            // Checked before anything is made: the server refuses the whole room over
            // one ID it can't read, and takes an invite for someone it doesn't have.
            const inviteTargets = await resolveInviteTargets(client, inviteInput);
            const inviteFailure = inviteTargets.failed[0];
            if (inviteFailure) {
                setError(`${formatUserIdForDisplay(inviteFailure.userId, client.getDomain())}: ${inviteFailure.message}`);
                return;
            }

            const initialState: Array<{ type: string; state_key: string; content: Record<string, unknown> }> = [];
            // Voice channels too: a call is end-to-end encrypted when its room is.
            if (enableEncryption) {
                initialState.push({
                    type: EventType.RoomEncryption,
                    state_key: "",
                    content: { algorithm: "m.megolm.v1.aes-sha2" },
                });
            }
            if (voiceChannel) {
                initialState.push({
                    type: HEOROT_VOICE_CHANNEL_EVENT,
                    state_key: "",
                    content: {
                        enabled: true,
                        version: 1,
                        chat_suppressed: true,
                    },
                });
                initialState.push({
                    type: MATRIX_CALL_COMPAT_EVENT,
                    state_key: "",
                    content: {
                        type: "voice",
                        intent: "voice",
                        chat_suppressed: true,
                    },
                });
            }

            const options: Parameters<MatrixClient["createRoom"]>[0] = {
                name: name.trim() || undefined,
                topic: topic.trim() || undefined,
                visibility,
                preset: visibility === Visibility.Public ? Preset.PublicChat : Preset.PrivateChat,
                invite: inviteTargets.userIds.length > 0 ? inviteTargets.userIds : undefined,
                room_alias_name: visibility === Visibility.Public && normalizedAlias ? normalizedAlias : undefined,
                initial_state: initialState.length > 0 ? initialState : undefined,
            };

            const response = await client.createRoom(options);
            if (spaceParentId) {
                const viaServer = getViaServerFromUserId(client.getUserId());
                const via = viaServer ? [viaServer] : undefined;

                const childContent: Record<string, unknown> = {
                    suggested: true,
                };
                if (voiceChannel) {
                    childContent[HEOROT_SPACE_CHILD_CHANNEL_TYPE_KEY] = "voice";
                    childContent[HEOROT_SPACE_CHILD_VOICE_KEY] = true;
                }
                if (via) {
                    childContent.via = via;
                }
                await client.sendStateEvent(
                    spaceParentId,
                    EventType.SpaceChild,
                    childContent as any,
                    response.room_id,
                );

                const parentContent: Record<string, unknown> = {
                    canonical: true,
                };
                if (via) {
                    parentContent.via = via;
                }
                await client.sendStateEvent(
                    response.room_id,
                    EventType.SpaceParent,
                    parentContent as any,
                    spaceParentId,
                );

                // Until the sync brings these back, the space doesn't list the channel here.
                await waitForSpaceChild(client, spaceParentId, response.room_id);
            }

            onCreated?.(response.room_id);
            onClose();
        } catch (createError) {
            const message = createError instanceof Error ? createError.message : "Failed to create room.";
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <RoomDialog
            open={open}
            title={spaceParentId ? "Create channel" : "Create room"}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="room-dialog-button room-dialog-button-primary"
                        onClick={() => void submit()}
                        disabled={saving || !canAddToSpace}
                    >
                        {saving ? "Creating..." : "Create"}
                    </button>
                </>
            }
        >
            {spaceParentId ? (
                <p className="room-dialog-muted">
                    This room will be added to the selected Space as a channel.
                </p>
            ) : null}
            <label className="room-dialog-field">
                <span>Room name</span>
                <input
                    className="room-dialog-input"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="General"
                    disabled={saving}
                />
            </label>
            <label className="room-dialog-field">
                <span>Topic</span>
                <input
                    className="room-dialog-input"
                    type="text"
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    placeholder="Optional topic"
                    disabled={saving}
                />
            </label>
            <label className="room-dialog-field">
                <span>Visibility</span>
                <select
                    className="room-dialog-input"
                    value={visibility}
                    onChange={(event) => setVisibility(event.target.value as Visibility)}
                    disabled={saving}
                >
                    <option value={Visibility.Private}>Private</option>
                    <option value={Visibility.Public}>Public</option>
                </select>
            </label>
            {visibility === Visibility.Public ? (
                <label className="room-dialog-field">
                    <span>Alias local part</span>
                    <input
                        className="room-dialog-input"
                        type="text"
                        value={aliasLocalPart}
                        onChange={(event) => setAliasLocalPart(event.target.value)}
                        placeholder="my-room"
                        disabled={saving}
                    />
                </label>
            ) : null}
            <label className="room-dialog-field">
                <span>Invite users (optional)</span>
                <textarea
                    className="room-dialog-textarea"
                    value={inviteInput}
                    onChange={(event) => setInviteInput(event.target.value)}
                    placeholder="@alice @bob:example.org"
                    disabled={saving}
                />
            </label>
            <label className="room-dialog-checkbox">
                <input
                    type="checkbox"
                    checked={enableEncryption}
                    onChange={(event) => setEnableEncryption(event.target.checked)}
                    disabled={saving}
                />
                Enable end-to-end encryption
            </label>
            <label className="room-dialog-checkbox">
                <input
                    type="checkbox"
                    checked={voiceChannel}
                    onChange={(event) => setVoiceChannel(event.target.checked)}
                    disabled={saving}
                />
                Voice channel (chat suppressed)
            </label>
            {!canAddToSpace ? (
                <p className="room-dialog-warning">You don't have permission to add channels to this Space.</p>
            ) : null}
            {error ? <p className="room-dialog-error">{error}</p> : null}
        </RoomDialog>
    );
}
