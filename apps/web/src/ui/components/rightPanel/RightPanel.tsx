import React from "react";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

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
    directPartnerId: string | null;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    onSelectUser: (userId: string) => void;
    /** Right-click, or a long press on a phone, on a member: their menu. */
    onUserContextMenu?: (userId: string, point: { x: number; y: number }) => void;
    onBackToRoom: () => void;
    onCloseRoomPanel: () => void;
    onOpenRoomSettings: () => void;
    onCopyRoomLink: () => Promise<void>;
    onLeaveRoom: () => Promise<void>;
    onOpenRoom: (roomId: string) => void;
    onToast?: (toast: { type: "success" | "error" | "info"; message: string }) => void;
    onStartCall?: (userId: string) => void;
    onAddToRoom?: (userId: string) => void;
}

export function RightPanel({
    client,
    room,
    activeSpaceRoom,
    mode,
    roomMode,
    directPartnerId,
    searchQuery,
    onSearchQueryChange,
    onSelectUser,
    onUserContextMenu,
    onBackToRoom,
    onCloseRoomPanel,
    onOpenRoomSettings,
    onCopyRoomLink,
    onLeaveRoom,
    onOpenRoom,
    onToast,
    onStartCall,
    onAddToRoom,
}: RightPanelProps): React.ReactElement {
    if (!room) {
        return (
            <aside className="right-panel">
                <div className="right-panel-empty">Select a room to view room info.</div>
                <div className="right-panel-drag-strip" aria-hidden="true" />
            </aside>
        );
    }

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
                    onStartCall={onStartCall}
                    onAddToRoom={onAddToRoom}
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
                            onStartCall={onStartCall}
                            onAddToRoom={onAddToRoom}
                        />
                    ) : null}
                    {roomMode === "members" && !directPartnerId ? (
                        <MembersPanel
                            client={client}
                            room={room}
                            activeSpaceRoom={activeSpaceRoom}
                            onSelectUser={onSelectUser}
                            onUserContextMenu={onUserContextMenu}
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
                            onClose={onCloseRoomPanel}
                        />
                    ) : null}
                </>
            )}
            <div className="right-panel-drag-strip" aria-hidden="true" />
        </aside>
    );
}
