import React, { useCallback, useMemo, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    PROFILE_IMAGE_MAX_BYTES,
    PROFILE_IMAGE_TYPES,
    profileImageMxcFrom,
    rememberProfileImage,
    type ProfileImageField,
} from "../../../../core/users/profileImages";
import { mediaFromMxc } from "../../../adapters/media";

const MEGABYTE = 1_048_576;

/**
 * One of your profile pictures in Settings. It's saved the moment you pick or remove it: there's no separate
 * Save step to miss (a picture that only showed in the preview looked set, but never reached the profile).
 */
export interface ProfileImageDraft {
    field: ProfileImageField;
    /** "" is none. */
    mxc: string;
    /** The full file, not a thumbnail, so a GIF keeps moving; null without one. */
    previewSrc: string | null;
    /** Uploading or saving. */
    busy: boolean;
    /** Takes what the server has. */
    load: (profile: Record<string, unknown>) => void;
    upload: (file: File) => Promise<void>;
    remove: () => Promise<void>;
}

/**
 * `noun` names it in messages ("banner", "nameplate"); errors go to `onError`, null clearing them, and a saved
 * change to `onSaved` with a message to show.
 */
export function useProfileImageDraft(
    client: MatrixClient,
    userId: string,
    field: ProfileImageField,
    noun: string,
    onError: (message: string | null) => void,
    onSaved: (message: string) => void,
): ProfileImageDraft {
    const [mxc, setMxc] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(
        (profile: Record<string, unknown>) => {
            setMxc(profileImageMxcFrom(profile[field]) ?? "");
        },
        [field],
    );

    // Stores it in the profile (none is a delete) and tells views already open.
    const store = async (next: string): Promise<void> => {
        if (next) {
            await client.setExtendedProfileProperty(field, next);
        } else {
            await client.deleteExtendedProfileProperty(field);
        }
        setMxc(next);
        rememberProfileImage(userId, field, next || null);
    };

    const upload = async (file: File): Promise<void> => {
        onError(null);
        if (!(PROFILE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
            onError(`A ${noun} can be a PNG, JPEG, GIF or WebP picture.`);
            return;
        }
        const serverMax = await client
            .getMediaConfig()
            .then((config) => config["m.upload.size"])
            .catch(() => undefined);
        const maxBytes =
            typeof serverMax === "number" && serverMax > 0 ? Math.min(serverMax, PROFILE_IMAGE_MAX_BYTES) : PROFILE_IMAGE_MAX_BYTES;
        if (file.size > maxBytes) {
            const size = (file.size / MEGABYTE).toFixed(1);
            onError(`That picture is ${size} MB; a ${noun} can be up to ${Math.floor(maxBytes / MEGABYTE)} MB.`);
            return;
        }
        setBusy(true);
        try {
            const result = await client.uploadContent(file, { includeFilename: true, type: file.type, name: file.name });
            const uploaded = profileImageMxcFrom(result.content_uri);
            if (!uploaded) {
                throw new Error("Homeserver did not return a valid MXC URL.");
            }
            await store(uploaded);
            onSaved(`${noun[0].toUpperCase()}${noun.slice(1)} updated.`);
        } catch (uploadError) {
            onError(uploadError instanceof Error ? uploadError.message : `Failed to set your ${noun}.`);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (): Promise<void> => {
        onError(null);
        setBusy(true);
        try {
            await store("");
            onSaved(`${noun[0].toUpperCase()}${noun.slice(1)} removed.`);
        } catch (removeError) {
            onError(removeError instanceof Error ? removeError.message : `Failed to remove your ${noun}.`);
        } finally {
            setBusy(false);
        }
    };

    const previewSrc = useMemo(() => mediaFromMxc(client, mxc), [client, mxc]);
    return { field, mxc, previewSrc, busy, load, upload, remove };
}

/** Upload / Change and Remove for one profile picture, with a note on what it is; `children` is its preview. */
export function ProfileImagePicker({
    draft,
    label,
    noun,
    note,
    disabled,
    children,
}: {
    draft: ProfileImageDraft;
    label: string;
    /** "banner": the buttons say "Upload banner", "Change banner", "Remove banner". */
    noun: string;
    note: React.ReactNode;
    disabled: boolean;
    children?: React.ReactNode;
}): React.ReactElement {
    const inputRef = useRef<HTMLInputElement | null>(null);
    return (
        <div className={`settings-field settings-image-field settings-${noun}-field`}>
            <span>{label}</span>
            {children}
            <div className="settings-profile-actions">
                <button
                    type="button"
                    className="settings-button"
                    disabled={draft.busy || disabled}
                    onClick={() => inputRef.current?.click()}
                >
                    {draft.busy ? "Saving..." : draft.mxc ? `Change ${noun}` : `Upload ${noun}`}
                </button>
                <button
                    type="button"
                    className="settings-button settings-button-secondary"
                    disabled={draft.busy || disabled || !draft.mxc}
                    onClick={() => void draft.remove()}
                >
                    Remove {noun}
                </button>
                <input
                    ref={inputRef}
                    className="settings-hidden-input"
                    type="file"
                    accept={PROFILE_IMAGE_TYPES.join(",")}
                    data-field={draft.field}
                    onChange={(event) => {
                        const selectedFile = event.target.files?.[0];
                        if (selectedFile) {
                            void draft.upload(selectedFile);
                        }
                        event.currentTarget.value = "";
                    }}
                />
            </div>
            <span className="settings-inline-note">{note}</span>
        </div>
    );
}

/** "PNG, JPEG, GIF or WebP, up to 10 MB". */
export const PROFILE_IMAGE_RULES = `PNG, JPEG, GIF or WebP, up to ${Math.floor(PROFILE_IMAGE_MAX_BYTES / MEGABYTE)} MB`;
