import React from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { ToastState } from "../../../components/Toast";
import { useIgnoredUsers } from "../../../moderation/useIgnoredUsers";
import { AUTO_IDLE_MINUTE_CHOICES, type PrivacySettings } from "../settingsStore";

interface PrivacyTabProps {
    client: MatrixClient;
    onToast: (toast: Omit<ToastState, "id">) => void;
    settings: PrivacySettings;
    onChange: (settings: PrivacySettings) => void;
}

export function PrivacyTab({ client, onToast, settings, onChange }: PrivacyTabProps): React.ReactElement {
    const ignoredUsers = useIgnoredUsers(client);

    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Privacy & Safety</h2>
            <p className="settings-tab-description">
                Local placeholder settings. Backend privacy rules are TODO.
            </p>

            <label className="settings-toggle">
                <input
                    type="checkbox"
                    checked={settings.showReadReceipts}
                    onChange={(event) => onChange({ ...settings, showReadReceipts: event.target.checked })}
                />
                Show read receipts (stub)
            </label>

            <label className="settings-toggle">
                <input
                    type="checkbox"
                    checked={settings.allowDmsFromServerMembers}
                    onChange={(event) => onChange({ ...settings, allowDmsFromServerMembers: event.target.checked })}
                />
                Allow DMs from server members (stub)
            </label>

            <div className="settings-section-card">
                <h3>Status</h3>
                <label className="settings-field">
                    <span>Show me as Idle after I'm inactive for</span>
                    <select
                        className="room-dialog-input"
                        value={settings.autoIdleMinutes}
                        onChange={(event) => onChange({ ...settings, autoIdleMinutes: Number(event.target.value) })}
                    >
                        {AUTO_IDLE_MINUTE_CHOICES.map((minutes) => (
                            <option key={minutes} value={minutes}>
                                {minutes === 0 ? "Never" : `${minutes} minutes`}
                            </option>
                        ))}
                    </select>
                </label>
                <p className="settings-inline-note">
                    Only applies while your status is Online, and you are back to Online as soon as you are
                    active again. The desktop app also counts activity in other apps where your system reports
                    it; the web app only counts activity in Jorvik.
                </p>
            </div>

            <div className="settings-section-card">
                <h3>Blocked users</h3>
                {ignoredUsers.ignoredUserIds.length === 0 ? (
                    <p className="settings-inline-note">You have not blocked anyone.</p>
                ) : (
                    <ul className="settings-blocked-list">
                        {ignoredUsers.ignoredUserIds.map((userId) => {
                            const name = client.getUser(userId)?.displayName || userId;
                            return (
                                <li key={userId} className="settings-blocked-item">
                                    <span className="settings-blocked-name">
                                        {name}
                                        {name !== userId ? <span className="settings-blocked-id">{userId}</span> : null}
                                    </span>
                                    <button
                                        type="button"
                                        className="settings-button"
                                        onClick={() =>
                                            void ignoredUsers.setIgnored(userId, false).then(
                                                () => onToast({ type: "success", message: `Unblocked ${name}.` }),
                                                () => onToast({ type: "error", message: "Could not unblock. Try again." }),
                                            )
                                        }
                                    >
                                        Unblock
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

