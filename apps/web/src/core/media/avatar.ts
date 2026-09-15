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
    const mxc = member?.getMxcAvatarUrl();

    // TEMPORARY DIAGNOSTIC - remove with the rest of avatar-trace.
    // The member event and the global profile are separate sources and can
    // disagree; this records both so the four surfaces can be compared.
    if (member?.userId) {
        const profileMxc = client.getUser(member.userId)?.avatarUrl ?? null;
        console.log(
            `[avatar-trace] member user=${member.userId} size=${size}` +
                ` memberMxc=${mxc ?? "NONE"} profileMxc=${profileMxc ?? "NONE"}` +
                ` agree=${(mxc ?? null) === profileMxc}`,
        );
    }

    if (!mxc) {
        return [];
    }

    return uniqueUrls([
        thumbnailFromMxc(client, mxc, size, size, resizeMethod),
        mediaFromMxc(client, mxc),
    ]);
}

export function roomAvatarSources(
    client: MatrixClient,
    room: Room,
    size: number,
    includeFallbackMember = true,
): string[] {
    const roomAvatarMxc = room.getMxcAvatarUrl();
    const fallbackMember = includeFallbackMember
        ? (room as Room & {
              getAvatarFallbackMember?: () => RoomMember | undefined;
          }).getAvatarFallbackMember?.()
        : undefined;

    // TEMPORARY DIAGNOSTIC - remove with the rest of avatar-trace.
    console.log(
        `[avatar-trace] room room=${room.roomId} size=${size}` +
            ` roomMxc=${roomAvatarMxc ?? "NONE"}` +
            ` fallbackMember=${fallbackMember?.userId ?? "NONE"}` +
            ` fallbackMxc=${fallbackMember?.getMxcAvatarUrl() ?? "NONE"}` +
            ` memberFallbackAllowed=${includeFallbackMember}`,
    );

    const fallbackMxc = fallbackMember?.getMxcAvatarUrl();

    return uniqueUrls([
        thumbnailFromMxc(client, roomAvatarMxc, size, size, "crop"),
        mediaFromMxc(client, roomAvatarMxc),
        thumbnailFromMxc(client, fallbackMxc, size, size, "crop"),
        mediaFromMxc(client, fallbackMxc),
    ]);
}
