import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { logger } from "matrix-js-sdk/src/logger";
import {
    ClientEvent,
    EventType,
    KnownMembership,
    RoomEvent,
    RoomStateEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";

import {
    clearGameIconUrls,
    loadGameIconUrl,
    peekGameIconUrl,
    rememberedGameIcon,
    uploadGameIcon,
} from "../../core/activity/activityIcons";
import {
    MAX_ACTIVITY_RECIPIENTS,
    computeActivityRecipients,
    isSpaceIncluded,
    sharesGames,
    sharesMusic,
    type ActivityPrivacySettings,
    type ActivityRecipients,
    type ActivitySpace,
} from "../../core/activity/activityPrivacy";
import { ActivitySender, matrixActivityTransport, type SharedNow } from "../../core/activity/activitySender";
import {
    getUserActivity,
    setOwnActivity,
    startActivityReceiver,
    subscribeActivity,
    type UserActivity,
} from "../../core/activity/activityStore";
import type { ActivityGame, ActivityIconFile, ActivityMusic } from "../../core/activity/activityWire";
import { getDirectRoomIds } from "../../core/dm/directChats";
import type { DetectedMusic } from "./useMusicDetection";

/** Membership changes come in bursts (and loading members fires them too), so recipients are worked out again after a pause. */
const RECIPIENTS_SETTLE_MS = 5_000;

/** Listens for other people's activity while signed in. */
export function useActivityReceiver(client: MatrixClient | null): void {
    useEffect(() => {
        if (!client) {
            return;
        }
        const stop = startActivityReceiver(client);
        return () => {
            stop();
            clearGameIconUrls();
        };
    }, [client]);
}

/** A game's icon ready to show; null while it loads, when it can't, or when the game has none. */
export function useGameIconUrl(client: MatrixClient | null | undefined, icon: ActivityIconFile | undefined): string | null {
    const ready = icon ? peekGameIconUrl(icon) : null;
    const [loaded, setLoaded] = useState<{ icon: ActivityIconFile; url: string | null } | null>(null);
    useEffect(() => {
        if (!client || !icon || ready !== undefined) {
            return;
        }
        let active = true;
        void loadGameIconUrl(client, icon).then((url) => {
            if (active) {
                setLoaded({ icon, url });
            }
        });
        return () => {
            active = false;
        };
    }, [client, icon, ready]);
    return ready ?? (loaded && loaded.icon === icon ? loaded.url : null);
}

/**
 * The icon to send with the game the user shares: the one uploaded for it before, or the icon Steam
 * keeps of it, encrypted and uploaded now. Null meanwhile, in a browser, and for other games.
 */
function useSharedGameIcon(client: MatrixClient | null, gameId: string | null): ActivityIconFile | null {
    const userId = client?.getUserId() ?? null;
    const remembered = useMemo(() => (userId && gameId ? rememberedGameIcon(userId, gameId) : null), [gameId, userId]);
    const [uploaded, setUploaded] = useState<{ gameId: string; icon: ActivityIconFile } | null>(null);
    const known = remembered ?? (uploaded?.gameId === gameId ? uploaded.icon : null);
    useEffect(() => {
        const getGameIcon = typeof window === "undefined" ? undefined : window.heorotDesktop?.getGameIcon;
        if (!client || !userId || !gameId || known || !getGameIcon) {
            return;
        }
        let active = true;
        void getGameIcon(gameId)
            .then((png) => (png ? uploadGameIcon(client, userId, gameId, png) : null))
            .then(
                (icon) => {
                    if (active && icon) {
                        setUploaded({ gameId, icon });
                    }
                },
                (error: unknown) => logger.warn("[Jorvik activity] could not upload the game's icon", error),
            );
        return () => {
            active = false;
        };
    }, [client, gameId, known, userId]);
    return known;
}

/** Covers are remembered by album (or by track, without one), so a whole album uploads one cover. */
function coverId(music: ActivityMusic): string {
    return `music:${[music.player.id, music.artist ?? "", music.album ?? music.title].join("\u0000")}`;
}

/**
 * The cover to send with the track the user shares: the one uploaded for its album before, or the
 * cover the desktop app reads from the player, encrypted and uploaded now. Null meanwhile and when
 * there's none.
 */
function useSharedMusicCover(client: MatrixClient | null, detected: DetectedMusic | null): ActivityIconFile | null {
    const userId = client?.getUserId() ?? null;
    const id = detected ? coverId(detected.music) : null;
    const key = detected?.key ?? null;
    const remembered = useMemo(() => (userId && id ? rememberedGameIcon(userId, id) : null), [id, userId]);
    const [uploaded, setUploaded] = useState<{ id: string; icon: ActivityIconFile } | null>(null);
    const known = remembered ?? (uploaded?.id === id ? uploaded.icon : null);
    useEffect(() => {
        const getMusicCover = typeof window === "undefined" ? undefined : window.heorotDesktop?.getMusicCover;
        if (!client || !userId || !id || !key || known || !getMusicCover) {
            return;
        }
        let active = true;
        void getMusicCover(key)
            .then((png) => (png ? uploadGameIcon(client, userId, id, png) : null))
            .then(
                (icon) => {
                    if (active && icon) {
                        setUploaded({ id, icon });
                    }
                },
                (error: unknown) => logger.warn("[Jorvik activity] could not upload the cover", error),
            );
        return () => {
            active = false;
        };
    }, [client, id, key, known, userId]);
    return known;
}

/** What someone is playing, as far as they share it with us; for the user themselves, what they share. */
export function useUserActivity(userId: string | null | undefined): UserActivity | null {
    return useSyncExternalStore(subscribeActivity, () => getUserActivity(userId));
}

/** The time, updated every minute while `active`, for "playing for 1h 23m". */
export function useMinuteClock(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, [active]);
    return now;
}

/** Everyone the settings pick: the user's DM partners and the members of the spaces they share with. */
export async function gatherActivityRecipients(
    client: MatrixClient,
    settings: ActivityPrivacySettings,
): Promise<ActivityRecipients> {
    const joined = client.getRooms().filter((room) => room.getMyMembership() === KnownMembership.Join);
    const base = {
        ownUserId: client.getSafeUserId(),
        settings,
        ignoredUserIds: client.getIgnoredUsers(),
    };

    const friendIds: string[] = [];
    if (settings.share_with_friends) {
        const directRoomIds = getDirectRoomIds(client);
        for (const room of joined) {
            if (directRoomIds.has(room.roomId)) {
                await room.loadMembersIfNeeded();
                friendIds.push(...room.getJoinedMembers().map((member) => member.userId));
            }
        }
    }

    const included = joined.filter(
        (room) => room.isSpaceRoom() && isSpaceIncluded(settings, room.roomId, room.getJoinedMemberCount()),
    );
    // A space bigger than the limit would be cut down to friends anyway; don't load all of its members.
    if (included.some((room) => room.getJoinedMemberCount() - 1 > MAX_ACTIVITY_RECIPIENTS)) {
        return { ...computeActivityRecipients({ ...base, friendIds, spaces: [] }), capped: true };
    }
    const spaces: ActivitySpace[] = [];
    for (const room of included) {
        await room.loadMembersIfNeeded();
        spaces.push({
            roomId: room.roomId,
            joinedCount: room.getJoinedMemberCount(),
            joinedMemberIds: room.getJoinedMembers().map((member) => member.userId),
        });
    }
    return computeActivityRecipients({ ...base, friendIds, spaces });
}

/**
 * Shares the running game and the music playing with the people the settings pick, while sharing each
 * is on, the game isn't hidden and the user isn't invisible (sharing would give away that they're
 * online). Recipients are worked out again when settings or memberships change; anyone who drops out
 * is told it stopped.
 */
export function useActivitySharing(
    client: MatrixClient | null,
    settings: ActivityPrivacySettings,
    detected: ActivityGame | null,
    detectedMusic: DetectedMusic | null,
    invisible: boolean,
): void {
    // When the running game started: kept while the same game runs.
    const [start, setStart] = useState<{ id: string; at: number } | null>(null);
    if ((detected?.id ?? null) !== (start?.id ?? null)) {
        setStart(detected ? { id: detected.id, at: Date.now() } : null);
    }
    const startedAt = start?.at ?? 0;
    const shareable =
        sharesGames(settings) && !invisible && detected && !settings.hidden_games.includes(detected.id) ? detected : null;
    const shareableMusic = sharesMusic(settings) && !invisible ? detectedMusic : null;
    // Looked for, and uploaded, only for what's shared.
    const icon = useSharedGameIcon(client, shareable?.id ?? null);
    const cover = useSharedMusicCover(client, shareableMusic);
    const shared = useMemo<SharedNow | null>(() => {
        const game = shareable ? { ...shareable, ...(icon ? { icon } : {}), startedAt } : null;
        const music = shareableMusic ? { ...shareableMusic.music, ...(cover ? { cover } : {}) } : null;
        return game || music ? { game, music } : null;
    }, [cover, icon, shareable, shareableMusic, startedAt]);
    const senderRef = useRef<ActivitySender | null>(null);
    const [membershipTick, setMembershipTick] = useState(0);

    useEffect(() => {
        if (!client) {
            return;
        }
        const sender = new ActivitySender(matrixActivityTransport(client), client.getDeviceId() ?? "");
        senderRef.current = sender;
        // Best effort when the app closes; otherwise the message runs out on its own within minutes.
        const onPageHide = (): void => sender.stop();
        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
            sender.stop();
            senderRef.current = null;
        };
    }, [client]);

    useEffect(() => {
        const userId = client?.getUserId();
        if (!userId) {
            return;
        }
        const game = shared?.game;
        setOwnActivity(
            userId,
            shared
                ? {
                      game: game ? { id: game.id, name: game.name, ...(game.icon ? { icon: game.icon } : {}) } : null,
                      music: shared.music,
                      startedAt: game?.startedAt ?? 0,
                  }
                : null,
        );
        return () => setOwnActivity(userId, null);
    }, [client, shared]);

    const sharing = shared !== null;
    useEffect(() => {
        if (!client || !sharing) {
            return;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const later = (): void => {
            timer ??= setTimeout(() => {
                timer = null;
                setMembershipTick((tick) => tick + 1);
            }, RECIPIENTS_SETTLE_MS);
        };
        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === EventType.Direct || event.getType() === "m.ignored_user_list") {
                later();
            }
        };
        client.on(RoomStateEvent.Members, later);
        client.on(RoomEvent.MyMembership, later);
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            if (timer) {
                clearTimeout(timer);
            }
            client.removeListener(RoomStateEvent.Members, later);
            client.removeListener(RoomEvent.MyMembership, later);
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client, sharing]);

    useEffect(() => {
        const sender = senderRef.current;
        if (!client || !sender) {
            return;
        }
        if (!shared) {
            sender.update(null, []);
            return;
        }
        let cancelled = false;
        void gatherActivityRecipients(client, settings).then(
            (recipients) => {
                if (cancelled) {
                    return;
                }
                if (recipients.capped) {
                    logger.warn(
                        `[Jorvik activity] the picked spaces add up to more than ${MAX_ACTIVITY_RECIPIENTS} people; only friends are told`,
                    );
                }
                sender.update(shared, recipients.userIds);
            },
            (error: unknown) => logger.warn("[Jorvik activity] could not work out who to tell", error),
        );
        return () => {
            cancelled = true;
        };
    }, [client, membershipTick, settings, shared]);
}

export interface JoinedSpace {
    room: Room;
    roomId: string;
    name: string;
    joinedCount: number;
}

function joinedSpaces(client: MatrixClient | null): JoinedSpace[] {
    if (!client) {
        return [];
    }
    return client
        .getRooms()
        .filter((room) => room.isSpaceRoom() && room.getMyMembership() === KnownMembership.Join)
        .map((room) => ({ room, roomId: room.roomId, name: room.name || room.roomId, joinedCount: room.getJoinedMemberCount() }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

/** The spaces the user is in, by name, kept current as they join, leave or rename them. */
export function useJoinedSpaces(client: MatrixClient | null): JoinedSpace[] {
    const [spaces, setSpaces] = useState(() => joinedSpaces(client));
    useEffect(() => {
        const refresh = (): void => setSpaces(joinedSpaces(client));
        refresh();
        if (!client) {
            return;
        }
        client.on(ClientEvent.Room, refresh);
        client.on(RoomEvent.MyMembership, refresh);
        client.on(RoomEvent.Name, refresh);
        return () => {
            client.removeListener(ClientEvent.Room, refresh);
            client.removeListener(RoomEvent.MyMembership, refresh);
            client.removeListener(RoomEvent.Name, refresh);
        };
    }, [client]);
    return spaces;
}
