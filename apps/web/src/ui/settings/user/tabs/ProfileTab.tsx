import React, { useEffect, useMemo, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { mediaFromMxc, thumbnailFromMxc } from "../../../adapters/media";
import { Avatar } from "../../../components/Avatar";
import type { ToastState } from "../../../components/Toast";

// Synapse caps an extended profile value at 255 characters
// (handlers/profile.py MAX_CUSTOM_FIELD_LEN); stop short of a server rejection.
const BIO_MAX_LENGTH = 255;
const BIO_FIELD = "bio";

interface ProfileTabProps {
    client: MatrixClient;
    onToast: (toast: Omit<ToastState, "id">) => void;
}

export function ProfileTab({ client, onToast }: ProfileTabProps): React.ReactElement {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const userId = client.getUserId() ?? "";

    const [displayName, setDisplayName] = useState("");
    const [avatarMxc, setAvatarMxc] = useState("");
    const [bio, setBio] = useState("");
    const [baselineDisplayName, setBaselineDisplayName] = useState("");
    const [baselineAvatarMxc, setBaselineAvatarMxc] = useState("");
    const [baselineBio, setBaselineBio] = useState("");
    // Custom profile fields are MSC4133 and off by default in Synapse. Hide the
    // field rather than offering one that cannot be saved.
    const [bioSupported, setBioSupported] = useState(false);
    // "" is a legitimate value meaning the user has no avatar, so it cannot
    // also stand for "we have not asked the server yet". Track that separately.
    const [profileLoaded, setProfileLoaded] = useState(false);
    // The effect below runs immediately when there is a userId, so starting
    // false left the very first paint with no loading state at all.
    const [loading, setLoading] = useState(Boolean(userId));
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let canceled = false;
        const loadProfile = async (): Promise<void> => {
            if (!userId) {
                setProfileLoaded(true);
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);
            try {
                const info = await client.getProfileInfo(userId);
                if (canceled) {
                    return;
                }

                const nextDisplayName = info.displayname ?? "";
                const nextAvatarMxc = info.avatar_url ?? "";
                setDisplayName(nextDisplayName);
                setAvatarMxc(nextAvatarMxc);
                setBaselineDisplayName(nextDisplayName);
                setBaselineAvatarMxc(nextAvatarMxc);
                setProfileLoaded(true);

                const supportsExtendedProfiles = await client
                    .doesServerSupportExtendedProfiles()
                    .catch(() => false);
                if (canceled) {
                    return;
                }
                setBioSupported(supportsExtendedProfiles);
                if (!supportsExtendedProfiles) {
                    return;
                }

                // An unset field is a 404 rather than an empty value.
                const storedBio = await client
                    .getExtendedProfileProperty(userId, BIO_FIELD)
                    .catch(() => null);
                if (canceled) {
                    return;
                }
                const nextBio = typeof storedBio === "string" ? storedBio : "";
                setBio(nextBio);
                setBaselineBio(nextBio);
            } catch (loadError) {
                if (!canceled) {
                    setError(loadError instanceof Error ? loadError.message : "Failed to load profile.");
                }
            } finally {
                if (!canceled) {
                    setLoading(false);
                }
            }
        };

        void loadProfile();
        return () => {
            canceled = true;
        };
    }, [client, userId]);

    const avatarPreview = useMemo(
        () =>
            thumbnailFromMxc(client, avatarMxc, 112, 112, "crop") ??
            mediaFromMxc(client, avatarMxc),
        [avatarMxc, client],
    );

    const hasChanges =
        displayName.trim() !== baselineDisplayName.trim() ||
        avatarMxc !== baselineAvatarMxc ||
        (bioSupported && bio.trim() !== baselineBio.trim());

    const uploadAvatar = async (file: File): Promise<void> => {
        setUploading(true);
        setError(null);
        try {
            const upload = await client.uploadContent(file, {
                includeFilename: true,
                type: file.type || "application/octet-stream",
                name: file.name,
            });

            const mxc = upload.content_uri;
            if (!mxc || !mxc.startsWith("mxc://")) {
                throw new Error("Homeserver did not return a valid MXC URL.");
            }

            setAvatarMxc(mxc);
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "Failed to upload avatar.");
        } finally {
            setUploading(false);
        }
    };

    const saveProfile = async (): Promise<void> => {
        if (!userId || !hasChanges) {
            return;
        }

        setSaving(true);
        setError(null);
        try {
            if (displayName.trim() !== baselineDisplayName.trim()) {
                await client.setDisplayName(displayName.trim());
            }

            if (avatarMxc !== baselineAvatarMxc) {
                await client.setAvatarUrl(avatarMxc || "");
            }

            if (bioSupported && bio.trim() !== baselineBio.trim()) {
                const nextBio = bio.trim();
                // Clearing a bio is a delete, not an empty string: the field
                // should disappear from the profile rather than linger blank.
                if (nextBio) {
                    await client.setExtendedProfileProperty(BIO_FIELD, nextBio);
                } else {
                    await client.deleteExtendedProfileProperty(BIO_FIELD);
                }
                setBaselineBio(nextBio);
                setBio(nextBio);
            }

            setBaselineDisplayName(displayName);
            setBaselineAvatarMxc(avatarMxc);
            onToast({ type: "success", message: "Profile updated." });
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Failed to update profile.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Profile</h2>
            <p className="settings-tab-description">
                Global Matrix profile settings (same model as reference Matrix clients).
            </p>

            {loading ? <p className="settings-inline-note">Loading profile...</p> : null}

            <div className="settings-profile-row">
                {profileLoaded ? (
                    <Avatar
                        className="settings-profile-avatar"
                        name={displayName || userId || "User"}
                        src={avatarPreview}
                        sources={[avatarPreview]}
                        seed={userId || undefined}
                        userId={userId || undefined}
                    />
                ) : (
                    <span
                        className="avatar settings-profile-avatar"
                        aria-label="Loading profile picture"
                        role="img"
                    >
                        <span className="avatar-mask settings-profile-avatar-loading" />
                    </span>
                )}
                <div className="settings-profile-actions">
                    <button
                        type="button"
                        className="settings-button"
                        disabled={uploading || !profileLoaded}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {uploading ? "Uploading..." : "Upload avatar"}
                    </button>
                    <button
                        type="button"
                        className="settings-button settings-button-secondary"
                        disabled={uploading || saving || !avatarMxc}
                        onClick={() => setAvatarMxc("")}
                    >
                        Clear avatar
                    </button>
                    <input
                        ref={fileInputRef}
                        className="settings-hidden-input"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                            const selectedFile = event.target.files?.[0];
                            if (selectedFile) {
                                void uploadAvatar(selectedFile);
                            }
                            event.currentTarget.value = "";
                        }}
                    />
                </div>
            </div>

            <label className="settings-field">
                <span>Display name</span>
                <input
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={saving}
                />
            </label>

            {bioSupported ? (
                <label className="settings-field">
                    <span>Bio</span>
                    <textarea
                        value={bio}
                        onChange={(event) => setBio(event.target.value.slice(0, BIO_MAX_LENGTH))}
                        maxLength={BIO_MAX_LENGTH}
                        rows={3}
                        placeholder="A short line about you"
                        disabled={saving}
                    />
                    <span className="settings-inline-note">
                        {bio.trim().length}/{BIO_MAX_LENGTH} - shown on your profile to people on this server.
                    </span>
                </label>
            ) : null}

            {error ? <p className="settings-inline-error">{error}</p> : null}

            <div className="settings-actions-row">
                <button
                    type="button"
                    className="settings-button"
                    disabled={!hasChanges || saving || uploading}
                    onClick={() => void saveProfile()}
                >
                    {saving ? "Saving..." : "Save profile"}
                </button>
            </div>
        </div>
    );
}
