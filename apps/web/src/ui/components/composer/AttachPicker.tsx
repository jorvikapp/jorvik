import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { isAppleTouchDevice } from "../../../core/platform/appleTouch";
import { BottomSheet } from "../phone/BottomSheet";

export interface AttachPickerHandle {
    open: () => void;
}

interface AttachPickerProps {
    disabled: boolean;
    asMenu: boolean;
    onFiles: (files: File[]) => void;
}

// Touch phones get a menu for the +, except iPhones: they already answer it with Apple's own menu
// of the same choices, so ours would only add a step. Desktop browsers can't open the camera.
export function shouldUseAttachMenu(isPhone: boolean): boolean {
    if (!isPhone || typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia("(pointer: coarse)").matches && !isAppleTouchDevice();
}

// The + in the message box. A web page can't see the phone's photos, so the menu hands over to the
// phone's own pickers: photos and videos, which opens on the newest; the camera; or any file.
export const AttachPicker = React.forwardRef<AttachPickerHandle, AttachPickerProps>(function AttachPicker(
    { disabled, asMenu, onFiles },
    ref,
) {
    const [menuOpen, setMenuOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const photoInputRef = useRef<HTMLInputElement | null>(null);
    const cameraInputRef = useRef<HTMLInputElement | null>(null);

    useImperativeHandle(ref, () => ({
        open: () => {
            if (asMenu) {
                setMenuOpen(true);
            } else {
                fileInputRef.current?.click();
            }
        },
    }));

    useEffect(() => {
        if (!asMenu) {
            setMenuOpen(false);
        }
    }, [asMenu]);

    const closeMenu = useCallback(() => setMenuOpen(false), []);

    // Straight from the tap: browsers only open a picker in answer to one.
    const pick = (input: HTMLInputElement | null): void => {
        setMenuOpen(false);
        input?.click();
    };

    const takeFiles = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const input = event.currentTarget;
        onFiles(Array.from(input.files ?? []));
        // So picking the same file again still counts as a change.
        input.value = "";
    };

    return (
        <>
            <input ref={fileInputRef} className="composer-file-input" type="file" multiple onChange={takeFiles} disabled={disabled} />
            {asMenu ? (
                <>
                    <input
                        ref={photoInputRef}
                        className="composer-file-input"
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        onChange={takeFiles}
                        disabled={disabled}
                    />
                    <input
                        ref={cameraInputRef}
                        className="composer-file-input"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={takeFiles}
                        disabled={disabled}
                    />
                    <BottomSheet open={menuOpen} label="Add to your message" onClose={closeMenu}>
                        <div className="sheet-group">
                            <button type="button" className="sheet-item" onClick={() => pick(photoInputRef.current)}>
                                Photos and videos
                            </button>
                            <button type="button" className="sheet-item" onClick={() => pick(cameraInputRef.current)}>
                                Take a photo
                            </button>
                            <button type="button" className="sheet-item" onClick={() => pick(fileInputRef.current)}>
                                Files
                            </button>
                        </div>
                    </BottomSheet>
                </>
            ) : null}
        </>
    );
});
