import type {
    MatrixClient,
    ResizeMethod,
    Room,
    RoomMember,
} from "matrix-js-sdk/src/matrix";

import { mediaFromMxc, thumbnailFromMxc } from "./media";

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
    return Array.from(
        new Set(
            urls.filter((url): url is string => typeof url === "string" && url.length > 0),
        ),
    );
}

export function memberAvatarSources(
    client: MatrixClient,
    member: RoomMember | null | undefined,
    size: number,
    resizeMethod: ResizeMethod = "crop",
): string[] {
    // A member event carries its own avatar_url, which can lag behind or be
    // absent while the user's global profile has one - a profile change only
    // reaches a room as a new m.room.member event. Falling back to the profile
    // is what getReadReceiptUserMetadata already did, so without this the same
    // user could render their avatar on a read receipt and initials on their
    // messages, in the same conversation.
    const mxc = member?.getMxcAvatarUrl() ?? profileAvatarMxc(client, member?.userId);
    if (!mxc) {
        return [];
    }

    return uniqueUrls([
        thumbnailFromMxc(client, mxc, size, size, resizeMethod),
        mediaFromMxc(client, mxc),
    ]);
}

function profileAvatarMxc(client: MatrixClient, userId: string | undefined): string | undefined {
    if (!userId) {
        return undefined;
    }

    const avatarUrl = client.getUser(userId)?.avatarUrl;
    return typeof avatarUrl === "string" && avatarUrl.length > 0 ? avatarUrl : undefined;
}

export function roomAvatarSources(
    client: MatrixClient,
    room: Room,
    size: number,
    includeFallbackMember = true,
): string[] {
    const roomAvatarMxc = room.getMxcAvatarUrl();
    const fallbackMxc = includeFallbackMember
        ? (room as Room & {
              getAvatarFallbackMember?: () => RoomMember | undefined;
          }).getAvatarFallbackMember?.()?.getMxcAvatarUrl()
        : undefined;

    return uniqueUrls([
        thumbnailFromMxc(client, roomAvatarMxc, size, size, "crop"),
        mediaFromMxc(client, roomAvatarMxc),
        thumbnailFromMxc(client, fallbackMxc, size, size, "crop"),
        mediaFromMxc(client, fallbackMxc),
    ]);
}
