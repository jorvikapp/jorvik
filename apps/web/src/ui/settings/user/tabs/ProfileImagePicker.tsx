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

/** A profile picture being edited: what's chosen now, what's saved, and the upload in progress. */
export interface ProfileImageDraft {
    field: ProfileImageField;
    /** "" is none. */
    mxc: string;
    /** The full file, not a thumbnail, so a GIF keeps moving; null without one. */
    previewSrc: string | null;
    changed: boolean;
    uploading: boolean;
    setMxc: (mxc: string) => void;
    /** Takes what the server has, as both the choice and the saved value. */
    load: (profile: Record<string, unknown>) => void;
    upload: (file: File) => Promise<void>;
    /** Stores the choice in the profile (removing it is a delete) and tells views already open. */
    save: (userId: string) => Promise<void>;
}

/**
 * One of your profile pictures in Settings. `noun` names it in messages ("banner", "nameplate"); errors go to
 * `onError`, null clearing them.
 */
export function useProfileImageDraft(
    client: MatrixClient,
    field: ProfileImageField,
    noun: string,
    onError: (message: string | null) => void,
): ProfileImageDraft {
    const [mxc, setMxc] = useState("");
    const [baseline, setBaseline] = useState("");
    const [uploading, setUploading] = useState(false);

    const load = useCallback(
        (profile: Record<string, unknown>) => {
            const stored = profileImageMxcFrom(profile[field]) ?? "";
            setMxc(stored);
            setBaseline(stored);
        },
        [field],
    );

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
        setUploading(true);
        try {
            const result = await client.uploadContent(file, { includeFilename: true, type: file.type, name: file.name });
            const uploaded = profileImageMxcFrom(result.content_uri);
            if (!uploaded) {
                throw new Error("Homeserver did not return a valid MXC URL.");
            }
            setMxc(uploaded);
        } catch (uploadError) {
            onError(uploadError instanceof Error ? uploadError.message : `Failed to upload ${noun}.`);
        } finally {
            setUploading(false);
        }
    };

    const save = async (userId: string): Promise<void> => {
        if (mxc === baseline) {
            return;
        }
        if (mxc) {
            await client.setExtendedProfileProperty(field, mxc);
        } else {
            await client.deleteExtendedProfileProperty(field);
        }
        setBaseline(mxc);
        rememberProfileImage(userId, field, mxc || null);
    };

    const previewSrc = useMemo(() => mediaFromMxc(client, mxc), [client, mxc]);
    return { field, mxc, previewSrc, changed: mxc !== baseline, uploading, setMxc, load, upload, save };
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
                    disabled={draft.uploading || disabled}
                    onClick={() => inputRef.current?.click()}
                >
                    {draft.uploading ? "Uploading..." : draft.mxc ? `Change ${noun}` : `Upload ${noun}`}
                </button>
                <button
                    type="button"
                    className="settings-button settings-button-secondary"
                    disabled={draft.uploading || disabled || !draft.mxc}
                    onClick={() => draft.setMxc("")}
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
