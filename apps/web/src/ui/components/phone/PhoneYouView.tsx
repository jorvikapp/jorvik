import React, { useState } from "react";

import { PRESENCE_CHOICES } from "../../../core/presence/presenceControl";
import type { PresenceSelectionController } from "../../presence/usePresenceSelection";
import { useAppVersion } from "../../version/useAppVersion";
import { Avatar } from "../Avatar";
import { StatusMenu } from "../presence/StatusMenu";
import { BottomSheet } from "./BottomSheet";

interface PhoneYouViewProps {
    ownUserId: string;
    displayName: string;
    userIdLabel: string;
    avatarSources: string[];
    presenceEnabled: boolean;
    presence: PresenceSelectionController;
    onOpenSettings: (tab: string) => void;
}

// The user settings tabs, in the order Settings lists them. Keyboard shortcuts are left out:
// a phone has no keyboard for them.
const SETTINGS_ROWS: { tab: string; label: string; danger?: boolean }[] = [
    { tab: "my-account", label: "My Account" },
    { tab: "profile", label: "Profile" },
    { tab: "emoji", label: "Emoji" },
    { tab: "privacy", label: "Privacy & Safety" },
    { tab: "appearance", label: "Appearance" },
    { tab: "notifications", label: "Notifications" },
    { tab: "audio", label: "Voice and video" },
    { tab: "devices", label: "Devices" },
    { tab: "encryption", label: "Encryption & Recovery" },
];

export function PhoneYouView({
    ownUserId,
    displayName,
    userIdLabel,
    avatarSources,
    presenceEnabled,
    presence,
    onOpenSettings,
}: PhoneYouViewProps): React.ReactElement {
    const [statusOpen, setStatusOpen] = useState(false);
    const version = useAppVersion();
    const choice = presence.effectiveChoice;
    const choiceLabel = PRESENCE_CHOICES.find((entry) => entry.choice === presence.selection.choice)?.label ?? "Online";

    return (
        <section className="phone-page phone-you" aria-label="You">
            <div className="phone-page-body phone-you-body">
                <div className="phone-you-banner" aria-hidden="true" />
                <div className="phone-you-profile">
                    <span className="phone-you-avatar-wrap">
                        <Avatar
                            className="phone-you-avatar"
                            name={displayName}
                            src={avatarSources[0] ?? null}
                            sources={avatarSources}
                            seed={ownUserId || undefined}
                            userId={ownUserId || undefined}
                        />
                        {presenceEnabled ? (
                            <span className={`phone-you-presence status-menu-dot is-${choice}`} aria-hidden="true" />
                        ) : null}
                    </span>
                    <h2 className="phone-you-name">{displayName}</h2>
                    <p className="phone-you-id">{userIdLabel}</p>
                    {presence.selection.statusMessage ? (
                        <p className="phone-you-status-message">{presence.selection.statusMessage}</p>
                    ) : null}
                    <div className="phone-you-actions">
                        {presenceEnabled ? (
                            <button type="button" className="phone-button" onClick={() => setStatusOpen(true)}>
                                <span className={`status-menu-dot is-${presence.selection.choice}`} aria-hidden="true" />
                                {choiceLabel}
                            </button>
                        ) : null}
                        <button type="button" className="phone-button" onClick={() => onOpenSettings("profile")}>
                            Edit profile
                        </button>
                    </div>
                </div>

                <h3 className="phone-section-label">Settings</h3>
                <div className="sheet-group">
                    {SETTINGS_ROWS.map((row) => (
                        <button key={row.tab} type="button" className="sheet-item sheet-item-nav" onClick={() => onOpenSettings(row.tab)}>
                            {row.label}
                        </button>
                    ))}
                </div>
                <div className="sheet-group">
                    <button type="button" className="sheet-item sheet-item-danger" onClick={() => onOpenSettings("sign-out")}>
                        Sign out
                    </button>
                </div>
                <p className="phone-you-version">Jorvik {version.version}</p>
            </div>

            {presenceEnabled ? (
                <BottomSheet open={statusOpen} label="Set your status" onClose={() => setStatusOpen(false)} className="status-sheet">
                    <StatusMenu
                        choice={presence.selection.choice}
                        statusMessage={presence.selection.statusMessage}
                        error={presence.error}
                        onChoose={presence.setChoice}
                        onStatusMessage={presence.setStatusMessage}
                        onClose={() => setStatusOpen(false)}
                    />
                </BottomSheet>
            ) : null}
        </section>
    );
}
