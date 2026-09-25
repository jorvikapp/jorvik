import React from "react";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import { getDirectRoomIds } from "../../adapters/dmAdapter";
import type { RightPanelMode } from "../../hooks/useSelectedUser";
import { MembersPanel } from "../rightSidebar/panels/MembersPanel";
import { SearchPanel } from "../rightSidebar/panels/SearchPanel";
import { PinsPanel } from "../rightSidebar/panels/PinsPanel";
import { InfoPanel } from "../rightSidebar/panels/InfoPanel";
import type { RightSidebarMode } from "./types";
import { UserProfilePanel } from "./UserProfilePanel";

interface RightPanelProps {
    client: MatrixClient;
    room: Room | null;
    activeSpaceRoom: Room | null;
    mode: RightPanelMode;
    roomMode: RightSidebarMode;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    onSelectUser: (userId: string) => void;
    onBackToRoom: () => void;
    onCloseRoomPanel: () => void;
    onOpenRoomSettings: () => void;
    onCopyRoomLink: () => Promise<void>;
    onLeaveRoom: () => Promise<void>;
    onOpenRoom: (roomId: string) => void;
    onToast?: (toast: { type: "success" | "error" | "info"; message: string }) => void;
}

// In a two-person DM the member list would only show the two of you, so the
// other person's profile is shown instead. Group DMs keep the list. The count
// comes from the room summary, which stays accurate with lazy-loaded members.
function getDirectPartnerId(client: MatrixClient, room: Room): string | null {
    if (!getDirectRoomIds(client).has(room.roomId) || room.getInvitedAndJoinedMemberCount() !== 2) {
        return null;
    }

    const partnerId = room.guessDMUserId();
    return partnerId && partnerId !== client.getUserId() ? partnerId : null;
}

export function RightPanel({
    client,
    room,
    activeSpaceRoom,
    mode,
    roomMode,
    searchQuery,
    onSearchQueryChange,
    onSelectUser,
    onBackToRoom,
    onCloseRoomPanel,
    onOpenRoomSettings,
    onCopyRoomLink,
    onLeaveRoom,
    onOpenRoom,
    onToast,
}: RightPanelProps): React.ReactElement {
    if (!room) {
        return (
            <aside className="right-panel">
                <div className="right-panel-empty">Select a room to view room info.</div>
            </aside>
        );
    }

    const directPartnerId = roomMode === "members" ? getDirectPartnerId(client, room) : null;

    return (
        <aside className="right-panel">
            {mode.mode === "user" ? (
                <UserProfilePanel
                    client={client}
                    room={room}
                    activeSpaceRoom={activeSpaceRoom}
                    userId={mode.userId}
                    onBack={onBackToRoom}
                    onOpenRoom={onOpenRoom}
                    onToast={onToast}
                />
            ) : (
                <>
                    {roomMode === "members" && directPartnerId ? (
                        <UserProfilePanel
                            client={client}
                            room={room}
                            activeSpaceRoom={activeSpaceRoom}
                            userId={directPartnerId}
                            onBack={onCloseRoomPanel}
                            onOpenRoom={onOpenRoom}
                            onToast={onToast}
                        />
                    ) : null}
                    {roomMode === "members" && !directPartnerId ? (
                        <MembersPanel
                            client={client}
                            room={room}
                            activeSpaceRoom={activeSpaceRoom}
                            onSelectUser={onSelectUser}
                        />
                    ) : null}
                    {roomMode === "search" ? (
                        <SearchPanel
                            room={room}
                            query={searchQuery}
                            onQueryChange={onSearchQueryChange}
                        />
                    ) : null}
                    {roomMode === "pins" ? <PinsPanel room={room} /> : null}
                    {roomMode === "info" ? (
                        <InfoPanel
                            client={client}
                            room={room}
                            onOpenRoomSettings={onOpenRoomSettings}
                            onCopyRoomLink={onCopyRoomLink}
                            onLeaveRoom={onLeaveRoom}
                        />
                    ) : null}
                </>
            )}
        </aside>
    );
}
