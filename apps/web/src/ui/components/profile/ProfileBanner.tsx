import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    profileImageMxcFrom,
    savedProfileImage,
    subscribeProfileImages,
    type ProfileImageField,
} from "../../../core/users/profileImages";
import { mediaFromMxc } from "../../adapters/media";

function hashToHue(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % 360;
}

/** The colours someone's banner has when they haven't picked a picture. */
export function bannerGradient(userId: string): string {
    const hue = hashToHue(userId);
    return `linear-gradient(135deg, hsl(${hue} 62% 42%), hsl(${(hue + 48) % 360} 55% 28%))`;
}

/**
 * Where one of someone's profile pictures (banner, nameplate) loads from, or null. Pass the profile when it's
 * already been fetched; without it the profile is fetched here. A picture saved in this session wins over both.
 */
export function useProfileImageSrc(
    client: MatrixClient | null | undefined,
    userId: string | null | undefined,
    field: ProfileImageField,
    profile?: Record<string, unknown> | null,
): string | null {
    const [fetched, setFetched] = useState<string | null>(null);
    const ownFetch = profile === undefined;
    useEffect(() => {
        setFetched(null);
        if (!ownFetch || !client || !userId) {
            return undefined;
        }
        let cancelled = false;
        client
            .getProfileInfo(userId)
            .then((info) => {
                if (!cancelled) {
                    setFetched(profileImageMxcFrom((info as Record<string, unknown>)[field]));
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [client, userId, field, ownFetch]);
    const saved = useSyncExternalStore(subscribeProfileImages, () => (userId ? savedProfileImage(userId, field) : undefined));
    const mxc = saved !== undefined ? saved : ownFetch ? fetched : profileImageMxcFrom(profile?.[field]);
    return useMemo(() => (client && mxc ? mediaFromMxc(client, mxc) : null), [client, mxc]);
}

/**
 * A strip with a picture in it when there is one (the full file, so a GIF moves), over the colours, which stay
 * when there's none or it doesn't load.
 */
export function ProfileBanner({
    className,
    src,
    background,
}: {
    className: string;
    src: string | null | undefined;
    /** The colours under the picture; without it the class's own background shows. */
    background?: string;
}): React.ReactElement {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    return (
        <div className={className} style={background ? { background } : undefined} aria-hidden="true">
            {src && !failed ? (
                <img className="profile-banner-image" src={src} alt="" draggable={false} onError={() => setFailed(true)} />
            ) : null}
        </div>
    );
}
