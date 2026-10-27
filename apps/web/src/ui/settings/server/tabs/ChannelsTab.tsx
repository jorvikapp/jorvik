import React, { useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import { RoomList } from "../../../components/RoomList";
import { CreateRoomDialog } from "../../../components/rooms/CreateRoomDialog";

interface ChannelsTabProps {
    client: MatrixClient;
    spaceId: string;
    rooms: Room[];
    activeRoomId: string | null;
    onSelectRoom: (roomId: string) => void;
    onRefreshChannels: () => Promise<void>;
}

export function ChannelsTab({
    client,
    spaceId,
    rooms,
    activeRoomId,
    onSelectRoom,
    onRefreshChannels,
}: ChannelsTabProps): React.ReactElement {
    const [refreshing, setRefreshing] = useState(false);
    // The dialog opens over settings rather than closing them: the new channel then
    // turns up in this list, picked, ready to be moved where it belongs.
    const [createOpen, setCreateOpen] = useState(false);

    const handleRefresh = async (): Promise<void> => {
        if (refreshing) {
            return;
        }

        setRefreshing(true);
        try {
            await onRefreshChannels();
        } finally {
            setRefreshing(false);
        }
    };

    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Channels</h2>
            <p className="settings-tab-description">
                Arrange this Space's channels. Everyone sees them in the order you set here.
            </p>

            <div className="settings-actions-row">
                <button
                    type="button"
                    className="settings-button settings-button-secondary"
                    onClick={() => void handleRefresh()}
                    disabled={refreshing}
                >
                    {refreshing ? "Reloading..." : "Reload channels"}
                </button>
                <button type="button" className="settings-button settings-button-secondary" onClick={() => setCreateOpen(true)}>
                    Create channel
                </button>
            </div>

            <div className="settings-channels-panel">
                <RoomList
                    client={client}
                    spaceId={spaceId}
                    rooms={rooms}
                    activeRoomId={activeRoomId}
                    orderingMode="manual"
                    showOrderingControls
                    showHashPrefix
                    onSelectRoom={onSelectRoom}
                />
            </div>

            <CreateRoomDialog
                client={client}
                open={createOpen}
                spaceParentId={spaceId}
                onClose={() => setCreateOpen(false)}
                onCreated={onSelectRoom}
            />
        </div>
    );
}
