import React from "react";

import { BADGE_LABELS, type BadgeId } from "../../../core/badges/userBadges";
import { useUserBadges } from "../../hooks/useUserBadges";

// Drawn on a 24px grid in currentColor, so CSS gives each badge its colour.
const BADGE_ICONS: Record<BadgeId, React.ReactElement> = {
    // A horned helmet: real Viking helmets had none, but without horns a
    // helmet this small reads as a bell.
    staff: (
        <>
            <path d="M6.4 11.6C3.7 11 2.1 8.7 2.3 4.5c1.1 2.5 2.7 3.8 5.4 4.6z" />
            <path d="M17.6 11.6c2.7-.6 4.3-2.9 4.1-7.1-1.1 2.5-2.7 3.8-5.4 4.6z" />
            <path d="M4.6 15.2a7.4 7.4 0 0 1 14.8 0z" />
            <rect x="3.8" y="15.9" width="16.4" height="2.4" rx="1.2" />
            <rect x="10.9" y="17.2" width="2.2" height="5.2" rx="1.1" />
        </>
    ),
    // A raven: Odin's ravens flew over the world and brought back news.
    bug_finder: (
        <>
            <path
                fillRule="evenodd"
                d="M22.6 7.4l-3.7-1.8c-.5-1.3-1.7-2-3-1.9-1.3.1-2.3 1-2.5 2.3-2.8.6-5 2.6-6.1 5.2l-.7 2L2 18.4l1.8.5 4.6-3.3c2.5 1 5.6.7 7.9-1 1.8-1.3 2.7-3.2 2.6-5l-.2-1.2zM16.3 5.3a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z"
            />
            <path d="M11.6 16l-.5 4.2M13.8 15.6l.2 4.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
    ),
    // A round shield, painted in quarters around its boss.
    tester: (
        <>
            <circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
            <path d="M4.8 12A7.2 7.2 0 0 1 12 4.8v3.6A3.6 3.6 0 0 0 8.4 12zM19.2 12a7.2 7.2 0 0 1-7.2 7.2v-3.6a3.6 3.6 0 0 0 3.6-3.6z" />
            <circle cx="12" cy="12" r="2.4" />
        </>
    ),
    // A smith's anvil, for the people who help build Jorvik.
    contributor: (
        <path d="M2 6h20v3h-5.5c-1.3.6-1.9 1.8-1.9 3.2v1l3 2.4v3H6.4v-3l3-2.4v-1c0-1.4-.6-2.6-1.8-3.2C5.4 8.8 3.4 7.8 2 6z" />
    ),
    // A drinking horn, raised to those who were here early.
    early_supporter: (
        <path
            fillRule="evenodd"
            d="M22 6.5c-.5 7-6 12.5-12.5 12.1-3-.2-5.5-2.2-7-5.6 2.5 2 5.5 2.4 8.1 1.6 3.2-1 5-5 4.9-11.1zm-6.7 1.2l6.2 2.8-.4 1.4-6-2.7z"
        />
    ),
};

export function BadgeIcon({ id }: { id: BadgeId }): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            {BADGE_ICONS[id]}
        </svg>
    );
}

interface UserBadgesProps {
    userId: string | null | undefined;
    // Icons fit next to a name; chips spell each badge out, for profiles.
    variant?: "icons" | "chips";
    className?: string;
}

export function UserBadges({ userId, variant = "icons", className }: UserBadgesProps): React.ReactElement | null {
    const badges = useUserBadges(userId);
    if (badges.length === 0) {
        return null;
    }

    const showLabels = variant === "chips";
    return (
        <span className={`user-badges user-badges-${variant}${className ? ` ${className}` : ""}`}>
            {badges.map((id) => (
                <span
                    key={id}
                    className={`user-badge user-badge-${id}`}
                    title={BADGE_LABELS[id]}
                    role={showLabels ? undefined : "img"}
                    aria-label={showLabels ? undefined : BADGE_LABELS[id]}
                >
                    <BadgeIcon id={id} />
                    {showLabels ? <span className="user-badge-label">{BADGE_LABELS[id]}</span> : null}
                </span>
            ))}
        </span>
    );
}
