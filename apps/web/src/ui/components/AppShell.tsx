import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mxidLocalpart } from "../mentions/mentionTokens";
import {
    ClientEvent,
    ClientPrefix,
    EventType,
    MatrixError,
    MatrixEventEvent,
    Method,
    RoomEvent,
    RoomStateEvent,
    UserEvent,
    type HierarchyRoom,
    type MatrixClient,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";

import { useMatrix } from "../providers/MatrixProvider";
import { formatUserIdForDisplay } from "../../core/users/formatUserId";
import { isPresenceEnabledForClient } from "../presence/presenceConfig";
import { usePresenceSelection } from "../presence/usePresenceSelection";
import { StatusMenu } from "./presence/StatusMenu";
import { ensureDirectRoomMapping, getDirectRoomIds } from "../adapters/dmAdapter";
import { describeJoinError, joinRoomWithRetry } from "../adapters/joinAdapter";
import { mediaFromMxc, thumbnailFromMxc } from "../adapters/media";
import { Composer } from "./Composer";
import { EmojiUploadDialog } from "./EmojiUploadDialog";
import { ChannelHeader } from "./header/ChannelHeader";
import { RightPanel } from "./rightPanel/RightPanel";
import { getOneToOnePartnerId } from "./rightPanel/directPartner";
import { sharedStateEventDeduperFor } from "../../core/net/stateEventDeduper";
import { rootChildrenState, selectVoiceHintCandidates } from "../../core/spaces/voiceHints";
import {
    accountCacheKey,
    SpaceHierarchyCache,
} from "../../core/spaces/spaceHierarchyCache";
import {
    fetchSpaceHierarchy,
    SpaceHierarchyAbortedError,
    SpaceHierarchyPageTimeoutError,
    type SpaceHierarchyPage,
    type SpaceHierarchyResult,
} from "../../core/spaces/fetchSpaceHierarchy";
import {
    affordanceForJoinRule,
    normaliseJoinRule,
    partitionSpaceChildren,
    readViaServers,
    type SpaceChildren,
    type SpaceChildRoom,
    type SpaceChildSpace,
} from "../adapters/spaceHierarchyAdapter";
import { RoomList, type DiscoverableSpaceChannel, type SubspaceGroupView } from "./RoomList";
import { Timeline } from "./Timeline";
import { Toast, type ToastState } from "./Toast";
import { Avatar } from "./Avatar";
import { CreateRoomDialog } from "./rooms/CreateRoomDialog";
import { CreateSpaceDialog } from "./rooms/CreateSpaceDialog";
import { ImportJsonWizard } from "./rooms/ImportJsonWizard";
import { CreateDirectChatDialog } from "./rooms/CreateDirectChatDialog";
import { InviteDialog } from "./rooms/InviteDialog";
import { JoinRoomDialog } from "./rooms/JoinRoomDialog";
import { RoomModerationDialog } from "./rooms/RoomModerationDialog";
import { RoomSettingsDialog } from "./rooms/RoomSettingsDialog";
import { SettingsOverlay, type SettingsMode } from "../settings/SettingsOverlay";
import {
    applyAppearanceTheme,
    loadUserLocalSettings,
    saveUserLocalSettings,
    type UserLocalSettings,
} from "../settings/user/settingsStore";
import {
    getFeatureRenderReactionImages,
    setFeatureRenderReactionImages,
} from "../emoji/EmojiPackStore";
import type { EmojiPackTarget } from "../emoji/EmojiPackTypes";
import { useSelectedUser } from "../hooks/useSelectedUser";
import { useElementLikeNotifications } from "../notifications/useElementLikeNotifications";
import { buildMatrixToRoomPermalink } from "../utils/permalink";
import type { RightSidebarMode } from "./rightPanel/types";
import { VoiceRoom, type VoiceControlState, type VoiceRoomHandle, type VoiceSessionStatus } from "./voice/VoiceRoom";
import {
    MATRIX_CALL_COMPAT_EVENT,
    HEOROT_VOICE_CHANNEL_EVENT,
    isVoiceChannelHintContent,
    isVoiceChannelRoom,
} from "../voice/voiceChannel";
import { clearVoiceDiscovery, initVoiceDiscovery } from "../voice/voiceDiscovery";
import { CHANNEL_ORDER_STATE_EVENT, readChannelOrder, writeChannelOrder } from "../stores/CategoryStore";

interface AppShellProps {
    client: MatrixClient;
    onLogout: () => Promise<void>;
}

interface SpaceChildOrder {
    index: number;
    order?: string;
    viaServers: string[];
    isVoiceChannel: boolean;
}

interface SpaceChildStateSnapshotEvent {
    type?: unknown;
    state_key?: unknown;
    content?: unknown;
}

interface SettingsState {
    mode: SettingsMode;
    tab: string;
}

const PEOPLE_SPACE_ID = "people-space";
const RIGHT_SIDEBAR_MODE_STORAGE_KEY = "heorot.ui.rightSidebarMode";
const CHANNELS_PANE_WIDTH_KEY = "heorot.ui.channelsPaneWidth";
const CHANNELS_PANE_MIN = 180;
const CHANNELS_PANE_MAX = 480;
const CHANNELS_PANE_DEFAULT = 280;
const DEFAULT_VOICE_CONTROL_STATE: VoiceControlState = {
    joining: false,
    connected: false,
    micMuted: true,
    audioMuted: false,
};

function readChannelsPaneWidth(): number {
    try {
        const raw = window.localStorage.getItem(CHANNELS_PANE_WIDTH_KEY);
        if (raw) {
            const n = Number(raw);
            if (Number.isFinite(n)) return Math.min(CHANNELS_PANE_MAX, Math.max(CHANNELS_PANE_MIN, n));
        }
    } catch { /* ignore */ }
    return CHANNELS_PANE_DEFAULT;
}

function readStoredRightSidebarMode(): RightSidebarMode {
    if (typeof window === "undefined") {
        return "members";
    }

    const raw = window.localStorage.getItem(RIGHT_SIDEBAR_MODE_STORAGE_KEY);
    if (raw === "members" || raw === "search" || raw === "pins" || raw === "info" || raw === "closed") {
        return raw;
    }

    return "members";
}

function getRoomName(room: Room): string {
    return room.name || room.getCanonicalAlias() || room.roomId;
}

function isVisibleMembership(room: Room): boolean {
    const membership = room.getMyMembership();
    return membership === "join" || membership === "invite" || membership === "knock";
}

function compareRoomsByName(left: Room, right: Room): number {
    const nameComparison = getRoomName(left).localeCompare(getRoomName(right), undefined, {
        sensitivity: "base",
    });
    if (nameComparison !== 0) {
        return nameComparison;
    }

    return left.roomId.localeCompare(right.roomId);
}

function sortRoomsByName(rooms: Room[]): Room[] {
    return [...rooms].sort(compareRoomsByName);
}

function getRoomLastTimestamp(room: Room): number {
    const liveEvents = room.getLiveTimeline()?.getEvents() ?? room.timeline;
    const lastEvent = liveEvents[liveEvents.length - 1];
    if (lastEvent) {
        return lastEvent.getTs();
    }

    const roomAsExtended = room as Room & {
        getLastActiveTimestamp?: () => number;
    };
    return roomAsExtended.getLastActiveTimestamp?.() ?? 0;
}

function sortRoomsByActivity(rooms: Room[]): Room[] {
    return [...rooms].sort((left, right) => {
        const delta = getRoomLastTimestamp(right) - getRoomLastTimestamp(left);
        if (delta !== 0) {
            return delta;
        }

        return compareRoomsByName(left, right);
    });
}

function areStringSetsEqual(left: Set<string> | undefined, right: Set<string>): boolean {
    if (!left) {
        return right.size === 0;
    }
    if (left.size !== right.size) {
        return false;
    }
    for (const value of left) {
        if (!right.has(value)) {
            return false;
        }
    }
    return true;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}

interface SpaceParentCandidate {
    spaceId: string;
    viaServers: string[];
    canonical: boolean;
}

function toStateEventsArray(
    rawEvents: unknown,
): Array<{ getStateKey: () => string | undefined | null; getContent: () => Record<string, unknown> }> {
    if (Array.isArray(rawEvents)) {
        return rawEvents as Array<{ getStateKey: () => string | undefined | null; getContent: () => Record<string, unknown> }>;
    }
    if (rawEvents) {
        return [rawEvents as { getStateKey: () => string | undefined | null; getContent: () => Record<string, unknown> }];
    }
    return [];
}

function normalizeViaServers(rawVia: unknown): string[] {
    if (!Array.isArray(rawVia)) {
        return [];
    }

    return [
        ...new Set(
            rawVia
                .filter((value): value is string => typeof value === "string")
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
        ),
    ];
}

function readSpaceParentCandidates(room: Room): SpaceParentCandidate[] {
    const parentEvents = toStateEventsArray(room.currentState.getStateEvents(EventType.SpaceParent));
    const bySpaceId = new Map<string, SpaceParentCandidate>();

    for (const parentEvent of parentEvents) {
        const parentSpaceId = parentEvent.getStateKey();
        if (typeof parentSpaceId !== "string" || parentSpaceId.length === 0) {
            continue;
        }

        const content = (parentEvent.getContent() ?? {}) as { via?: unknown; canonical?: unknown };
        const nextViaServers = normalizeViaServers(content.via);
        const existing = bySpaceId.get(parentSpaceId);

        if (!existing) {
            bySpaceId.set(parentSpaceId, {
                spaceId: parentSpaceId,
                viaServers: nextViaServers,
                canonical: content.canonical === true,
            });
            continue;
        }

        const mergedViaServers = new Set([...existing.viaServers, ...nextViaServers]);
        bySpaceId.set(parentSpaceId, {
            spaceId: parentSpaceId,
            viaServers: Array.from(mergedViaServers),
            canonical: existing.canonical || content.canonical === true,
        });
    }

    return Array.from(bySpaceId.values()).sort((left, right) => {
        if (left.canonical !== right.canonical) {
            return left.canonical ? -1 : 1;
        }
        return left.spaceId.localeCompare(right.spaceId);
    });
}

function getViaServersForParentSpace(client: MatrixClient, parentSpaceId: string): string[] {
    const viaServers = new Set<string>();
    const visibleRooms = client.getRooms().filter((room) => !room.isSpaceRoom() && isVisibleMembership(room));

    for (const room of visibleRooms) {
        const candidates = readSpaceParentCandidates(room);
        for (const candidate of candidates) {
            if (candidate.spaceId !== parentSpaceId) {
                continue;
            }
            for (const viaServer of candidate.viaServers) {
                viaServers.add(viaServer);
            }
        }
    }

    return Array.from(viaServers);
}

async function ensureRoomParentSpacesJoined(
    client: MatrixClient,
    room: Room,
    preferredSpaceId: string | null | undefined,
): Promise<string | null> {
    const candidates = readSpaceParentCandidates(room);
    if (candidates.length === 0 && !preferredSpaceId) {
        return null;
    }

    const bySpaceId = new Map(candidates.map((candidate) => [candidate.spaceId, candidate] as const));
    if (preferredSpaceId && !bySpaceId.has(preferredSpaceId)) {
        bySpaceId.set(preferredSpaceId, {
            spaceId: preferredSpaceId,
            viaServers: getViaServersForParentSpace(client, preferredSpaceId),
            canonical: true,
        });
    }

    const orderedCandidates = [
        ...(preferredSpaceId ? [bySpaceId.get(preferredSpaceId)].filter((value): value is SpaceParentCandidate => Boolean(value)) : []),
        ...Array.from(bySpaceId.values()).filter((candidate) => candidate.spaceId !== preferredSpaceId),
    ];

    for (const candidate of orderedCandidates) {
        const existingParent = client.getRoom(candidate.spaceId);
        if (existingParent?.isSpaceRoom() && existingParent.getMyMembership() === "join") {
            return candidate.spaceId;
        }

        try {
            const joinedParent = await joinRoomWithRetry(client, candidate.spaceId, {
                viaServers: candidate.viaServers,
                maxAttempts: 1,
            });
            if (joinedParent.isSpaceRoom() && joinedParent.getMyMembership() === "join") {
                return joinedParent.roomId;
            }
        } catch {
            // Best-effort: some users can join channel without permission to join parent space.
        }
    }

    return null;
}
function updateRoomIdentitySetMap(
    current: Map<string, Set<string>>,
    roomId: string,
    nextValues: Set<string>,
): Map<string, Set<string>> {
    const currentValues = current.get(roomId);
    if (nextValues.size === 0) {
        if (!currentValues) {
            return current;
        }
        const next = new Map(current);
        next.delete(roomId);
        return next;
    }
    if (areStringSetsEqual(currentValues, nextValues)) {
        return current;
    }
    const next = new Map(current);
    next.set(roomId, nextValues);
    return next;
}

function readSpaceChildOrderFromStateSnapshot(stateEvents: SpaceChildStateSnapshotEvent[]): Map<string, SpaceChildOrder> {
    const orderByRoomId = new Map<string, SpaceChildOrder>();
    let childIndex = 0;

    stateEvents.forEach((event) => {
        if (event.type !== EventType.SpaceChild) {
            return;
        }

        const childRoomId = typeof event.state_key === "string" ? event.state_key : "";
        if (!childRoomId || orderByRoomId.has(childRoomId)) {
            return;
        }

        const content = (event.content ?? {}) as { order?: unknown; via?: unknown; [key: string]: unknown };
        const order =
            typeof content.order === "string" && content.order.length > 0 && content.order.length <= 50
                ? content.order
                : undefined;
        const viaServers = Array.isArray(content.via)
            ? content.via
                  .filter((value): value is string => typeof value === "string")
                  .map((value) => value.trim())
                  .filter((value) => value.length > 0)
            : [];
        const isVoiceChannel = isVoiceChannelHintContent(content);

        orderByRoomId.set(childRoomId, { index: childIndex, order, viaServers, isVoiceChannel });
        childIndex += 1;
    });

    return orderByRoomId;
}
function readChannelOrderFromStateSnapshot(stateEvents: SpaceChildStateSnapshotEvent[]): string[] {
    for (const event of stateEvents) {
        if (event.type !== CHANNEL_ORDER_STATE_EVENT) {
            continue;
        }

        const stateKey = typeof event.state_key === "string" ? event.state_key : "";
        if (stateKey !== "") {
            continue;
        }

        if (!event.content || typeof event.content !== "object" || Array.isArray(event.content)) {
            return [];
        }

        const content = event.content as { order?: unknown };
        if (!Array.isArray(content.order)) {
            return [];
        }

        return content.order.filter((value): value is string => typeof value === "string" && value.length > 0);
    }

    return [];
}
function isVoiceChannelFromStateSnapshot(stateEvents: SpaceChildStateSnapshotEvent[]): boolean {
    for (const event of stateEvents) {
        const eventType = typeof event.type === "string" ? event.type : "";
        const content = event.content;

        if (eventType === HEOROT_VOICE_CHANNEL_EVENT) {
            if (
                content &&
                typeof content === "object" &&
                !Array.isArray(content) &&
                (content as { enabled?: unknown }).enabled === true
            ) {
                return true;
            }
            continue;
        }

        if (eventType !== MATRIX_CALL_COMPAT_EVENT || !content || typeof content !== "object" || Array.isArray(content)) {
            continue;
        }

        const callContent = content as { intent?: unknown; type?: unknown };
        const intent = typeof callContent.intent === "string" ? callContent.intent.trim().toLowerCase() : "";
        const callType = typeof callContent.type === "string" ? callContent.type.trim().toLowerCase() : "";
        if (intent === "voice" || callType === "voice") {
            return true;
        }
    }

    return false;
}

function readSpaceChildOrder(spaceRoom: Room): Map<string, SpaceChildOrder> {
    const rawEvents = spaceRoom.currentState.getStateEvents(EventType.SpaceChild);
    const events = Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [];
    const snapshotEvents = events.map((event) => ({
        type: EventType.SpaceChild,
        state_key: event.getStateKey(),
        content: event.getContent(),
    }));

    return readSpaceChildOrderFromStateSnapshot(snapshotEvents);
}

function buildCustomChannelOrderIndex(spaceRoom: Room, orderOverride?: string[]): Map<string, number> {
    const byRoomId = new Map<string, number>();
    const order = Array.isArray(orderOverride) ? orderOverride : readChannelOrder(spaceRoom);

    order.forEach((roomId, index) => {
        if (!byRoomId.has(roomId)) {
            byRoomId.set(roomId, index);
        }
    });

    return byRoomId;
}

function getSpaceChannels(spaceRoom: Room, roomById: Map<string, Room>): Room[] {
    const childOrder = readSpaceChildOrder(spaceRoom);
    const customOrderByRoomId = buildCustomChannelOrderIndex(spaceRoom);
    const channels: Array<{ room: Room; index: number; order?: string; customOrderIndex?: number }> = [];

    for (const [roomId, metadata] of childOrder.entries()) {
        const room = roomById.get(roomId);
        if (!room || room.isSpaceRoom() || !isVisibleMembership(room)) {
            continue;
        }

        channels.push({
            room,
            index: metadata.index,
            order: metadata.order,
            customOrderIndex: customOrderByRoomId.get(roomId),
        });
    }

    channels.sort((left, right) => {
        const leftCustom = left.customOrderIndex;
        const rightCustom = right.customOrderIndex;
        if (leftCustom !== undefined && rightCustom !== undefined && leftCustom !== rightCustom) {
            return leftCustom - rightCustom;
        }
        if (leftCustom !== undefined) {
            return -1;
        }
        if (rightCustom !== undefined) {
            return 1;
        }

        if (left.order && right.order) {
            const byOrder = left.order.localeCompare(right.order);
            if (byOrder !== 0) {
                return byOrder;
            }
        } else if (left.order) {
            return -1;
        } else if (right.order) {
            return 1;
        }

        if (left.index !== right.index) {
            return left.index - right.index;
        }

        const byName = compareRoomsByName(left.room, right.room);
        if (byName !== 0) {
            return byName;
        }

        return left.room.roomId.localeCompare(right.room.roomId);
    });

    return channels.map((entry) => entry.room);
}

function getSpaceGlyph(spaceName: string): string {
    const normalized = spaceName.trim().replace(/^[@#+!]+/, "");
    if (!normalized) {
        return "#";
    }

    return normalized[0].toUpperCase();
}

const MAX_SUBSPACE_DEPTH = 5;

interface HierarchyPageResponse {
    rooms: HierarchyRoom[];
    next_batch?: string;
}

/**
 * One hierarchy page, cancellable. client.getRoomHierarchy() takes no abort signal, so
 * this issues the same request through the http layer, which does -- otherwise a page we
 * have stopped waiting for would keep its connection open. Mirrors the SDK's
 * M_UNRECOGNIZED fallback to the MSC2946 prefix.
 */
async function fetchSpaceHierarchyPage(
    client: MatrixClient,
    roomId: string,
    fromToken: string | undefined,
    signal: AbortSignal,
): Promise<SpaceHierarchyPage> {
    const path = `/rooms/${encodeURIComponent(roomId)}/hierarchy`;
    const queryParams: Record<string, string> = {
        suggested_only: "false",
        max_depth: "1",
        limit: "100",
    };
    if (fromToken !== undefined) {
        queryParams.from = fromToken;
    }

    const request = (prefix: string): Promise<HierarchyPageResponse> =>
        client.http.authedRequest<HierarchyPageResponse>(Method.Get, path, queryParams, undefined, {
            prefix,
            abortSignal: signal,
        });

    try {
        const response = await request(ClientPrefix.V1);
        return { rooms: response.rooms ?? [], nextBatch: response.next_batch };
    } catch (error) {
        if (error instanceof MatrixError && error.errcode === "M_UNRECOGNIZED") {
            const response = await request("/_matrix/client/unstable/org.matrix.msc2946");
            return { rooms: response.rooms ?? [], nextBatch: response.next_batch };
        }
        throw error;
    }
}

function getSpaceHierarchyRooms(
    client: MatrixClient,
    spaceRoomId: string,
    signal?: AbortSignal,
): Promise<SpaceHierarchyResult> {
    return fetchSpaceHierarchy({
        fetchPage: (fromToken, pageSignal) => fetchSpaceHierarchyPage(client, spaceRoomId, fromToken, pageSignal),
        signal,
    });
}

function getHierarchyRoomName(room: HierarchyRoom): string {
    return room.name || room.canonical_alias || room.aliases?.[0] || room.room_id;
}

interface OrderedHierarchyChannelEntry {
    roomId: string;
    name: string;
    index: number;
    order?: string;
    customOrderIndex?: number;
}

function compareOrderedHierarchyChannelEntries(
    left: OrderedHierarchyChannelEntry,
    right: OrderedHierarchyChannelEntry,
): number {
    const leftCustom = left.customOrderIndex;
    const rightCustom = right.customOrderIndex;
    if (leftCustom !== undefined && rightCustom !== undefined && leftCustom !== rightCustom) {
        return leftCustom - rightCustom;
    }
    if (leftCustom !== undefined) {
        return -1;
    }
    if (rightCustom !== undefined) {
        return 1;
    }

    if (left.order && right.order) {
        const byOrder = left.order.localeCompare(right.order);
        if (byOrder !== 0) {
            return byOrder;
        }
    } else if (left.order) {
        return -1;
    } else if (right.order) {
        return 1;
    }

    if (left.index !== right.index) {
        return left.index - right.index;
    }

    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    if (byName !== 0) {
        return byName;
    }

    return left.roomId.localeCompare(right.roomId);
}

function sortRoomsBySpaceOrder(spaceRoom: Room, rooms: Room[]): Room[] {
    const childOrder = readSpaceChildOrder(spaceRoom);
    const customOrderByRoomId = buildCustomChannelOrderIndex(spaceRoom);
    const entries: Array<OrderedHierarchyChannelEntry & { room: Room }> = rooms.map((room, listIndex) => {
        const metadata = childOrder.get(room.roomId);
        return {
            room,
            roomId: room.roomId,
            name: getRoomName(room),
            index: metadata?.index ?? listIndex,
            order: metadata?.order,
            customOrderIndex: customOrderByRoomId.get(room.roomId),
        };
    });

    entries.sort(compareOrderedHierarchyChannelEntries);
    return entries.map((entry) => entry.room);
}

function buildJoinedHierarchyChannelIds(
    spaceRoom: Room,
    hierarchyRooms: HierarchyRoom[],
    visibleRoomIds: Set<string>,
    childOrderOverride?: Map<string, SpaceChildOrder>,
    customOrderOverride?: string[],
): string[] {
    const childOrder = childOrderOverride ?? readSpaceChildOrder(spaceRoom);
    const customOrderByRoomId = buildCustomChannelOrderIndex(spaceRoom, customOrderOverride);
    const entries: OrderedHierarchyChannelEntry[] = [];
    let hierarchyIndex = 0;

    for (const room of hierarchyRooms) {
        if (room.room_id === spaceRoom.roomId) {
            continue;
        }
        if (room.room_type === "m.space") {
            continue;
        }
        if (!visibleRoomIds.has(room.room_id)) {
            continue;
        }

        const metadata = childOrder.get(room.room_id);
        entries.push({
            roomId: room.room_id,
            name: getHierarchyRoomName(room),
            index: metadata?.index ?? hierarchyIndex,
            order: metadata?.order,
            customOrderIndex: customOrderByRoomId.get(room.room_id),
        });
        hierarchyIndex += 1;
    }

    entries.sort(compareOrderedHierarchyChannelEntries);
    return entries.map((entry) => entry.roomId);
}

function buildDiscoverableSpaceChannels(
    spaceRoom: Room,
    hierarchyRooms: HierarchyRoom[],
    visibleRoomIds: Set<string>,
    childOrderOverride?: Map<string, SpaceChildOrder>,
    customOrderOverride?: string[],
    voiceChannelHintRoomIds?: Set<string>,
): DiscoverableSpaceChannel[] {
    const childOrder = childOrderOverride ?? readSpaceChildOrder(spaceRoom);
    const customOrderByRoomId = buildCustomChannelOrderIndex(spaceRoom, customOrderOverride);
    const channels: Array<DiscoverableSpaceChannel & { index: number; order?: string; customOrderIndex?: number }> = [];
    let hierarchyIndex = 0;

    for (const room of hierarchyRooms) {
        if (room.room_id === spaceRoom.roomId) {
            continue;
        }
        if (room.room_type === "m.space") {
            continue;
        }
        if (visibleRoomIds.has(room.room_id)) {
            continue;
        }

        const joinRule = normaliseJoinRule(room.join_rule);
        const metadata = childOrder.get(room.room_id);
        channels.push({
            roomId: room.room_id,
            name: getHierarchyRoomName(room),
            joinRule,
            affordance: affordanceForJoinRule(joinRule),
            topic: room.topic,
            avatarMxc: room.avatar_url ?? null,
            memberCount: room.num_joined_members,
            isVoiceChannel: metadata?.isVoiceChannel === true || voiceChannelHintRoomIds?.has(room.room_id) === true,
            viaServers: metadata?.viaServers ?? [],
            index: metadata?.index ?? hierarchyIndex,
            order: metadata?.order,
            customOrderIndex: customOrderByRoomId.get(room.room_id),
        });
        hierarchyIndex += 1;
    }

    channels.sort(compareOrderedHierarchyChannelEntries);

    return channels.map(({ index: _index, order: _order, customOrderIndex: _customOrderIndex, ...channel }) => channel);
}

async function resolveSpaceHierarchyVoiceHints(
    client: MatrixClient,
    spaceRoom: Room,
    hierarchyRooms: HierarchyRoom[],
): Promise<{
    childOrderOverride?: Map<string, SpaceChildOrder>;
    customOrderOverride?: string[];
    voiceHintRoomIds: Set<string>;
}> {
    let childOrderOverride: Map<string, SpaceChildOrder> | undefined;
    let customOrderOverride: string[] | undefined;
    const voiceHintRoomIds = new Set<string>();
    const hierarchyChannelRoomIds = hierarchyRooms
        .filter((room) => room.room_id !== spaceRoom.roomId)
        .filter((room) => room.room_type !== "m.space")
        .map((room) => room.room_id);

    // The parent's m.space.child events come from the hierarchy response we already
    // fetched and cached, instead of downloading the space's entire state -- 20MB for
    // #community:matrix.org. Synapse builds children_state from the same current state,
    // untruncated, so this is the same data.
    childOrderOverride = readSpaceChildOrderFromStateSnapshot(
        rootChildrenState(hierarchyRooms, spaceRoom.roomId) as SpaceChildStateSnapshotEvent[],
    );
    for (const [roomId, metadata] of childOrderOverride.entries()) {
        if (metadata.isVoiceChannel) {
            voiceHintRoomIds.add(roomId);
        }
    }

    // The channel order is a single state event with an empty state key, so ask for just
    // that one rather than the whole room.
    try {
        const content = await sharedStateEventDeduperFor(client).get(
            spaceRoom.roomId,
            CHANNEL_ORDER_STATE_EVENT,
            "",
        );
        const remoteChannelOrder = readChannelOrderFromStateSnapshot([
            { type: CHANNEL_ORDER_STATE_EVENT, state_key: "", content },
        ] as SpaceChildStateSnapshotEvent[]);
        if (remoteChannelOrder.length > 0) {
            customOrderOverride = remoteChannelOrder;
        }
    } catch {
        // Absent or unreadable: fall back to whatever local state provides.
        customOrderOverride = undefined;
    }

    const voiceSelection = selectVoiceHintCandidates({
        childRoomIds: hierarchyChannelRoomIds,
        getRoom: (roomId) => client.getRoom(roomId),
        isVoiceChannel: isVoiceChannelRoom,
    });
    for (const roomId of voiceSelection.detected) {
        voiceHintRoomIds.add(roomId);
    }

    // Only joined rooms are probed: a non-member cannot read room state, and every one of
    // those requests was refused.
    await Promise.all(
        voiceSelection.toProbe.map(async (roomId) => {
            try {
                const roomState = await client.roomState(roomId);
                if (isVoiceChannelFromStateSnapshot(roomState as SpaceChildStateSnapshotEvent[])) {
                    voiceHintRoomIds.add(roomId);
                }
            } catch {
                // Room state can be inaccessible for non-members/invites; keep best-effort hints.
            }
        }),
    );

    return { childOrderOverride, customOrderOverride, voiceHintRoomIds };
}

function findParentSpaceIdForRoom(roomId: string, spaces: Room[]): string | null {
    for (const space of spaces) {
        const children = readSpaceChildOrder(space);
        if (children.has(roomId)) {
            return space.roomId;
        }
    }

    return null;
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

export function AppShell({ client, onLogout }: AppShellProps): React.ReactElement {
    const [voiceDiscoveryReady, setVoiceDiscoveryReady] = useState(false);
    const [rooms, setRooms] = useState<Room[]>(() => [...client.getRooms()]);
    const [selectedSpaceId, setSelectedSpaceId] = useState<string>(PEOPLE_SPACE_ID);
    const [activeRoomId, setActiveRoomId] = useState<string | null>(() => {
        const directRoomIds = getDirectRoomIds(client);
        const firstRoom = sortRoomsByActivity(
            client
                .getRooms()
                .filter((room) => !room.isSpaceRoom())
                .filter((room) => directRoomIds.has(room.roomId))
                .filter(isVisibleMembership),
        )[0];
        return firstRoom?.roomId ?? null;
    });
    const [replyToEvent, setReplyToEvent] = useState<MatrixEvent | null>(null);
    const [editingEvent, setEditingEvent] = useState<MatrixEvent | null>(null);
    const [renderReactionImages, setRenderReactionImages] = useState<boolean>(() => getFeatureRenderReactionImages());
    const [emojiUploadOpen, setEmojiUploadOpen] = useState(false);
    const [emojiUploadTarget, setEmojiUploadTarget] = useState<EmojiPackTarget | null>(null);
    const [createDirectChatOpen, setCreateDirectChatOpen] = useState(false);
    const [createRoomOpen, setCreateRoomOpen] = useState(false);
    const [createRoomParentSpaceId, setCreateRoomParentSpaceId] = useState<string | null>(null);
    const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
    const [importJsonOpen, setImportJsonOpen] = useState(false);
    const [spaceOnboardingSpaceId, setSpaceOnboardingSpaceId] = useState<string | null>(null);
    const [joinRoomOpen, setJoinRoomOpen] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteTargetRoomId, setInviteTargetRoomId] = useState<string | null>(null);
    const [roomSettingsRoomId, setRoomSettingsRoomId] = useState<string | null>(null);
    const [roomModerationOpen, setRoomModerationOpen] = useState(false);
    const [rightSidebarMode, setRightSidebarMode] = useState<RightSidebarMode>(() => readStoredRightSidebarMode());
    const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
    const [selectedSpaceHierarchyJoinedRoomIds, setSelectedSpaceHierarchyJoinedRoomIds] = useState<string[]>([]);
    const [discoverableSpaceChannels, setDiscoverableSpaceChannels] = useState<DiscoverableSpaceChannel[]>([]);
    const [spaceContentsPending, setSpaceContentsPending] = useState(false);
    const [spaceContentsTruncated, setSpaceContentsTruncated] = useState(false);
    const [topLevelSubspaces, setTopLevelSubspaces] = useState<SpaceChildSpace[]>([]);
    const [expandedSubspaceIds, setExpandedSubspaceIds] = useState<string[]>([]);
    const [subspaceChildren, setSubspaceChildren] = useState<Map<string, SpaceChildren>>(new Map());
    const [loadingSubspaceIds, setLoadingSubspaceIds] = useState<string[]>([]);
    const [subspaceErrors, setSubspaceErrors] = useState<Map<string, string>>(new Map());
    // Read inside callbacks so expanding a subspace does not depend on a fresh render,
    // and so an in-flight load is never restarted by unrelated state changes.
    const subspaceChildrenRef = useRef<Map<string, SpaceChildren>>(new Map());
    const subspaceLoadingRef = useRef<Set<string>>(new Set());
    // Aborted when the selected space changes, so a slow subspace load for the space
    // we left cannot land in the newly selected one.
    const subspaceAbortRef = useRef<AbortController>(new AbortController());
    // Instance-scoped rather than a module singleton, so it cannot outlive this session.
    // Entries are additionally keyed by account, so one account can never read another's.
    const hierarchyCacheRef = useRef<SpaceHierarchyCache>(new SpaceHierarchyCache());
    const accountKeyRef = useRef<string | null>(null);
    accountKeyRef.current = accountCacheKey(client.getUserId(), client.getHomeserverUrl());
    const [refreshedVoiceChannelHintsBySpaceId, setRefreshedVoiceChannelHintsBySpaceId] = useState<
        Map<string, Set<string>>
    >(new Map());
    const [joiningDiscoverableRoomId, setJoiningDiscoverableRoomId] = useState<string | null>(null);
    const [settingsState, setSettingsState] = useState<SettingsState | null>(null);
    const [statusMenuOpen, setStatusMenuOpen] = useState(false);
    const { config: coreConfig } = useMatrix();
    const localDomain = useMemo(() => client.getDomain(), [client]);
    const [pendingFocusRoomId, setPendingFocusRoomId] = useState<string | null>(null);
    const [userSettings, setUserSettings] = useState<UserLocalSettings>(() => loadUserLocalSettings());
    const [toast, setToast] = useState<ToastState | null>(null);
    const [voiceSessionRoomId, setVoiceSessionRoomId] = useState<string | null>(null);
    const [voiceSessionStatus, setVoiceSessionStatus] = useState<VoiceSessionStatus>("disconnected");
    const [voiceAutoJoinNonce, setVoiceAutoJoinNonce] = useState(0);
    const [voiceControlState, setVoiceControlState] = useState<VoiceControlState>(DEFAULT_VOICE_CONTROL_STATE);
    const [voiceSpeakingByRoomId, setVoiceSpeakingByRoomId] = useState<Map<string, Set<string>>>(new Map());
    const [voiceScreenShareByRoomId, setVoiceScreenShareByRoomId] = useState<Map<string, Set<string>>>(new Map());
    const [voiceParticipantsByRoomId, setVoiceParticipantsByRoomId] = useState<Map<string, Set<string>>>(new Map());
    const [timelineFocusBottomNonce, setTimelineFocusBottomNonce] = useState(0);
    const voiceRoomRef = useRef<VoiceRoomHandle | null>(null);
    const autoJoiningDirectRoomIdsRef = useRef<Set<string>>(new Set());
    const openRoomAtBottom = useCallback((roomId: string): void => {
        setActiveRoomId(roomId);
        setTimelineFocusBottomNonce((value) => value + 1);
    }, []);

    useEffect(() => {
        const onNotificationClicked = window.heorotDesktop?.onNotificationClicked;
        if (!onNotificationClicked) {
            return;
        }

        return onNotificationClicked(({ roomId }) => {
            if (!roomId || !client.getRoom(roomId)) {
                return;
            }
            openRoomAtBottom(roomId);
        });
    }, [client, openRoomAtBottom]);

    const handleLiveParticipantsChange = useCallback(
        ({
            roomId,
            participants,
        }: {
            roomId: string;
            participants: Array<{ identity: string; userId?: string; isSpeaking: boolean; isScreenSharing: boolean }>;
        }): void => {
            const normalizeParticipantId = (participant: { identity: string; userId?: string }): string =>
                participant.userId ?? participant.identity;

            const participantUserIds = new Set(participants.map((participant) => normalizeParticipantId(participant)));
            const speakingUserIds = new Set(
                participants
                    .filter((participant) => participant.isSpeaking)
                    .map((participant) => normalizeParticipantId(participant)),
            );
            const sharingUserIds = new Set(
                participants
                    .filter((participant) => participant.isScreenSharing)
                    .map((participant) => normalizeParticipantId(participant)),
            );

            setVoiceParticipantsByRoomId((current) => {
                const next = new Map(current);
                next.set(roomId, participantUserIds);
                return next;
            });
            setVoiceSpeakingByRoomId((current) => updateRoomIdentitySetMap(current, roomId, speakingUserIds));
            setVoiceScreenShareByRoomId((current) => updateRoomIdentitySetMap(current, roomId, sharingUserIds));
        },
        [],
    );

    useEffect(() => {
        setVoiceDiscoveryReady(false);
        const homeserverUrl =
            (client as MatrixClient & {
                getHomeserverUrl?: () => string;
            }).getHomeserverUrl?.() ?? client.baseUrl;
        void initVoiceDiscovery(homeserverUrl).then(() => setVoiceDiscoveryReady(true));
        return () => {
            clearVoiceDiscovery();
        };
    }, [client]);

    useEffect(() => {
        const watchedRooms = new Set<Room>();

        const onRoomsChanged = (): void => {
            syncRoomListeners();
            setRooms([...client.getRooms()]);
        };

        // Separate from onRoomsChanged because that one also serves listeners whose
        // arguments are not MatrixEvents.
        const onStateEvent = (event: MatrixEvent): void => {
            if (event.getType() === EventType.SpaceChild) {
                const spaceRoomId = event.getRoomId();
                const accountKey = accountKeyRef.current;
                if (spaceRoomId && accountKey) {
                    hierarchyCacheRef.current.invalidate(accountKey, spaceRoomId);
                }
            }
            onRoomsChanged();
        };

        const attachRoomListeners = (room: Room): void => {
            if (watchedRooms.has(room)) {
                return;
            }

            watchedRooms.add(room);
            room.on(RoomEvent.UnreadNotifications, onRoomsChanged);
            room.on(RoomEvent.Receipt, onRoomsChanged);
            room.currentState.on(RoomStateEvent.Events, onStateEvent);
        };

        const detachRoomListeners = (room: Room): void => {
            if (!watchedRooms.has(room)) {
                return;
            }

            room.removeListener(RoomEvent.UnreadNotifications, onRoomsChanged);
            room.removeListener(RoomEvent.Receipt, onRoomsChanged);
            room.currentState.removeListener(RoomStateEvent.Events, onStateEvent);
            watchedRooms.delete(room);
        };

        const syncRoomListeners = (): void => {
            const nextRooms = new Set(client.getRooms());

            for (const room of nextRooms) {
                attachRoomListeners(room);
            }

            for (const room of [...watchedRooms]) {
                if (!nextRooms.has(room)) {
                    detachRoomListeners(room);
                }
            }
        };

        client.on(ClientEvent.Room, onRoomsChanged);
        client.on(ClientEvent.Sync, onRoomsChanged);
        client.on(ClientEvent.AccountData, onRoomsChanged);
        client.on(RoomEvent.Timeline, onRoomsChanged);
        client.on(MatrixEventEvent.Decrypted, onRoomsChanged);

        onRoomsChanged();

        return () => {
            client.removeListener(ClientEvent.Room, onRoomsChanged);
            client.removeListener(ClientEvent.Sync, onRoomsChanged);
            client.removeListener(ClientEvent.AccountData, onRoomsChanged);
            client.removeListener(RoomEvent.Timeline, onRoomsChanged);
            client.removeListener(MatrixEventEvent.Decrypted, onRoomsChanged);

            for (const room of [...watchedRooms]) {
                detachRoomListeners(room);
            }
        };
    }, [client]);

    const visibleRooms = useMemo(
        () => rooms.filter(isVisibleMembership),
        [rooms],
    );
    const visibleRoomIdsKey = useMemo(
        () => visibleRooms.map((room) => room.roomId).sort().join("\u0000"),
        [visibleRooms],
    );
    const unreadNotificationTotal = useMemo(
        () => visibleRooms.reduce((total, room) => {
            const count = room.getUnreadNotificationCount();
            return total + (Number.isFinite(count) ? Math.max(0, count) : 0);
        }, 0),
        [visibleRooms, visibleRoomIdsKey, rooms],
    );
    const presenceEnabled = useMemo(
        () => isPresenceEnabledForClient(coreConfig, client),
        [client, coreConfig],
    );
    const presenceControl = usePresenceSelection(client, presenceEnabled);
    useEffect(() => {
        const desktopBadge = window.heorotDesktop?.setBadgeCount;
        if (!desktopBadge) {
            return;
        }
        void desktopBadge(unreadNotificationTotal).catch(() => undefined);
    }, [unreadNotificationTotal]);
    const directRoomIds = useMemo(
        () => getDirectRoomIds(client),
        [client, rooms],
    );

    useEffect(() => {
        if (client.isGuest()) {
            return;
        }

        const ownUserId = client.getUserId() ?? "";
        if (!ownUserId) {
            return;
        }

        const hintedDirectInvites = rooms
            .filter((room) => !room.isSpaceRoom() && room.getMyMembership() === "invite")
            .flatMap((room) => {
                const inviterUserId = (room as Room & { getDMInviter?: () => string | undefined }).getDMInviter?.();
                if (typeof inviterUserId !== "string" || inviterUserId.length === 0 || inviterUserId === ownUserId) {
                    return [];
                }

                return [{ roomId: room.roomId, inviterUserId }];
            });

        if (hintedDirectInvites.length === 0) {
            return;
        }

        let cancelled = false;
        void (async () => {
            for (const inviteHint of hintedDirectInvites) {
                if (cancelled) {
                    return;
                }

                try {
                    await ensureDirectRoomMapping(client, inviteHint.roomId, inviteHint.inviterUserId);
                } catch {
                    // best-effort mapping to keep DM invites visible and stable
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [client, rooms]);
    const roomById = useMemo(
        () => new Map(visibleRooms.map((room) => [room.roomId, room])),
        [visibleRooms],
    );
    const spaces = useMemo(
        () => sortRoomsByName(visibleRooms.filter((room) => room.isSpaceRoom())),
        [visibleRooms],
    );
    const voiceChannelHintRoomIds = useMemo(() => {
        const hints = new Set<string>();
        for (const space of spaces) {
            const childOrder = readSpaceChildOrder(space);
            for (const [roomId, metadata] of childOrder.entries()) {
                if (metadata.isVoiceChannel) {
                    hints.add(roomId);
                }
            }
        }
        for (const voiceHints of refreshedVoiceChannelHintsBySpaceId.values()) {
            for (const roomId of voiceHints) {
                hints.add(roomId);
            }
        }
        return hints;
    }, [refreshedVoiceChannelHintsBySpaceId, spaces]);
    const peopleChannels = useMemo(
        () =>
            sortRoomsByActivity(
                visibleRooms.filter((room) => !room.isSpaceRoom() && directRoomIds.has(room.roomId)),
            ),
        [directRoomIds, visibleRooms],
    );
    const isRoomVoiceChannel = useCallback(
        (room: Room | null): boolean => Boolean(room && (isVoiceChannelRoom(room) || voiceChannelHintRoomIds.has(room.roomId))),
        [voiceChannelHintRoomIds],
    );
    const selectedSpaceRoom = useMemo(
        () =>
            selectedSpaceId === PEOPLE_SPACE_ID
                ? null
                : roomById.get(selectedSpaceId) ?? null,
        [roomById, selectedSpaceId],
    );

    const channels = useMemo(() => {
        if (selectedSpaceId === PEOPLE_SPACE_ID) {
            return peopleChannels;
        }

        if (!selectedSpaceRoom || !selectedSpaceRoom.isSpaceRoom()) {
            return [];
        }

        if (selectedSpaceHierarchyJoinedRoomIds.length > 0) {
            const hierarchyRooms = selectedSpaceHierarchyJoinedRoomIds
                .map((roomId) => roomById.get(roomId))
                .filter((room): room is Room => Boolean(room && !room.isSpaceRoom() && isVisibleMembership(room)));
            if (hierarchyRooms.length > 0) {
                return sortRoomsBySpaceOrder(selectedSpaceRoom, hierarchyRooms);
            }
        }

        return getSpaceChannels(selectedSpaceRoom, roomById);
    }, [peopleChannels, roomById, selectedSpaceHierarchyJoinedRoomIds, selectedSpaceId, selectedSpaceRoom]);

    useEffect(() => {
        if (selectedSpaceId === PEOPLE_SPACE_ID || !selectedSpaceRoom?.isSpaceRoom()) {
            setSelectedSpaceHierarchyJoinedRoomIds([]);
            setDiscoverableSpaceChannels([]);
            setJoiningDiscoverableRoomId(null);
            setSpaceContentsPending(false);
            setTopLevelSubspaces([]);
            setSpaceContentsTruncated(false);
            return;
        }

        let cancelled = false;
        const currentSpaceRoom = selectedSpaceRoom;
        const visibleRoomIds = new Set(
            visibleRoomIdsKey.length > 0 ? visibleRoomIdsKey.split("\u0000") : [],
        );
        const abortController = new AbortController();
        const loadPublicChannels = async (): Promise<void> => {
            try {
                // Assume pending while the request is outstanding. A space whose own state
                // advertises children has contents; if we cannot list them yet the honest
                // thing to show is "still fetching", not "empty".
                const advertisedChildCount = currentSpaceRoom.currentState.getStateEvents(
                    EventType.SpaceChild,
                ).length;
                const accountKey = accountKeyRef.current;
                const cachedHierarchy = accountKey
                    ? hierarchyCacheRef.current.get(accountKey, currentSpaceRoom.roomId)
                    : null;

                let hierarchy: SpaceHierarchyResult;
                if (cachedHierarchy) {
                    // Switching back to a space already listed should be instant; only
                    // complete results are ever cached, so this is never half a space.
                    hierarchy = cachedHierarchy;
                } else {
                    if (advertisedChildCount > 0) {
                        setSpaceContentsPending(true);
                    }

                    // Registered before the request so an invalidation arriving mid-flight
                    // can refuse the write rather than let stale data back in.
                    const cacheToken = accountKey
                        ? hierarchyCacheRef.current.beginFetch(accountKey, currentSpaceRoom.roomId)
                        : null;

                    hierarchy = await getSpaceHierarchyRooms(
                        client,
                        currentSpaceRoom.roomId,
                        abortController.signal,
                    );
                    if (cancelled) {
                        return;
                    }

                    if (cacheToken) {
                        hierarchyCacheRef.current.set(cacheToken, hierarchy);
                    }
                }

                const hierarchyRooms = hierarchy.rooms;
                // The page cap stopped us with more pages on offer: say so rather than
                // presenting a truncated hierarchy as the whole space.
                setSpaceContentsTruncated(!hierarchy.complete);

                const hierarchyChildCount = hierarchyRooms.filter(
                    (room) => room.room_id !== currentSpaceRoom.roomId,
                ).length;
                setSpaceContentsPending(hierarchyChildCount === 0 && advertisedChildCount > 0);

                const { childOrderOverride, customOrderOverride, voiceHintRoomIds } = await resolveSpaceHierarchyVoiceHints(
                    client,
                    currentSpaceRoom,
                    hierarchyRooms,
                );
                if (cancelled) {
                    return;
                }
                setRefreshedVoiceChannelHintsBySpaceId((current) => {
                    const currentHints = current.get(currentSpaceRoom.roomId);
                    if (voiceHintRoomIds.size === 0) {
                        if (!currentHints) {
                            return current;
                        }
                        const next = new Map(current);
                        next.delete(currentSpaceRoom.roomId);
                        return next;
                    }
                    if (areStringSetsEqual(currentHints, voiceHintRoomIds)) {
                        return current;
                    }
                    const next = new Map(current);
                    next.set(currentSpaceRoom.roomId, voiceHintRoomIds);
                    return next;
                });
                setSelectedSpaceHierarchyJoinedRoomIds(
                    buildJoinedHierarchyChannelIds(currentSpaceRoom, hierarchyRooms, visibleRoomIds, childOrderOverride, customOrderOverride),
                );
                const viaServersByRoomId = readViaServers(hierarchyRooms);
                setTopLevelSubspaces(
                    partitionSpaceChildren(currentSpaceRoom.roomId, hierarchyRooms, {
                        viaServersByRoomId,
                    }).spaces,
                );

                const channelsToJoin = buildDiscoverableSpaceChannels(
                    currentSpaceRoom,
                    hierarchyRooms,
                    visibleRoomIds,
                    childOrderOverride,
                    customOrderOverride,
                    voiceHintRoomIds,
                );
                setDiscoverableSpaceChannels(channelsToJoin);

                // Auto-joining every public channel is the intended experience for a
                // space on our own server: opening it should feel like the whole space
                // is already yours. For a remote space it is not -- browsing something
                // like #community:matrix.org would silently drag the account into dozens
                // of unrelated rooms, so there they stay opt-in through the discoverable
                // list and its Join buttons.
                const spaceServerName = currentSpaceRoom.roomId.slice(
                    currentSpaceRoom.roomId.indexOf(":") + 1,
                );
                const channelsToAutoJoin =
                    spaceServerName === client.getDomain()
                        ? channelsToJoin.filter((channel) => (channel.affordance ?? "join") === "join")
                        : [];

                const successfullyJoinedIds: string[] = [];
                for (const channel of channelsToAutoJoin) {
                    if (cancelled) {
                        return;
                    }

                    const viaServers = channel.viaServers?.filter((v) => v.length > 0) ?? [];
                    try {
                        const joinedChannel = await joinRoomWithRetry(client, channel.roomId, { viaServers });
                        const latestJoinedChannel = client.getRoom(channel.roomId) ?? joinedChannel;
                        if (latestJoinedChannel.getMyMembership() === "join") {
                            successfullyJoinedIds.push(channel.roomId);
                        }
                    } catch {
                        // Keep channel in discoverable list when join fails.
                    }
                }
                if (cancelled) return;

                // Immediately update channel list using already-fetched hierarchy data.
                // Don't wait for visibleRoomIdsKey change + another HTTP hierarchy call.
                if (successfullyJoinedIds.length > 0) {
                    const successfulRoomIds = new Set(successfullyJoinedIds);
                    const updatedVisibleRoomIds = new Set([...visibleRoomIds, ...successfullyJoinedIds]);
                    setSelectedSpaceHierarchyJoinedRoomIds(
                        buildJoinedHierarchyChannelIds(currentSpaceRoom, hierarchyRooms, updatedVisibleRoomIds, childOrderOverride, customOrderOverride),
                    );
                    setDiscoverableSpaceChannels((current) =>
                        current.filter((channel) => !successfulRoomIds.has(channel.roomId)),
                    );
                }
            } catch (loadError) {
                if (cancelled) {
                    return;
                }

                const advertisesChildren =
                    currentSpaceRoom.currentState.getStateEvents(EventType.SpaceChild).length > 0;

                if (loadError instanceof SpaceHierarchyAbortedError) {
                    // We navigated away; the newly selected space owns the UI now.
                    return;
                }

                if (loadError instanceof SpaceHierarchyPageTimeoutError) {
                    // A page never answered, which is what a partial-state room does.
                    // Leave whatever is already listed rather than blanking it, and say
                    // the contents could not be listed yet.
                    setSpaceContentsPending(advertisesChildren);
                    return;
                }

                setSelectedSpaceHierarchyJoinedRoomIds([]);
                setDiscoverableSpaceChannels([]);
                setSpaceContentsPending(advertisesChildren);
                setRefreshedVoiceChannelHintsBySpaceId((current) => {
                    if (!current.has(currentSpaceRoom.roomId)) {
                        return current;
                    }
                    const next = new Map(current);
                    next.delete(currentSpaceRoom.roomId);
                    return next;
                });
            }
        };

        void loadPublicChannels();

        return () => {
            // Both: ignore anything still in flight, and cancel it, so a slow response
            // for the space we just left cannot overwrite the one now selected.
            cancelled = true;
            abortController.abort();
        };
    }, [client, selectedSpaceId, selectedSpaceRoom, visibleRoomIdsKey]);

    useEffect(() => {
        setExpandedSubspaceIds([]);
        setSubspaceChildren(new Map());
        setLoadingSubspaceIds([]);
        setSubspaceErrors(new Map());
        subspaceChildrenRef.current = new Map();
        subspaceLoadingRef.current = new Set();
        subspaceAbortRef.current.abort();
        subspaceAbortRef.current = new AbortController();
    }, [selectedSpaceId]);

    const loadSubspaceChildren = useCallback(
        async (spaceId: string): Promise<void> => {
            if (subspaceChildrenRef.current.has(spaceId) || subspaceLoadingRef.current.has(spaceId)) {
                return;
            }

            subspaceLoadingRef.current.add(spaceId);
            setLoadingSubspaceIds((current) => (current.includes(spaceId) ? current : [...current, spaceId]));
            setSubspaceErrors((current) => {
                if (!current.has(spaceId)) {
                    return current;
                }
                const next = new Map(current);
                next.delete(spaceId);
                return next;
            });

            try {
                const hierarchy = await getSpaceHierarchyRooms(client, spaceId, subspaceAbortRef.current.signal);
                const rooms = hierarchy.rooms;
                // Anything already placed in the tree is excluded, so a space listing an
                // ancestor or sibling as a child cannot make the expansion recurse.
                const exclude = new Set<string>(subspaceChildrenRef.current.keys());
                if (selectedSpaceRoom) {
                    exclude.add(selectedSpaceRoom.roomId);
                }
                exclude.delete(spaceId);

                const children = partitionSpaceChildren(spaceId, rooms, {
                    excludeRoomIds: exclude,
                    viaServersByRoomId: readViaServers(rooms),
                });
                subspaceChildrenRef.current.set(spaceId, children);
                setSubspaceChildren((current) => new Map(current).set(spaceId, children));
                if (!hierarchy.complete) {
                    setSubspaceErrors((current) =>
                        new Map(current).set(spaceId, "This subspace is too large to list in full."),
                    );
                }
            } catch (loadError) {
                if (loadError instanceof SpaceHierarchyAbortedError) {
                    // The space selection changed; this result is no longer wanted.
                    return;
                }
                const message =
                    loadError instanceof SpaceHierarchyPageTimeoutError
                        ? "Still fetching this subspace. Reopen it to try again."
                        : loadError instanceof Error
                          ? loadError.message
                          : "Could not list this subspace.";
                setSubspaceErrors((current) => new Map(current).set(spaceId, message));
            } finally {
                subspaceLoadingRef.current.delete(spaceId);
                setLoadingSubspaceIds((current) => current.filter((id) => id !== spaceId));
            }
        },
        [client, selectedSpaceRoom],
    );

    const handleToggleSubspace = useCallback(
        (roomId: string): void => {
            // Decide from current state rather than from a flag set inside the updater:
            // React runs updaters while processing the queue, so such a flag is still
            // unset when the callback continues, and the load would never fire.
            const isExpanded = expandedSubspaceIds.includes(roomId);
            setExpandedSubspaceIds(
                isExpanded ? expandedSubspaceIds.filter((id) => id !== roomId) : [...expandedSubspaceIds, roomId],
            );

            if (!isExpanded) {
                // Idempotent: returns immediately if this subspace is already cached or
                // in flight, so reopening a group costs no request.
                void loadSubspaceChildren(roomId);
            }
        },
        [expandedSubspaceIds, loadSubspaceChildren],
    );

    const visibleRoomIdSet = useMemo(
        () => new Set(visibleRoomIdsKey.length > 0 ? visibleRoomIdsKey.split("\u0000") : []),
        [visibleRoomIdsKey],
    );

    const subspaceGroupViews = useMemo<SubspaceGroupView[]>(() => {
        const toChannel = (room: SpaceChildRoom): DiscoverableSpaceChannel => ({
            roomId: room.roomId,
            name: room.name,
            topic: room.topic,
            avatarMxc: room.avatarMxc,
            memberCount: room.memberCount,
            viaServers: room.viaServers,
            joinRule: room.joinRule,
            affordance: room.affordance,
        });

        const build = (space: SpaceChildSpace, depth: number, seen: ReadonlySet<string>): SubspaceGroupView => {
            const children = subspaceChildren.get(space.roomId);
            const nextSeen = new Set(seen).add(space.roomId);

            return {
                roomId: space.roomId,
                name: space.name,
                memberCount: space.memberCount,
                expanded: expandedSubspaceIds.includes(space.roomId),
                loading: loadingSubspaceIds.includes(space.roomId),
                error: subspaceErrors.get(space.roomId) ?? null,
                rooms: (children?.rooms ?? [])
                    .filter((room) => !visibleRoomIdSet.has(room.roomId))
                    .map(toChannel),
                // Bounded depth as a second guard: excludeRoomIds already stops cycles,
                // but a deliberately deep tree should not render without limit either.
                subspaces:
                    depth + 1 >= MAX_SUBSPACE_DEPTH
                        ? []
                        : (children?.spaces ?? [])
                              .filter((child) => !nextSeen.has(child.roomId))
                              .map((child) => build(child, depth + 1, nextSeen)),
            };
        };

        const roots: ReadonlySet<string> = new Set(selectedSpaceRoom ? [selectedSpaceRoom.roomId] : []);
        return topLevelSubspaces.map((space) => build(space, 0, roots));
    }, [
        expandedSubspaceIds,
        loadingSubspaceIds,
        selectedSpaceRoom,
        subspaceChildren,
        subspaceErrors,
        topLevelSubspaces,
        visibleRoomIdSet,
    ]);

    /** Every channel currently offered, including ones nested inside subspaces. */
    const listedChannelsById = useMemo(() => {
        const byId = new Map<string, DiscoverableSpaceChannel>();
        for (const channel of discoverableSpaceChannels) {
            byId.set(channel.roomId, channel);
        }
        for (const children of subspaceChildren.values()) {
            for (const room of children.rooms) {
                if (!byId.has(room.roomId)) {
                    byId.set(room.roomId, {
                        roomId: room.roomId,
                        name: room.name,
                        topic: room.topic,
                        avatarMxc: room.avatarMxc,
                        memberCount: room.memberCount,
                        viaServers: room.viaServers,
                        joinRule: room.joinRule,
                        affordance: room.affordance,
                    });
                }
            }
        }
        return byId;
    }, [discoverableSpaceChannels, subspaceChildren]);

    const showSpaceOnboarding =
        Boolean(spaceOnboardingSpaceId) &&
        selectedSpaceId === spaceOnboardingSpaceId &&
        Boolean(selectedSpaceRoom) &&
        channels.length === 0 &&
        discoverableSpaceChannels.length === 0;

    useEffect(() => {
        if (selectedSpaceId === PEOPLE_SPACE_ID) {
            return;
        }

        if (!spaces.some((space) => space.roomId === selectedSpaceId)) {
            setSelectedSpaceId(PEOPLE_SPACE_ID);
        }
    }, [selectedSpaceId, spaces]);

    useEffect(() => {
        const visibleSpaceIds = new Set(spaces.map((space) => space.roomId));
        setRefreshedVoiceChannelHintsBySpaceId((current) => {
            let changed = false;
            const next = new Map<string, Set<string>>();

            for (const [spaceId, roomIds] of current.entries()) {
                if (!visibleSpaceIds.has(spaceId)) {
                    changed = true;
                    continue;
                }
                next.set(spaceId, roomIds);
            }

            return changed ? next : current;
        });
    }, [spaces]);

    useEffect(() => {
        if (pendingFocusRoomId) {
            if (channels.some((room) => room.roomId === pendingFocusRoomId)) {
                openRoomAtBottom(pendingFocusRoomId);
                setPendingFocusRoomId(null);
            }
            return;
        }

        if (channels.length === 0) {
            setActiveRoomId(null);
            return;
        }

        if (!activeRoomId) {
            openRoomAtBottom(channels[0].roomId);
            return;
        }

        if (!channels.some((room) => room.roomId === activeRoomId)) {
            const selectedSpaceIsPeople = selectedSpaceId === PEOPLE_SPACE_ID;
            const activeRoomIsDirect = directRoomIds.has(activeRoomId);
            if (selectedSpaceIsPeople && activeRoomIsDirect) {
                return;
            }

            openRoomAtBottom(channels[0].roomId);
        }
    }, [activeRoomId, channels, directRoomIds, openRoomAtBottom, pendingFocusRoomId, selectedSpaceId]);

    useEffect(() => {
        setReplyToEvent(null);
        setEditingEvent(null);
    }, [activeRoomId]);

    useEffect(() => {
        setSidebarSearchQuery("");
    }, [activeRoomId]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        window.localStorage.setItem(RIGHT_SIDEBAR_MODE_STORAGE_KEY, rightSidebarMode);
    }, [rightSidebarMode]);

    const activeRoom = useMemo(
        () => (activeRoomId ? roomById.get(activeRoomId) ?? null : null),
        [activeRoomId, roomById],
    );
    const roomSettingsRoom = useMemo(
        () => (roomSettingsRoomId ? client.getRoom(roomSettingsRoomId) ?? null : null),
        [client, roomSettingsRoomId],
    );
    const inviteTargetRoom = useMemo(
        () => (inviteTargetRoomId ? roomById.get(inviteTargetRoomId) ?? client.getRoom(inviteTargetRoomId) ?? null : activeRoom),
        [activeRoom, client, inviteTargetRoomId, roomById],
    );
    const { panelMode, selectUser, clearSelectedUser } = useSelectedUser(activeRoom?.roomId ?? null);
    const ownUserId = client.getUserId() ?? "";
    const canInviteInActiveRoom = Boolean(activeRoom && ownUserId && activeRoom.canInvite(ownUserId));
    // Read once and never updated, this showed the raw user ID whenever the
    // profile had not reached the store before the first render -- nothing
    // listened for it arriving, so it stayed wrong until some unrelated state
    // change re-rendered the shell.
    const [ownProfile, setOwnProfile] = useState<{ displayName: string; avatarMxc: string }>(() => {
        const user = ownUserId ? client.getUser(ownUserId) : null;
        return { displayName: user?.displayName ?? "", avatarMxc: user?.avatarUrl ?? "" };
    });

    useEffect(() => {
        if (!ownUserId) {
            return;
        }

        let cancelled = false;
        const user = client.getUser(ownUserId);

        const applyFromUser = (): void => {
            const current = client.getUser(ownUserId);
            setOwnProfile((previous) => {
                const displayName = current?.displayName ?? previous.displayName;
                const avatarMxc = current?.avatarUrl ?? previous.avatarMxc;
                return displayName === previous.displayName && avatarMxc === previous.avatarMxc
                    ? previous
                    : { displayName, avatarMxc };
            });
        };

        applyFromUser();
        user?.on(UserEvent.DisplayName, applyFromUser);
        user?.on(UserEvent.AvatarUrl, applyFromUser);

        // The User object exists before sync has filled it in, so the events
        // above may never fire for a profile that was already set. Ask once.
        void client
            .getProfileInfo(ownUserId)
            .then((profile) => {
                if (cancelled) {
                    return;
                }
                setOwnProfile((previous) => ({
                    displayName: profile.displayname || previous.displayName,
                    avatarMxc: profile.avatar_url || previous.avatarMxc,
                }));
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
            user?.off(UserEvent.DisplayName, applyFromUser);
            user?.off(UserEvent.AvatarUrl, applyFromUser);
        };
    }, [client, ownUserId]);

    // Falling back to the bare user ID read as a bug; the localpart is what the
    // account is called, and is what a still-unknown profile should look like.
    const ownDisplayName = ownProfile.displayName || mxidLocalpart(ownUserId) || "User";
    const ownAvatarMxc = ownProfile.avatarMxc;
    const ownAvatarSources = useMemo(
        () =>
            Array.from(
                new Set(
                    [
                        thumbnailFromMxc(client, ownAvatarMxc, 64, 64, "crop"),
                        mediaFromMxc(client, ownAvatarMxc),
                    ].filter((url): url is string => Boolean(url)),
                ),
            ),
        [client, ownAvatarMxc],
    );
    const selectedSpaceName =
        selectedSpaceId === PEOPLE_SPACE_ID
              ? "People"
              : selectedSpaceRoom
                ? getRoomName(selectedSpaceRoom)
                : "People";
    const isActiveRoomDirect = Boolean(activeRoom && directRoomIds.has(activeRoom.roomId));
    const activeDirectPartnerId =
        activeRoom && isActiveRoomDirect ? getOneToOnePartnerId(activeRoom, client.getUserId() ?? "") : null;
    const shouldShowReadReceipts =
        userSettings.privacy.showReadReceipts && selectedSpaceId === PEOPLE_SPACE_ID && isActiveRoomDirect;
    const isActiveRoomVoiceChannel = isRoomVoiceChannel(activeRoom);
    const shouldShowVoicePanel = Boolean(activeRoom && isActiveRoomVoiceChannel && voiceSessionRoomId === activeRoom.roomId);
    const shouldPrefixRoomWithHash = selectedSpaceId !== PEOPLE_SPACE_ID;
    const activeVoiceSessionRoom = useMemo(
        () => (voiceSessionRoomId ? roomById.get(voiceSessionRoomId) ?? client.getRoom(voiceSessionRoomId) ?? null : null),
        [client, roomById, voiceSessionRoomId],
    );
    const hasActiveVoiceSession = Boolean(
        voiceSessionRoomId && (voiceSessionStatus === "connected" || voiceSessionStatus === "joining"),
    );
    const liveVoiceParticipantsOverrideRoomId =
        voiceSessionRoomId && (voiceSessionStatus === "connected" || voiceSessionStatus === "joining")
            ? voiceSessionRoomId
            : null;
    useEffect(() => {
        setFeatureRenderReactionImages(renderReactionImages);
    }, [renderReactionImages]);

    useEffect(() => {
        saveUserLocalSettings(userSettings);
        applyAppearanceTheme(userSettings.appearance);
    }, [userSettings]);

    const handleUserSettingsChange = useCallback((nextSettings: UserLocalSettings): void => {
        console.log(
            `[jorvik-notification] settings update before=${userSettings.notifications.notificationsEnabled} after=${nextSettings.notifications.notificationsEnabled}`,
        );
        setUserSettings(nextSettings);
        try {
            saveUserLocalSettings(nextSettings);
            const persisted = loadUserLocalSettings();
            console.log(`[jorvik-notification] settings persisted=${persisted.notifications.notificationsEnabled}`);
        } catch (error) {
            console.error(`[jorvik-notification] settings persist failed error=${error instanceof Error ? error.message : String(error)}`);
        }
    }, [userSettings]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const bridge = window.heorotDesktop;
        if (!bridge?.setCloseOnWindowCloseMinimize) {
            return;
        }

        void bridge.setCloseOnWindowCloseMinimize(userSettings.appearance.closeOnWindowCloseMinimize);
    }, [userSettings.appearance.closeOnWindowCloseMinimize]);

    useEffect(() => {
        if (isRoomVoiceChannel(activeRoom) && !voiceSessionRoomId && activeRoom) {
            setVoiceSessionRoomId(activeRoom.roomId);
        }
    }, [activeRoom, isRoomVoiceChannel, voiceSessionRoomId]);

    useEffect(() => {
        if (!voiceSessionRoomId) {
            return;
        }
        if (roomById.has(voiceSessionRoomId)) {
            return;
        }
        setVoiceSessionRoomId(null);
        setVoiceSessionStatus("disconnected");
    }, [roomById, voiceSessionRoomId]);

    useEffect(() => {
        if (voiceSessionRoomId) {
            return;
        }
        setVoiceControlState(DEFAULT_VOICE_CONTROL_STATE);
    }, [voiceSessionRoomId]);

    useEffect(() => {
        if (!settingsState || settingsState.mode !== "server") {
            return;
        }

        if (selectedSpaceId === PEOPLE_SPACE_ID || !selectedSpaceRoom) {
            setSettingsState(null);
        }
    }, [selectedSpaceId, selectedSpaceRoom, settingsState]);

    const pushToast = useCallback((nextToast: Omit<ToastState, "id">): void => {
        setToast({
            id: Date.now(),
            ...nextToast,
        });
    }, []);

    const copyActiveRoomLink = useCallback(async (): Promise<void> => {
        if (!activeRoom) {
            return;
        }

        try {
            await copyText(buildMatrixToRoomPermalink(activeRoom.roomId));
            pushToast({ type: "success", message: "Room link copied." });
        } catch (copyError) {
            const message = copyError instanceof Error ? copyError.message : "Failed to copy room link.";
            pushToast({ type: "error", message });
        }
    }, [activeRoom, pushToast]);

    const reloadSpaceChannelsFromServer = useCallback(
        async (spaceId: string): Promise<void> => {
            const targetSpace = client.getRoom(spaceId);
            if (!targetSpace || !targetSpace.isSpaceRoom()) {
                pushToast({ type: "error", message: "Unable to reload channels: selected server is unavailable." });
                return;
            }

            try {
                let hierarchySpaceRoom = targetSpace;
                if (hierarchySpaceRoom.getMyMembership() !== "join") {
                    const fallbackViaServers = getViaServersForParentSpace(client, hierarchySpaceRoom.roomId);
                    try {
                        await joinRoomWithRetry(client, hierarchySpaceRoom.roomId, {
                            viaServers: fallbackViaServers,
                            maxAttempts: 1,
                        });
                    } catch {
                        // Best-effort join for users invited only to a child channel.
                    }

                    const refreshedSpaceRoom = client.getRoom(hierarchySpaceRoom.roomId);
                    if (refreshedSpaceRoom?.isSpaceRoom()) {
                        hierarchySpaceRoom = refreshedSpaceRoom;
                    }
                }

                if (hierarchySpaceRoom.getMyMembership() !== "join") {
                    setSelectedSpaceHierarchyJoinedRoomIds([]);
                    setDiscoverableSpaceChannels([]);
                    setJoiningDiscoverableRoomId(null);
                    setRooms([...client.getRooms()]);
                    pushToast({
                        type: "error",
                        message: "Can't load server hierarchy because you're not joined to the server room.",
                    });
                    return;
                }

                const hierarchyRooms = (await getSpaceHierarchyRooms(client, hierarchySpaceRoom.roomId))
                    .rooms;
                const { childOrderOverride, voiceHintRoomIds: refreshedVoiceHints } = await resolveSpaceHierarchyVoiceHints(
                    client,
                    hierarchySpaceRoom,
                    hierarchyRooms,
                );

                setRefreshedVoiceChannelHintsBySpaceId((current) => {
                    const currentHints = current.get(spaceId);
                    if (refreshedVoiceHints.size === 0) {
                        if (!currentHints) {
                            return current;
                        }
                        const next = new Map(current);
                        next.delete(spaceId);
                        return next;
                    }
                    if (areStringSetsEqual(currentHints, refreshedVoiceHints)) {
                        return current;
                    }
                    const next = new Map(current);
                    next.set(spaceId, refreshedVoiceHints);
                    return next;
                });

                const hierarchyChannelRoomIds = hierarchyRooms
                    .filter((room) => room.room_id !== hierarchySpaceRoom.roomId)
                    .filter((room) => room.room_type !== "m.space")
                    .map((room) => room.room_id);
                const allHierarchyChannelIds = new Set(hierarchyChannelRoomIds);
                const latestVisibleRoomIds = new Set(
                    client
                        .getRooms()
                        .filter(isVisibleMembership)
                        .map((room) => room.roomId),
                );
                const hierarchyOrderForSpace = buildJoinedHierarchyChannelIds(
                    hierarchySpaceRoom,
                    hierarchyRooms,
                    allHierarchyChannelIds,
                    childOrderOverride,
                    [],
                );
                const joinedHierarchyOrder = hierarchyOrderForSpace.filter((roomId) => latestVisibleRoomIds.has(roomId));

                const ownUserId = client.getUserId() ?? "";
                const canPersistHierarchyOrder =
                    ownUserId.length > 0 && hierarchySpaceRoom.currentState.maySendStateEvent(CHANNEL_ORDER_STATE_EVENT, ownUserId);
                if (canPersistHierarchyOrder) {
                    const currentOrder = readChannelOrder(hierarchySpaceRoom);
                    const seenHierarchyIds = new Set(hierarchyOrderForSpace);
                    const mergedOrder = [
                        ...hierarchyOrderForSpace,
                        ...currentOrder.filter((roomId) => !seenHierarchyIds.has(roomId)),
                    ];
                    if (!areStringArraysEqual(currentOrder, mergedOrder)) {
                        await writeChannelOrder(client, hierarchySpaceRoom.roomId, mergedOrder);
                    }
                }

                setSelectedSpaceHierarchyJoinedRoomIds(joinedHierarchyOrder);
                setDiscoverableSpaceChannels(
                    buildDiscoverableSpaceChannels(
                        hierarchySpaceRoom,
                        hierarchyRooms,
                        latestVisibleRoomIds,
                        childOrderOverride,
                        hierarchyOrderForSpace,
                        refreshedVoiceHints,
                    ),
                );
                setJoiningDiscoverableRoomId(null);
                setRooms([...client.getRooms()]);
                pushToast({ type: "success", message: "Channels reloaded from server hierarchy." });
            } catch (reloadError) {
                const message = reloadError instanceof Error ? reloadError.message : "Failed to reload channels.";
                pushToast({ type: "error", message });
            }
        },
        [client, pushToast],
    );

    const runVoiceRoomAction = useCallback(
        (action: (voiceRoom: VoiceRoomHandle) => Promise<void>, fallbackMessage: string): void => {
            const voiceRoom = voiceRoomRef.current;
            if (!voiceRoom) {
                return;
            }

            void action(voiceRoom).catch((voiceActionError) => {
                const message = voiceActionError instanceof Error ? voiceActionError.message : fallbackMessage;
                pushToast({ type: "error", message });
            });
        },
        [pushToast],
    );

    const joinVoiceFromDock = useCallback((): void => {
        if (!voiceSessionRoomId || voiceSessionStatus !== "disconnected") {
            return;
        }

        runVoiceRoomAction((voiceRoom) => voiceRoom.join(), "Unable to join voice channel.");
    }, [runVoiceRoomAction, voiceSessionRoomId, voiceSessionStatus]);

    const leaveVoiceFromDock = useCallback((): void => {
        if (!voiceSessionRoomId || voiceSessionStatus === "disconnected") {
            return;
        }

        runVoiceRoomAction((voiceRoom) => voiceRoom.leave(), "Unable to leave voice channel.");
    }, [runVoiceRoomAction, voiceSessionRoomId, voiceSessionStatus]);

    const toggleVoiceMicFromDock = useCallback((): void => {
        if (!voiceSessionRoomId || voiceSessionStatus !== "connected") {
            return;
        }

        runVoiceRoomAction((voiceRoom) => voiceRoom.toggleMute(), "Unable to update microphone state.");
    }, [runVoiceRoomAction, voiceSessionRoomId, voiceSessionStatus]);

    const toggleVoiceAudioFromDock = useCallback((): void => {
        if (!voiceSessionRoomId || voiceSessionStatus !== "connected") {
            return;
        }

        runVoiceRoomAction((voiceRoom) => voiceRoom.toggleAudioMute(), "Unable to update audio output state.");
    }, [runVoiceRoomAction, voiceSessionRoomId, voiceSessionStatus]);

    const selectSidebarMode = useCallback(
        (mode: RightSidebarMode): void => {
            clearSelectedUser();
            setRightSidebarMode(mode);
        },
        [clearSelectedUser],
    );

    const selectChannel = useCallback(
        (roomId: string): void => {
            setPendingFocusRoomId(null);
            openRoomAtBottom(roomId);
            const room = roomById.get(roomId) ?? client.getRoom(roomId);
            if (!room || !isRoomVoiceChannel(room)) {
                return;
            }

            const sameVoiceSessionRoom = voiceSessionRoomId === roomId;
            if (sameVoiceSessionRoom && (voiceSessionStatus === "connected" || voiceSessionStatus === "joining")) {
                return;
            }

            setVoiceSessionRoomId(roomId);
            setVoiceSessionStatus("joining");
            setVoiceAutoJoinNonce((value) => value + 1);
        },
        [client, isRoomVoiceChannel, openRoomAtBottom, roomById, voiceSessionRoomId, voiceSessionStatus],
    );

    const focusRoom = useCallback(
        (roomId: string): void => {
            const room = client.getRoom(roomId);
            if (!room) {
                setPendingFocusRoomId(roomId);
                setSelectedSpaceId(PEOPLE_SPACE_ID);
                return;
            }

            if (room.isSpaceRoom()) {
                setSelectedSpaceId(room.roomId);
                setActiveRoomId(null);
                setPendingFocusRoomId(null);
                return;
            }

            if (directRoomIds.has(roomId)) {
                setSelectedSpaceId(PEOPLE_SPACE_ID);
            } else {
                const parentSpaceId = findParentSpaceIdForRoom(roomId, spaces);
                if (parentSpaceId) {
                    setSelectedSpaceId(parentSpaceId);
                } else {
                    setSelectedSpaceId(PEOPLE_SPACE_ID);
                }
            }

            openRoomAtBottom(roomId);
            setPendingFocusRoomId(null);
        },
        [client, directRoomIds, openRoomAtBottom, spaces],
    );

    const requestJoinRoom = useCallback(
        async (target: string, options?: { viaServers?: string[]; preferredSpaceId?: string | null }): Promise<string> => {
            const joinedRoom = await joinRoomWithRetry(client, target, { viaServers: options?.viaServers });

            if (joinedRoom.isSpaceRoom()) {
                setSelectedSpaceId(joinedRoom.roomId);
                setActiveRoomId(null);
                setPendingFocusRoomId(null);
                setRooms([...client.getRooms()]);
                return joinedRoom.roomId;
            }

            let joinedParentSpaceId: string | null = null;
            if (!directRoomIds.has(joinedRoom.roomId)) {
                joinedParentSpaceId = await ensureRoomParentSpacesJoined(client, joinedRoom, options?.preferredSpaceId ?? null);
            }
            setRooms([...client.getRooms()]);

            if (directRoomIds.has(joinedRoom.roomId)) {
                setSelectedSpaceId(PEOPLE_SPACE_ID);
            } else {
                const parentSpaceId =
                    joinedParentSpaceId ??
                    findParentSpaceIdForRoom(joinedRoom.roomId, spaces) ??
                    options?.preferredSpaceId ??
                    null;
                if (parentSpaceId) {
                    setSelectedSpaceId(parentSpaceId);
                } else {
                    setSelectedSpaceId(PEOPLE_SPACE_ID);
                }
            }

            openRoomAtBottom(joinedRoom.roomId);
            setPendingFocusRoomId(null);

            if (options?.preferredSpaceId && options.preferredSpaceId === selectedSpaceId) {
                setSelectedSpaceHierarchyJoinedRoomIds((current) =>
                    current.includes(joinedRoom.roomId) ? current : [...current, joinedRoom.roomId],
                );
                setDiscoverableSpaceChannels((current) =>
                    current.filter((channel) => channel.roomId !== joinedRoom.roomId),
                );
            }

            return joinedRoom.roomId;
        },
        [client, directRoomIds, openRoomAtBottom, selectedSpaceId, spaces],
    );

    const joinDiscoverableSpaceChannel = useCallback(
        async (roomId: string): Promise<void> => {
            if (joiningDiscoverableRoomId) {
                return;
            }

            const targetChannel = listedChannelsById.get(roomId);
            if (!targetChannel) {
                return;
            }

            setJoiningDiscoverableRoomId(roomId);
            try {
                const viaServers = targetChannel.viaServers?.filter((via) => via.length > 0) ?? [];
                await requestJoinRoom(roomId, {
                    viaServers,
                    preferredSpaceId: selectedSpaceId === PEOPLE_SPACE_ID ? null : selectedSpaceId,
                });
                pushToast({ type: "success", message: "Joined channel." });
            } catch (joinError) {
                pushToast({ type: "error", message: describeJoinError(joinError, roomId) });
            } finally {
                setJoiningDiscoverableRoomId(null);
            }
        },
        [joiningDiscoverableRoomId, listedChannelsById, pushToast, requestJoinRoom, selectedSpaceId],
    );

    const knockDiscoverableSpaceChannel = useCallback(
        async (roomId: string): Promise<void> => {
            if (joiningDiscoverableRoomId) {
                return;
            }

            const targetChannel = listedChannelsById.get(roomId);
            if (!targetChannel) {
                return;
            }

            setJoiningDiscoverableRoomId(roomId);
            try {
                await client.knockRoom(roomId, {
                    viaServers: targetChannel.viaServers?.filter((via) => via.length > 0) ?? [],
                });
                pushToast({
                    type: "success",
                    message: "Join request sent. You will be let in if a moderator approves.",
                });
            } catch (knockError) {
                pushToast({ type: "error", message: describeJoinError(knockError, roomId) });
            } finally {
                setJoiningDiscoverableRoomId(null);
            }
        },
        [client, joiningDiscoverableRoomId, listedChannelsById, pushToast],
    );

    useEffect(() => {
        if (!activeRoomId) {
            return;
        }

        const activeRoomCandidate = client.getRoom(activeRoomId);
        if (!activeRoomCandidate || activeRoomCandidate.isSpaceRoom()) {
            return;
        }
        if (!directRoomIds.has(activeRoomCandidate.roomId)) {
            return;
        }

        const membership = activeRoomCandidate.getMyMembership();
        if (membership === "join") {
            autoJoiningDirectRoomIdsRef.current.delete(activeRoomCandidate.roomId);
            return;
        }
        if (membership !== "invite" && membership !== "knock") {
            return;
        }
        if (autoJoiningDirectRoomIdsRef.current.has(activeRoomCandidate.roomId)) {
            return;
        }

        autoJoiningDirectRoomIdsRef.current.add(activeRoomCandidate.roomId);
        void requestJoinRoom(activeRoomCandidate.roomId, { preferredSpaceId: null })
            .catch((joinError) => {
                pushToast({
                    type: "error",
                    message: describeJoinError(joinError, activeRoomCandidate.roomId),
                });
            })
            .finally(() => {
                autoJoiningDirectRoomIdsRef.current.delete(activeRoomCandidate.roomId);
            });
    }, [activeRoomId, client, directRoomIds, pushToast, requestJoinRoom]);

    useEffect(() => {
        if (!pendingFocusRoomId) {
            return;
        }

        const room = client.getRoom(pendingFocusRoomId);
        if (!room || room.isSpaceRoom()) {
            return;
        }

        if (directRoomIds.has(pendingFocusRoomId)) {
            setSelectedSpaceId(PEOPLE_SPACE_ID);
        } else {
            const parentSpaceId = findParentSpaceIdForRoom(pendingFocusRoomId, spaces);
            if (parentSpaceId) {
                setSelectedSpaceId(parentSpaceId);
            } else {
                setSelectedSpaceId(PEOPLE_SPACE_ID);
            }
        }

        openRoomAtBottom(pendingFocusRoomId);
        setPendingFocusRoomId(null);
    }, [client, directRoomIds, openRoomAtBottom, pendingFocusRoomId, spaces]);

    const leaveActiveRoom = useCallback(async (): Promise<void> => {
        if (!activeRoom) {
            return;
        }

        const roomLabel = getRoomName(activeRoom);
        if (!window.confirm(`Leave "${roomLabel}"?`)) {
            return;
        }

        try {
            await client.leave(activeRoom.roomId);
            setReplyToEvent(null);
            setEditingEvent(null);
            setInviteOpen(false);
            setRoomSettingsRoomId(null);
            setRoomModerationOpen(false);
            pushToast({ type: "success", message: `Left ${roomLabel}.` });
        } catch (leaveError) {
            const message = leaveError instanceof Error ? leaveError.message : "Failed to leave room.";
            pushToast({ type: "error", message });
        }
    }, [activeRoom, client, pushToast]);

    const openRoomSettingsFor = useCallback(
        (roomId: string | null): void => {
            if (!roomId) {
                return;
            }

            setRoomSettingsRoomId(roomId);
        },
        [],
    );

    const openUserSettings = useCallback((tab = "my-account"): void => {
        setSettingsState({
            mode: "user",
            tab,
        });
    }, []);

    const openServerSettings = useCallback((tab = "overview"): void => {
        if (!selectedSpaceRoom) {
            return;
        }

        setSettingsState({
            mode: "server",
            tab,
        });
    }, [selectedSpaceRoom]);

    const openCreateRoomDialog = useCallback((parentSpaceId: string | null): void => {
        setCreateRoomParentSpaceId(parentSpaceId);
        setCreateRoomOpen(true);
    }, []);

    const openInviteDialogFor = useCallback((roomId: string | null): void => {
        if (!roomId) {
            return;
        }
        setInviteTargetRoomId(roomId);
        setInviteOpen(true);
    }, []);

    // Do not reserve sidebar space until a room is selected.  The empty-state
    // panel used to leave a fixed 280px black column beside the chat view.
    const shouldRenderRightPanel = Boolean(activeRoom && !activeRoom.isSpaceRoom())
        && (panelMode.mode === "user" || rightSidebarMode !== "closed");

    const [channelsPaneWidth, setChannelsPaneWidth] = useState<number>(readChannelsPaneWidth);
    const [isResizingPane, setIsResizingPane] = useState(false);

    const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = channelsPaneWidth;
        setIsResizingPane(true);

        const onMove = (ev: PointerEvent): void => {
            const next = Math.min(CHANNELS_PANE_MAX, Math.max(CHANNELS_PANE_MIN, startWidth + ev.clientX - startX));
            setChannelsPaneWidth(next);
        };
        const onUp = (ev: PointerEvent): void => {
            const final = Math.min(CHANNELS_PANE_MAX, Math.max(CHANNELS_PANE_MIN, startWidth + ev.clientX - startX));
            setChannelsPaneWidth(final);
            try { window.localStorage.setItem(CHANNELS_PANE_WIDTH_KEY, String(Math.round(final))); } catch { /* ignore */ }
            setIsResizingPane(false);
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    }, [channelsPaneWidth]);

    const appShellStyle = useMemo(() => ({
        gridTemplateColumns: shouldRenderRightPanel
            ? `72px ${channelsPaneWidth}px minmax(0, 1fr) 280px`
            : `72px ${channelsPaneWidth}px minmax(0, 1fr)`,
    }), [channelsPaneWidth, shouldRenderRightPanel]);

    const appShellClassName = useMemo(() => {
        const classes = ["app-shell"];
        if (userSettings.appearance.compactMode) {
            classes.push("is-compact");
        }
        if (!userSettings.appearance.showTimestamps) {
            classes.push("hide-timestamps");
        }
        if (!shouldRenderRightPanel) {
            classes.push("right-panel-collapsed");
        }
        if (isResizingPane) {
            classes.push("is-resizing");
        }
        if (typeof window !== "undefined" && window.heorotDesktop) {
            classes.push("is-desktop-runtime");
            if (window.heorotDesktop.platform === "win32") {
                classes.push("is-desktop-win32");
            }
        }
        return classes.join(" ");
    }, [shouldRenderRightPanel, isResizingPane, userSettings.appearance.compactMode, userSettings.appearance.showTimestamps]);

    const hasOpenDialog = Boolean(
        emojiUploadOpen ||
            createDirectChatOpen ||
            createRoomOpen ||
            createSpaceOpen ||
            importJsonOpen ||
            joinRoomOpen ||
            inviteOpen ||
            roomSettingsRoomId ||
            roomModerationOpen ||
            settingsState,
    );

    useElementLikeNotifications({
        client,
        activeRoomId,
        hasOpenDialog,
        settings: userSettings.notifications,
    });

    return (
        <div className={appShellClassName} style={appShellStyle}>
            <aside className="left-rail">
                <img className="rail-logo" src="/branding/jorvik-logo-848bff6b.webp" width="46" height="46" alt="Jorvik" />
                <button
                    type="button"
                    className={`rail-icon rail-people${selectedSpaceId === PEOPLE_SPACE_ID ? " is-active" : ""}`}
                    onClick={() => setSelectedSpaceId(PEOPLE_SPACE_ID)}
                    title="People"
                >
                    @
                </button>
                {spaces.map((space) => {
                    const avatarUrl = thumbnailFromMxc(client, space.getMxcAvatarUrl(), 48, 48);
                    return (
                        <button
                            type="button"
                            key={space.roomId}
                            className={`rail-icon${selectedSpaceId === space.roomId ? " is-active" : ""}`}
                            onClick={() => setSelectedSpaceId(space.roomId)}
                            title={getRoomName(space)}
                        >
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className="rail-icon-avatar" />
                            ) : (
                                getSpaceGlyph(getRoomName(space))
                            )}
                        </button>
                    );
                })}
                <button
                    type="button"
                    className="rail-icon rail-create-space"
                    onClick={() => setCreateSpaceOpen(true)}
                    title="Create Space"
                    disabled={client.isGuest()}
                >
                    +
                </button>
            </aside>

            <section className="channels-pane">
                <div className="channels-pane-resize-handle" onPointerDown={handleResizePointerDown} />
                <div className="pane-top pane-top-row">
                    <span>{selectedSpaceName}</span>
                    <div className="pane-top-actions">
                        {selectedSpaceId === PEOPLE_SPACE_ID ? (
                            <button
                                type="button"
                                className="pane-top-action"
                                onClick={() => setCreateDirectChatOpen(true)}
                                title="Start direct chat"
                            >
                                New DM
                            </button>
                        ) : null}
                        {selectedSpaceRoom ? (
                            <button
                                type="button"
                                className="pane-top-action"
                                onClick={() => openServerSettings("overview")}
                                title="Open server settings"
                            >
                                Server
                            </button>
                        ) : null}
                    </div>
                </div>
                {showSpaceOnboarding ? (
                    <div className="space-onboarding-card">
                        <div className="space-onboarding-header">
                            <h3 className="space-onboarding-title">Space is ready</h3>
                            <button
                                type="button"
                                className="space-onboarding-dismiss"
                                aria-label="Dismiss onboarding"
                                onClick={() => setSpaceOnboardingSpaceId(null)}
                            >
                                x
                            </button>
                        </div>
                        <p className="space-onboarding-text">Create your first channel or configure the server.</p>
                        <div className="space-onboarding-actions">
                            <button
                                type="button"
                                className="room-dialog-button room-dialog-button-primary"
                                onClick={() => openCreateRoomDialog(selectedSpaceRoom?.roomId ?? null)}
                            >
                                Create channel
                            </button>
                            <button
                                type="button"
                                className="room-dialog-button room-dialog-button-secondary"
                                onClick={() => openServerSettings("overview")}
                            >
                                Open server settings
                            </button>
                            <button
                                type="button"
                                className="room-dialog-button room-dialog-button-secondary"
                                onClick={() => openInviteDialogFor(selectedSpaceRoom?.roomId ?? null)}
                            >
                                Invite members
                            </button>
                        </div>
                    </div>
                ) : null}
                <RoomList
                    client={client}
                    spaceId={selectedSpaceId}
                    rooms={channels}
                    voiceChannelHintRoomIds={voiceChannelHintRoomIds}
                    voiceDiscoveryReady={voiceDiscoveryReady}
                    showRoomAvatars={selectedSpaceId === PEOPLE_SPACE_ID || userSettings.appearance.showSpaceChannelAvatars}
                    discoverableRooms={selectedSpaceId === PEOPLE_SPACE_ID ? [] : discoverableSpaceChannels}
                    discoverableJoiningRoomId={joiningDiscoverableRoomId}
                    contentsPending={selectedSpaceId === PEOPLE_SPACE_ID ? false : spaceContentsPending}
                    activeRoomId={activeRoomId}
                    orderingMode={selectedSpaceId === PEOPLE_SPACE_ID ? "dynamic" : "manual"}
                    showOrderingControls={selectedSpaceId !== PEOPLE_SPACE_ID}
                    showHashPrefix={selectedSpaceId !== PEOPLE_SPACE_ID}
                    onSelectRoom={selectChannel}
                    onJoinDiscoverableRoom={(roomId) => {
                        void joinDiscoverableSpaceChannel(roomId);
                    }}
                    onKnockDiscoverableRoom={(roomId) => {
                        void knockDiscoverableSpaceChannel(roomId);
                    }}
                    subspaceGroups={selectedSpaceId === PEOPLE_SPACE_ID ? [] : subspaceGroupViews}
                    onToggleSubspace={handleToggleSubspace}
                    contentsTruncated={selectedSpaceId === PEOPLE_SPACE_ID ? false : spaceContentsTruncated}
                    localVoiceSession={
                        voiceSessionRoomId
                            ? {
                                  roomId: voiceSessionRoomId,
                                  status: voiceSessionStatus,
                                  userId: ownUserId || null,
                                  displayName: ownDisplayName,
                                  avatarMxc: ownAvatarMxc || null,
                                  micMuted: voiceSessionStatus === "connected" ? voiceControlState.micMuted : false,
                                  audioMuted: voiceSessionStatus === "connected" ? voiceControlState.audioMuted : false,
                              }
                            : null
                    }
                    liveSpeakingByRoomId={voiceSpeakingByRoomId}
                    liveScreenShareByRoomId={voiceScreenShareByRoomId}
                    liveParticipantsByRoomId={voiceParticipantsByRoomId}
                    liveParticipantsOverrideRoomId={liveVoiceParticipantsOverrideRoomId}
                    onOpenRoomSettings={openRoomSettingsFor}
                />
                <div className="pane-bottom">
                    {hasActiveVoiceSession && voiceSessionRoomId ? (
                        <div
                            className={`pane-voice-dock${
                                voiceSessionStatus === "connected"
                                    ? " is-connected"
                                    : voiceSessionStatus === "joining"
                                      ? " is-connecting"
                                      : ""
                            }`}
                        >
                            <button
                                type="button"
                                className="pane-voice-pill"
                                onClick={() => openRoomAtBottom(voiceSessionRoomId)}
                                title="Open voice channel"
                            >
                                <span className="pane-voice-pill-title">
                                    Voice: {activeVoiceSessionRoom ? getRoomName(activeVoiceSessionRoom) : "Voice channel"}
                                </span>
                                <span className="pane-voice-pill-subtitle">
                                    {voiceSessionStatus === "joining"
                                        ? "Connecting..."
                                        : voiceSessionStatus === "connected"
                                          ? "Connected"
                                          : "Not connected"}
                                </span>
                            </button>
                            <div className="pane-voice-controls">
                                {voiceSessionStatus === "disconnected" ? (
                                    <button
                                        type="button"
                                        className="pane-voice-control pane-voice-control-join"
                                        onClick={joinVoiceFromDock}
                                    >
                                        Join
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="pane-voice-control pane-voice-control-leave"
                                        onClick={leaveVoiceFromDock}
                                    >
                                        {voiceSessionStatus === "joining" ? "Cancel" : "Leave"}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className={`pane-voice-control${voiceControlState.micMuted ? " is-muted" : ""}`}
                                    onClick={toggleVoiceMicFromDock}
                                    aria-pressed={!voiceControlState.micMuted}
                                    disabled={voiceSessionStatus !== "connected"}
                                >
                                    {voiceControlState.micMuted ? "Unmute mic" : "Mute mic"}
                                </button>
                                <button
                                    type="button"
                                    className={`pane-voice-control${voiceControlState.audioMuted ? " is-muted" : ""}`}
                                    onClick={toggleVoiceAudioFromDock}
                                    aria-pressed={!voiceControlState.audioMuted}
                                    disabled={voiceSessionStatus !== "connected"}
                                >
                                    {voiceControlState.audioMuted ? "Unmute audio" : "Mute audio"}
                                </button>
                            </div>
                            <div className="pane-voice-indicators">
                                <span className={`pane-voice-indicator${voiceControlState.micMuted ? " is-muted" : " is-live"}`}>
                                    Mic {voiceControlState.micMuted ? "muted" : "live"}
                                </span>
                                <span className={`pane-voice-indicator${voiceControlState.audioMuted ? " is-muted" : " is-live"}`}>
                                    Audio {voiceControlState.audioMuted ? "muted" : "live"}
                                </span>
                            </div>
                        </div>
                    ) : null}
                    <div className="pane-user-row">
                        <button
                            type="button"
                            className="pane-user-card"
                            onClick={() => openUserSettings("my-account")}
                            title="Open user settings"
                        >
                            <Avatar
                                className="pane-user-avatar"
                                name={ownDisplayName}
                                src={ownAvatarSources[0] ?? null}
                                sources={ownAvatarSources}
                                seed={ownUserId || undefined}
                                userId={ownUserId || undefined}
                            />
                            <span className="pane-user-meta">
                                <span className="pane-user-name">{ownDisplayName}</span>
                                <span className="pane-user-id">
                                    {presenceControl.selection.statusMessage ||
                                        formatUserIdForDisplay(ownUserId, localDomain) ||
                                        "Unknown user"}
                                </span>
                            </span>
                        </button>
                        {presenceEnabled ? (
                            <div className="pane-status-anchor">
                                <button
                                    type="button"
                                    className="pane-status-button"
                                    aria-haspopup="menu"
                                    aria-expanded={statusMenuOpen}
                                    onClick={() => setStatusMenuOpen((open) => !open)}
                                    title="Set your status"
                                >
                                    <span
                                        className={`status-menu-dot is-${presenceControl.selection.choice}`}
                                        aria-hidden="true"
                                    />
                                </button>
                                {statusMenuOpen ? (
                                    <StatusMenu
                                        choice={presenceControl.selection.choice}
                                        statusMessage={presenceControl.selection.statusMessage}
                                        error={presenceControl.error}
                                        onChoose={presenceControl.setChoice}
                                        onStatusMessage={presenceControl.setStatusMessage}
                                        onClose={() => setStatusMenuOpen(false)}
                                    />
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>
            </section>

            <section className="main-pane">
                <ChannelHeader
                    room={activeRoom}
                    isDirectMessage={isActiveRoomDirect}
                    isOneToOneDirect={activeDirectPartnerId !== null}
                    showHashPrefix={shouldPrefixRoomWithHash}
                    sidebarMode={rightSidebarMode}
                    searchQuery={sidebarSearchQuery}
                    canInviteInRoom={canInviteInActiveRoom}
                    onSearchQueryChange={setSidebarSearchQuery}
                    onSelectSidebarMode={selectSidebarMode}
                    onOpenDirectChat={() => setCreateDirectChatOpen(true)}
                    onOpenCreateRoom={() =>
                        openCreateRoomDialog(selectedSpaceId === PEOPLE_SPACE_ID ? null : selectedSpaceRoom?.roomId ?? null)
                    }
                    onOpenJoinRoom={() => setJoinRoomOpen(true)}
                    onOpenInviteUsers={() => openInviteDialogFor(activeRoom?.roomId ?? null)}
                    onOpenRoomSettings={() => openRoomSettingsFor(activeRoom?.roomId ?? null)}
                    onOpenModeration={() => setRoomModerationOpen(true)}
                    onCopyRoomLink={copyActiveRoomLink}
                    onLeaveRoom={leaveActiveRoom}
                />
                {hasActiveVoiceSession && voiceSessionRoomId ? (
                    <div
                        className={`main-voice-slot${shouldShowVoicePanel ? "" : " voice-room-hidden"}`}
                        aria-hidden={!shouldShowVoicePanel}
                    >
                        <VoiceRoom
                            ref={voiceRoomRef}
                            client={client}
                            matrixRoomId={voiceSessionRoomId}
                            matrixRoom={
                                activeRoom?.roomId === voiceSessionRoomId ? activeRoom : client.getRoom(voiceSessionRoomId) ?? undefined
                            }
                            audioSettings={userSettings.audio}
                            autoJoinNonce={voiceAutoJoinNonce}
                            onAudioSettingsChange={(audio) =>
                                setUserSettings({
                                    ...userSettings,
                                    audio,
                                })
                            }
                            onSessionStateChange={(state) => {
                                setVoiceSessionRoomId(state.roomId);
                                setVoiceSessionStatus(state.status);
                                if (state.status === "joining") {
                                    setVoiceParticipantsByRoomId((current) => {
                                        const next = new Map(current);
                                        next.set(state.roomId, new Set<string>());
                                        return next;
                                    });
                                }
                            }}
                            onControlsStateChange={setVoiceControlState}
                            onLiveParticipantsChange={handleLiveParticipantsChange}
                        />
                    </div>
                ) : null}
                {!shouldShowVoicePanel ? (
                    <div className="main-chat-stack">
                        <Timeline
                            client={client}
                            room={activeRoom}
                            focusBottomNonce={timelineFocusBottomNonce}
                            replyToEventId={replyToEvent?.getId() ?? null}
                            onReply={(event) => {
                                setEditingEvent(null);
                                setReplyToEvent(event);
                            }}
                            onEdit={(event) => {
                                setReplyToEvent(null);
                                setEditingEvent(event);
                            }}
                            onSelectUser={selectUser}
                            activeSpaceId={selectedSpaceId === PEOPLE_SPACE_ID ? null : selectedSpaceId}
                            customReactionImagesEnabled={renderReactionImages}
                            showReadReceipts={shouldShowReadReceipts}
                        />
                        <div className="main-chat-composer">
                            <Composer
                                client={client}
                                room={activeRoom}
                                activeSpaceId={selectedSpaceId === PEOPLE_SPACE_ID ? null : selectedSpaceId}
                                editingEvent={editingEvent}
                                onCancelEdit={() => setEditingEvent(null)}
                                replyToEvent={replyToEvent}
                                onCancelReply={() => setReplyToEvent(null)}
                            />
                        </div>
                    </div>
                ) : null}
            </section>

            {shouldRenderRightPanel ? (
                <RightPanel
                    client={client}
                    room={activeRoom}
                    activeSpaceRoom={selectedSpaceId === PEOPLE_SPACE_ID ? null : selectedSpaceRoom}
                    mode={panelMode}
                    roomMode={rightSidebarMode}
                    directPartnerId={activeDirectPartnerId}
                    searchQuery={sidebarSearchQuery}
                    onSearchQueryChange={setSidebarSearchQuery}
                    onSelectUser={selectUser}
                    onBackToRoom={clearSelectedUser}
                    onCloseRoomPanel={() => selectSidebarMode("closed")}
                    onOpenRoomSettings={() => openRoomSettingsFor(activeRoom?.roomId ?? null)}
                    onCopyRoomLink={copyActiveRoomLink}
                    onLeaveRoom={leaveActiveRoom}
                    onOpenRoom={focusRoom}
                    onToast={pushToast}
                />
            ) : null}
            {emojiUploadOpen && emojiUploadTarget ? (
                <EmojiUploadDialog
                    client={client}
                    target={emojiUploadTarget}
                    open={emojiUploadOpen}
                    onClose={() => {
                        setEmojiUploadOpen(false);
                        setEmojiUploadTarget(null);
                    }}
                />
            ) : null}
            <CreateDirectChatDialog
                client={client}
                open={createDirectChatOpen}
                onClose={() => setCreateDirectChatOpen(false)}
                onResolved={({ roomId, created, isGroup, targetCount }) => {
                    setCreateDirectChatOpen(false);
                    focusRoom(roomId);
                    pushToast({
                        type: "success",
                        message: isGroup
                            ? created
                                ? `Group chat created (${targetCount} people).`
                                : "Group chat opened."
                            : created
                                ? "Direct message created."
                                : "Direct message opened.",
                    });
                }}
            />
            <CreateRoomDialog
                client={client}
                open={createRoomOpen}
                spaceParentId={createRoomParentSpaceId}
                onClose={() => {
                    setCreateRoomOpen(false);
                    setCreateRoomParentSpaceId(null);
                }}
                onCreated={(roomId) => {
                    setCreateRoomOpen(false);
                    const createdInSpaceId = createRoomParentSpaceId;
                    setCreateRoomParentSpaceId(null);
                    focusRoom(roomId);
                    if (createdInSpaceId && createdInSpaceId === spaceOnboardingSpaceId) {
                        setSpaceOnboardingSpaceId(null);
                    }
                    pushToast({
                        type: "success",
                        message: createdInSpaceId ? "Channel created in Space." : "Room created.",
                    });
                }}
            />
            <CreateSpaceDialog
                client={client}
                open={createSpaceOpen}
                onClose={() => setCreateSpaceOpen(false)}
                onCreated={(roomId) => {
                    setCreateSpaceOpen(false);
                    focusRoom(roomId);
                    setSpaceOnboardingSpaceId(roomId);
                    pushToast({ type: "success", message: "Space created." });
                }}
                onJoinPublicSpaceRequest={(target) => requestJoinRoom(target)}
                onJoined={() => {
                    setCreateSpaceOpen(false);
                    pushToast({ type: "success", message: "Joined public Space." });
                }}
                onImport={() => setImportJsonOpen(true)}
            />
            <JoinRoomDialog
                client={client}
                open={joinRoomOpen}
                onClose={() => setJoinRoomOpen(false)}
                onJoinRequest={(target) => requestJoinRoom(target)}
                onJoined={() => {
                    setJoinRoomOpen(false);
                    pushToast({ type: "success", message: "Joined room." });
                }}
            />
            <InviteDialog
                client={client}
                room={inviteTargetRoom}
                open={inviteOpen}
                onCompleted={({ invited, failed }) => {
                    if (invited.length > 0 && failed.length === 0) {
                        pushToast({
                            type: "success",
                            message: invited.length === 1 ? "User invited." : `${invited.length} users invited.`,
                        });
                        return;
                    }

                    if (invited.length > 0 && failed.length > 0) {
                        const firstFailure = failed[0];
                        pushToast({
                            type: "info",
                            message: `Invited ${invited.length}, failed ${failed.length} (${firstFailure.userId}: ${firstFailure.message}).`,
                        });
                    }
                }}
                onClose={() => {
                    setInviteOpen(false);
                    setInviteTargetRoomId(null);
                }}
            />
            <RoomSettingsDialog
                client={client}
                room={roomSettingsRoom}
                open={Boolean(roomSettingsRoomId)}
                onClose={() => setRoomSettingsRoomId(null)}
                onDeleted={(roomId) => {
                    if (activeRoomId === roomId) setActiveRoomId(null);
                    setRooms((current) => current.filter((candidate) => candidate.roomId !== roomId));
                }}
            />
            <RoomModerationDialog
                client={client}
                room={activeRoom}
                open={roomModerationOpen}
                onClose={() => setRoomModerationOpen(false)}
            />
            <SettingsOverlay
                open={Boolean(settingsState)}
                mode={settingsState?.mode ?? "user"}
                initialTab={settingsState?.tab ?? "my-account"}
                client={client}
                spaceRoom={settingsState?.mode === "server" ? selectedSpaceRoom : null}
                spaceChannels={channels}
                activeRoomId={activeRoomId}
                onSelectRoom={setActiveRoomId}
                onOpenEmojiUpload={(target) => {
                    setEmojiUploadTarget(target);
                    setEmojiUploadOpen(true);
                }}
                onOpenCreateRoomInSpace={(spaceId) => {
                    setSettingsState(null);
                    openCreateRoomDialog(spaceId);
                }}
                onRefreshSpaceChannels={reloadSpaceChannelsFromServer}
                onClose={() => setSettingsState(null)}
                onLeftSpace={(spaceId) => {
                    if (selectedSpaceId === spaceId) {
                        setSelectedSpaceId(PEOPLE_SPACE_ID);
                    }
                    setSettingsState(null);
                }}
                onLogout={onLogout}
                userSettings={userSettings}
                onUserSettingsChange={handleUserSettingsChange}
                renderReactionImages={renderReactionImages}
                onToggleRenderReactionImages={setRenderReactionImages}
                onToast={pushToast}
            />
            <ImportJsonWizard
                client={client}
                open={importJsonOpen}
                onClose={() => setImportJsonOpen(false)}
                onImported={(spaceId) => {
                    setImportJsonOpen(false);
                    focusRoom(spaceId);
                    pushToast({ type: "success", message: "Import completed." });
                }}
            />
            <Toast toast={toast} onClose={() => setToast(null)} />
        </div>
    );
}
