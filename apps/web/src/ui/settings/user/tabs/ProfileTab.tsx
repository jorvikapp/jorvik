import React, { useEffect, useMemo, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { activityAudience, describeActivityAudience } from "../../../../core/activity/activityPrivacy";
import { formatUserIdForDisplay } from "../../../../core/users/formatUserId";
import { BANNER_FIELD, BANNER_MAX_BYTES, BANNER_TYPES, bannerMxcFrom, rememberBanner } from "../../../../core/users/profileBanner";
import { useJoinedSpaces, useUserActivity } from "../../../activity/useActivity";
import { useActivityPrivacy } from "../../../activity/useActivityPrivacy";
import { mediaFromMxc, thumbnailFromMxc } from "../../../adapters/media";
import { ActivityLine } from "../../../components/activity/ActivityLine";
import { Avatar } from "../../../components/Avatar";
import { bannerGradient, ProfileBanner } from "../../../components/profile/ProfileBanner";
import type { ToastState } from "../../../components/Toast";

// Synapse caps an extended profile value at 255 characters
// (handlers/profile.py MAX_CUSTOM_FIELD_LEN); stop short of a server rejection.
const BIO_MAX_LENGTH = 255;
const BIO_FIELD = "bio";

interface ProfileTabProps {
    client: MatrixClient;
    onToast: (toast: Omit<ToastState, "id">) => void;
    /** The status message others see, for the preview. */
    statusMessage?: string;
    onOpenActivityPrivacy?: () => void;
}

export function ProfileTab({ client, onToast, statusMessage = "", onOpenActivityPrivacy }: ProfileTabProps): React.ReactElement {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const bannerInputRef = useRef<HTMLInputElement | null>(null);
    const userId = client.getUserId() ?? "";
    const { settings: activitySettings } = useActivityPrivacy(client);
    const spaces = useJoinedSpaces(client);
    const ownActivity = useUserActivity(userId);

    const [displayName, setDisplayName] = useState("");
    const [avatarMxc, setAvatarMxc] = useState("");
    const [bio, setBio] = useState("");
    const [baselineDisplayName, setBaselineDisplayName] = useState("");
    const [baselineAvatarMxc, setBaselineAvatarMxc] = useState("");
    const [baselineBio, setBaselineBio] = useState("");
    // "" is no banner: the colours made from your user ID.
    const [bannerMxc, setBannerMxc] = useState("");
    const [baselineBannerMxc, setBaselineBannerMxc] = useState("");
    const [uploadingBanner, setUploadingBanner] = useState(false);
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
                const nextBannerMxc = bannerMxcFrom((info as Record<string, unknown>)[BANNER_FIELD]) ?? "";
                setBannerMxc(nextBannerMxc);
                setBaselineBannerMxc(nextBannerMxc);
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

    // The full file, not a thumbnail: a GIF keeps moving.
    const bannerPreview = useMemo(() => mediaFromMxc(client, bannerMxc), [bannerMxc, client]);
    const bannerColours = useMemo(() => bannerGradient(userId), [userId]);

    // Until the profile loads (or without a display name), the short form of the id, as elsewhere in the app.
    const previewName = displayName.trim() || formatUserIdForDisplay(userId, client.getDomain()) || "User";

    const hasChanges =
        displayName.trim() !== baselineDisplayName.trim() ||
        avatarMxc !== baselineAvatarMxc ||
        (bioSupported && bio.trim() !== baselineBio.trim()) ||
        (bioSupported && bannerMxc !== baselineBannerMxc);

    const uploadBanner = async (file: File): Promise<void> => {
        setError(null);
        if (!(BANNER_TYPES as readonly string[]).includes(file.type)) {
            setError("A banner can be a PNG, JPEG, GIF or WebP picture.");
            return;
        }
        const serverMax = await client
            .getMediaConfig()
            .then((config) => config["m.upload.size"])
            .catch(() => undefined);
        const maxBytes = typeof serverMax === "number" && serverMax > 0 ? Math.min(serverMax, BANNER_MAX_BYTES) : BANNER_MAX_BYTES;
        if (file.size > maxBytes) {
            const size = (file.size / 1_048_576).toFixed(1);
            setError(`That picture is ${size} MB; a banner can be up to ${Math.floor(maxBytes / 1_048_576)} MB.`);
            return;
        }
        setUploadingBanner(true);
        try {
            const upload = await client.uploadContent(file, {
                includeFilename: true,
                type: file.type,
                name: file.name,
            });
            const mxc = bannerMxcFrom(upload.content_uri);
            if (!mxc) {
                throw new Error("Homeserver did not return a valid MXC URL.");
            }
            setBannerMxc(mxc);
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "Failed to upload banner.");
        } finally {
            setUploadingBanner(false);
        }
    };

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

            if (bioSupported && bannerMxc !== baselineBannerMxc) {
                // Removing it is a delete, like the bio: the colours come back.
                if (bannerMxc) {
                    await client.setExtendedProfileProperty(BANNER_FIELD, bannerMxc);
                } else {
                    await client.deleteExtendedProfileProperty(BANNER_FIELD);
                }
                setBaselineBannerMxc(bannerMxc);
                rememberBanner(userId, bannerMxc || null);
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
            <p className="settings-tab-description">How you show up to others, in every Space and DM.</p>

            {loading ? <p className="settings-inline-note">Loading profile...</p> : null}

            <div className="settings-section-card profile-preview">
                <h3>How others see you</h3>
                {bioSupported ? (
                    <ProfileBanner className="profile-preview-banner" src={bannerPreview} background={bannerColours} />
                ) : null}
                <div className={`profile-preview-card${bioSupported ? " has-banner" : ""}`}>
                    <Avatar
                        className="profile-preview-avatar"
                        name={previewName}
                        src={avatarPreview}
                        sources={[avatarPreview]}
                        seed={userId || undefined}
                        userId={userId || undefined}
                    />
                    <div className="profile-preview-main">
                        <span className="profile-preview-name">{previewName}</span>
                        {statusMessage ? <p className="profile-preview-status">{statusMessage}</p> : null}
                        <ActivityLine client={client} userId={userId} className="profile-preview-activity" />
                        {activitySettings.enabled && !ownActivity ? (
                            <p className="settings-inline-note">When you play a game, it shows here.</p>
                        ) : null}
                    </div>
                </div>
                <p className="settings-inline-note">
                    {describeActivityAudience(activitySettings, activityAudience(activitySettings, spaces))}
                </p>
                {onOpenActivityPrivacy ? (
                    <div className="settings-actions-row">
                        <button
                            type="button"
                            className="settings-button settings-button-secondary"
                            onClick={onOpenActivityPrivacy}
                        >
                            Activity Privacy
                        </button>
                    </div>
                ) : null}
            </div>

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

            {bioSupported ? (
                <div className="settings-field settings-banner-field">
                    <span>Profile banner</span>
                    <div className="settings-profile-actions">
                        <button
                            type="button"
                            className="settings-button"
                            disabled={uploadingBanner || saving || !profileLoaded}
                            onClick={() => bannerInputRef.current?.click()}
                        >
                            {uploadingBanner ? "Uploading..." : bannerMxc ? "Change banner" : "Upload banner"}
                        </button>
                        <button
                            type="button"
                            className="settings-button settings-button-secondary"
                            disabled={uploadingBanner || saving || !bannerMxc}
                            onClick={() => setBannerMxc("")}
                        >
                            Remove banner
                        </button>
                        <input
                            ref={bannerInputRef}
                            className="settings-hidden-input"
                            type="file"
                            accept={BANNER_TYPES.join(",")}
                            onChange={(event) => {
                                const selectedFile = event.target.files?.[0];
                                if (selectedFile) {
                                    void uploadBanner(selectedFile);
                                }
                                event.currentTarget.value = "";
                            }}
                        />
                    </div>
                    <span className="settings-inline-note">
                        The picture behind your avatar on your profile: PNG, JPEG, GIF or WebP, up to{" "}
                        {Math.floor(BANNER_MAX_BYTES / 1_048_576)} MB. Wide pictures work best, about 3:1 (for example
                        960 x 300), and GIFs and animated WebPs move. Shown to people on this server.
                    </span>
                </div>
            ) : null}

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
                    disabled={!hasChanges || saving || uploading || uploadingBanner}
                    onClick={() => void saveProfile()}
                >
                    {saving ? "Saving..." : "Save profile"}
                </button>
            </div>
        </div>
    );
}
