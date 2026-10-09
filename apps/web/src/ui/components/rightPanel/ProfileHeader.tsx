import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "../Avatar";
import { UserBadges } from "../badges/UserBadges";
import type { PresenceVm } from "../../presence/buildPresenceVm";
import { toAvatarPresenceState } from "../../presence/buildPresenceVm";
import { PresenceText } from "../presence/PresenceText";

import { formatUserIdForDisplay } from "../../../core/users/formatUserId";

interface ProfileHeaderProps {
    displayName: string;
    userId: string;
    localDomain?: string | null;
    avatarSources: string[];
    presence: PresenceVm | null;
    onBack: () => void;
    onCopyMxid: () => Promise<void>;
    onCopyUserId: () => Promise<void>;
    onMessage?: () => Promise<void>;
    onCall?: () => void;
    onAdd?: () => void;
    // Only for the server's badge managers.
    onEditBadges?: () => void;
}

/** The left edge of the nearest ancestor that clips what sticks out of it, or of the window. */
function clippingLeftEdge(element: HTMLElement): number {
    for (let node = element.parentElement; node; node = node.parentElement) {
        if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(node).overflowX)) {
            return node.getBoundingClientRect().left;
        }
    }
    return 0;
}

function hashToHue(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % 360;
}

export function ProfileHeader({
    displayName,
    userId,
    localDomain,
    avatarSources,
    presence,
    onBack,
    onCopyMxid,
    onCopyUserId,
    onMessage,
    onCall,
    onAdd,
    onEditBadges,
}: ProfileHeaderProps): React.ReactElement {
    const [menuOpen, setMenuOpen] = useState(false);
    // The menu hangs left from its button. In a narrow window the buttons wrap and the
    // button starts a row, so hanging left would put the menu past the panel's edge,
    // which clips it; then it hangs right instead. Measured before the menu is painted.
    const [menuHangsRight, setMenuHangsRight] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const menuPanelRef = useRef<HTMLDivElement | null>(null);
    const hue = useMemo(() => hashToHue(userId), [userId]);
    const bannerStyle = useMemo(
        () => ({
            background: `linear-gradient(135deg, hsl(${hue} 62% 42%), hsl(${(hue + 48) % 360} 55% 28%))`,
        }),
        [hue],
    );

    useLayoutEffect(() => {
        if (!menuOpen) {
            setMenuHangsRight(false);
            return;
        }
        const panel = menuPanelRef.current;
        if (panel && panel.getBoundingClientRect().left < clippingLeftEdge(panel)) {
            setMenuHangsRight(true);
        }
    }, [menuOpen]);

    useEffect(() => {
        if (!menuOpen) {
            return undefined;
        }

        const onMouseDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (!target || menuRef.current?.contains(target)) {
                return;
            }
            setMenuOpen(false);
        };

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                setMenuOpen(false);
            }
        };

        window.addEventListener("mousedown", onMouseDown);
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [menuOpen]);

    return (
        <header className="rp-profile-hero">
            <div className="rp-profile-banner" style={bannerStyle} />
            <button type="button" className="rp-profile-close" onClick={onBack} aria-label="Close profile">
                x
            </button>
            <Avatar
                className="rp-profile-avatar"
                name={displayName}
                src={avatarSources[0] ?? null}
                sources={avatarSources}
                seed={userId}
                userId={userId}
                presenceState={toAvatarPresenceState(presence)}
            />
            <div className="rp-profile-main">
                <h2 className="rp-profile-name">{displayName}</h2>
                <div className="rp-profile-mxid">{formatUserIdForDisplay(userId, localDomain)}</div>
                <UserBadges userId={userId} variant="chips" className="rp-profile-badges" />
                {presence ? <PresenceText presence={presence} className="rp-profile-presence" /> : null}
            </div>
            <div className="rp-profile-actions">
                {onMessage ? (
                    <button type="button" className="rp-icon-btn rp-icon-btn-primary" onClick={() => void onMessage()}>
                        Message
                    </button>
                ) : null}
                {onCall ? (
                    <button type="button" className="rp-icon-btn" onClick={onCall}>
                        Call
                    </button>
                ) : null}
                {onAdd ? (
                    <button type="button" className="rp-icon-btn" onClick={onAdd} title="Invite to a space or channel">
                        Add
                    </button>
                ) : null}
                <div className="rp-profile-menu" ref={menuRef}>
                    <button
                        type="button"
                        className="rp-icon-btn"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        ...
                    </button>
                    {menuOpen ? (
                        <div
                            ref={menuPanelRef}
                            className={`rp-profile-menu-panel${menuHangsRight ? " is-hanging-right" : ""}`}
                            role="menu"
                        >
                            <button
                                type="button"
                                className="rp-profile-menu-item"
                                role="menuitem"
                                onClick={() => {
                                    void onCopyMxid();
                                    setMenuOpen(false);
                                }}
                            >
                                Copy MXID
                            </button>
                            <button
                                type="button"
                                className="rp-profile-menu-item"
                                role="menuitem"
                                onClick={() => {
                                    void onCopyUserId();
                                    setMenuOpen(false);
                                }}
                            >
                                Copy user ID
                            </button>
                            {onEditBadges ? (
                                <button
                                    type="button"
                                    className="rp-profile-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        onEditBadges();
                                        setMenuOpen(false);
                                    }}
                                >
                                    Badges
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </header>
    );
}
