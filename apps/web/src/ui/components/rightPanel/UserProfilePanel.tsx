import React, { useCallback, useEffect, useMemo, useState } from "react";
import { EventType, type MatrixClient, type MatrixEvent, type Room, type RoomMember } from "matrix-js-sdk/src/matrix";

import { createOrReuseDirectChat, getDirectRoomIds } from "../../adapters/dmAdapter";
import { mediaFromMxc, thumbnailFromMxc } from "../../adapters/media";
import { useMatrix } from "../../providers/MatrixProvider";
import { isPresenceEnabledForClient } from "../../presence/presenceConfig";
import { usePresenceVm } from "../../presence/usePresence";
import { memberAvatarSources } from "../../adapters/avatar";
import { isUserOnOwnServer, reportUser, serverNameOf } from "../../../core/moderation/reports";
import { useIgnoredUsers } from "../../moderation/useIgnoredUsers";
import { ReportDialog } from "../moderation/ReportDialog";
import { BadgesDialog } from "../badges/BadgesDialog";
import { useBadgeSettings } from "../../hooks/useUserBadges";
import { RoomDialog } from "../rooms/RoomDialog";
import { ProfileHeader } from "./ProfileHeader";
import { AboutCard } from "./cards/AboutCard";
import { RolesCard } from "./cards/RolesCard";

interface UserProfilePanelProps {
    client: MatrixClient;
    room: Room;
    activeSpaceRoom: Room | null;
    userId: string;
    onBack: () => void;
    onOpenRoom: (roomId: string) => void;
    onToast?: (toast: { type: "success" | "error" | "info"; message: string }) => void;
    onStartCall?: (userId: string) => void;
    onAddToRoom?: (userId: string) => void;
}

interface UserProfileData {
    displayname?: string;
    avatar_url?: string;
    bio?: string;
    about?: string;
}

function getUserPowerLevel(room: Room | null, userId: string): number {
    if (!room) {
        return 0;
    }

    const powerLevelsEvent = room.currentState.getStateEvents(EventType.RoomPowerLevels, "");
    const content = (powerLevelsEvent?.getContent() ?? {}) as {
        users?: Record<string, number>;
        users_default?: number;
    };

    const users = content.users ?? {};
    const directLevel = users[userId];
    if (typeof directLevel === "number" && Number.isFinite(directLevel)) {
        return directLevel;
    }

    return typeof content.users_default === "number" && Number.isFinite(content.users_default) ? content.users_default : 0;
}

function getRoleInfo(powerLevel: number): { label: string; badgeClass: string } {
    if (powerLevel >= 100) {
        return { label: "Admin", badgeClass: "is-admin" };
    }
    if (powerLevel >= 50) {
        return { label: "Mod", badgeClass: "is-mod" };
    }
    return { label: "Member", badgeClass: "is-member" };
}

function getMemberSince(member: RoomMember | null): string | null {
    if (!member) {
        return null;
    }

    const memberEventTs = (member as RoomMember & { events?: { member?: MatrixEvent } }).events?.member?.getTs?.();
    if (!memberEventTs) {
        return null;
    }

    return new Date(memberEventTs).toLocaleDateString();
}

async function copyText(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const node = document.createElement("textarea");
    node.value = value;
    node.setAttribute("readonly", "true");
    node.style.position = "fixed";
    node.style.opacity = "0";
    document.body.appendChild(node);
    node.select();
    document.execCommand("copy");
    document.body.removeChild(node);
}

export function UserProfilePanel({
    client,
    room,
    activeSpaceRoom,
    userId,
    onBack,
    onOpenRoom,
    onToast,
    onStartCall,
    onAddToRoom,
}: UserProfilePanelProps): React.ReactElement {
    const [profile, setProfile] = useState<UserProfileData | null>(null);
    const [loadingProfile, setLoadingProfile] = useState(false);
    const { config } = useMatrix();
    const presenceEnabled = useMemo(() => isPresenceEnabledForClient(config, client), [client, config]);
    const presence = usePresenceVm(client, userId, presenceEnabled);

    const member = room.getMember(userId);
    const ownUserId = client.getUserId() ?? "";
    const powerLevelRoom = activeSpaceRoom ?? room;
    const role = getRoleInfo(getUserPowerLevel(powerLevelRoom, userId));
    const directRoomIds = getDirectRoomIds(client);
    const isCurrentRoomDmWithUser = directRoomIds.has(room.roomId) && Boolean(room.getMember(userId));
    const canMessage = !isCurrentRoomDmWithUser && ownUserId !== userId;
    const ignoredUsers = useIgnoredUsers(client);
    const blocked = ignoredUsers.isIgnored(userId);
    const [confirmBlockOpen, setConfirmBlockOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [badgesOpen, setBadgesOpen] = useState(false);
    const canManageBadges = useBadgeSettings().managers.includes(ownUserId);
    const reportable = isUserOnOwnServer(client, userId);

    useEffect(() => {
        let cancelled = false;
        setLoadingProfile(true);

        client
            .getProfileInfo(userId)
            .then((nextProfile) => {
                if (cancelled) {
                    return;
                }
                setProfile(nextProfile as UserProfileData);
            })
            .catch(() => {
                if (!cancelled) {
                    setProfile(null);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingProfile(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [client, userId]);

    const displayName = profile?.displayname || member?.rawDisplayName || member?.name || userId;
    const profileAvatarMxc = profile?.avatar_url || member?.getMxcAvatarUrl() || null;
    const memberSources = memberAvatarSources(client, member, 176, "crop");
    const avatarSources = useMemo(
        () =>
            Array.from(
                new Set(
                    [
                        ...memberSources,
                        thumbnailFromMxc(client, profileAvatarMxc, 176, 176, "crop"),
                        mediaFromMxc(client, profileAvatarMxc),
                    ].filter((source): source is string => Boolean(source)),
                ),
            ),
        [client, memberSources, profileAvatarMxc],
    );

    const aboutText = useMemo(() => {
        if (typeof profile?.about === "string" && profile.about.trim().length > 0) {
            return profile.about;
        }
        if (typeof profile?.bio === "string" && profile.bio.trim().length > 0) {
            return profile.bio;
        }
        return "";
    }, [profile?.about, profile?.bio]);

    const memberSince = getMemberSince(member);
    const aboutBody = memberSince ? `${aboutText || "No bio set"}\n\nMember since ${memberSince}` : aboutText;

    const mutualRoomsCount = useMemo(
        () =>
            client
                .getRooms()
                .filter((candidate) => !candidate.isSpaceRoom())
                .filter((candidate) => candidate.getMember(userId)?.membership === "join")
                .length,
        [client, userId],
    );

    const openDm = useCallback(async (): Promise<void> => {
        if (!canMessage) {
            return;
        }

        try {
            const result = await createOrReuseDirectChat(client, userId);
            onOpenRoom(result.roomId);
            onToast?.({
                type: "success",
                message: result.created ? "Direct message created." : "Opened direct message.",
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to create direct message.";
            onToast?.({ type: "error", message });
        }
    }, [canMessage, client, onOpenRoom, onToast, userId]);

    return (
        <div className="right-panel-body right-panel-body-user">
            <ProfileHeader
                displayName={displayName}
                userId={userId}
                localDomain={client.getDomain()}
                avatarSources={avatarSources}
                presence={presenceEnabled ? presence : null}
                onBack={onBack}
                onMessage={canMessage ? openDm : undefined}
                onCall={ownUserId !== userId && onStartCall ? () => onStartCall(userId) : undefined}
                onAdd={ownUserId !== userId && onAddToRoom ? () => onAddToRoom(userId) : undefined}
                onEditBadges={canManageBadges ? () => setBadgesOpen(true) : undefined}
                onCopyMxid={async () => {
                    await copyText(userId);
                    onToast?.({ type: "success", message: "MXID copied." });
                }}
                onCopyUserId={async () => {
                    await copyText(userId);
                    onToast?.({ type: "success", message: "User ID copied." });
                }}
            />

            <AboutCard
                title="About me"
                body={aboutBody}
                emptyText={loadingProfile ? "Loading profile..." : "No bio set."}
            />

            <RolesCard roleLabel={role.label} roleBadgeClass={role.badgeClass} mutualRoomsCount={mutualRoomsCount} />

            {ownUserId !== userId ? (
                <section className="rp-card rp-footer-actions">
                    <button
                        type="button"
                        className="rp-row-button"
                        onClick={() => {
                            if (!blocked) {
                                setConfirmBlockOpen(true);
                                return;
                            }
                            void ignoredUsers.setIgnored(userId, false).then(
                                () => onToast?.({ type: "success", message: `Unblocked ${displayName}.` }),
                                () => onToast?.({ type: "error", message: "Could not unblock. Try again." }),
                            );
                        }}
                    >
                        {blocked ? "Unblock" : "Block / Ignore"}
                    </button>
                    <button type="button" className="rp-row-button" onClick={() => setReportOpen(true)}>
                        Report
                    </button>
                </section>
            ) : null}

            <RoomDialog
                open={confirmBlockOpen}
                title={`Block ${displayName}?`}
                onClose={() => setConfirmBlockOpen(false)}
                footer={
                    <>
                        <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={() => setConfirmBlockOpen(false)}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="room-dialog-button room-dialog-button-danger"
                            onClick={() => {
                                setConfirmBlockOpen(false);
                                void ignoredUsers.setIgnored(userId, true).then(
                                    () => onToast?.({ type: "success", message: `Blocked ${displayName}.` }),
                                    () => onToast?.({ type: "error", message: "Could not block. Try again." }),
                                );
                            }}
                        >
                            Block
                        </button>
                    </>
                }
            >
                <p className="room-dialog-muted">
                    You will not see their messages, invites or calls anywhere, and they are not told. You can unblock
                    them from their profile or from Settings, Privacy &amp; Safety.
                </p>
            </RoomDialog>

            <BadgesDialog
                client={client}
                userId={userId}
                displayName={displayName}
                open={badgesOpen}
                onClose={() => setBadgesOpen(false)}
            />

            <ReportDialog
                open={reportOpen}
                title={`Report ${displayName}`}
                canSubmit={reportable}
                note={
                    reportable
                        ? `Your report goes to the admins of ${serverNameOf(userId)}.`
                        : `${displayName} is on ${serverNameOf(userId)}, and your server only keeps reports about its own users. Report one of their messages instead: right-click it and choose Report message.`
                }
                onClose={() => setReportOpen(false)}
                onSubmit={async (reason) => {
                    await reportUser(client, userId, reason);
                    onToast?.({ type: "success", message: `Reported ${displayName}. The admins will review it.` });
                }}
            />
        </div>
    );
}
