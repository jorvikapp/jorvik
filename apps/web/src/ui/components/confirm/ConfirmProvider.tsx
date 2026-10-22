import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { usePhoneLayout } from "../../layout/phoneLayout";
import { BottomSheet } from "../phone/BottomSheet";
import { RoomDialog } from "../rooms/RoomDialog";

export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmLabel: string;
    // Red, for actions that remove something.
    danger?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm {
    options: ConfirmOptions;
    resolve: (confirmed: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Jorvik's own "are you sure?". The browser's confirm() can be blocked or never shown, and then
 * it answers "no" without asking: on an iPhone that made Sign out do nothing at all.
 * Phones get a sheet from the bottom, everything else a small dialog.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const [pending, setPending] = useState<PendingConfirm | null>(null);
    const pendingRef = useRef<PendingConfirm | null>(null);
    const isPhone = usePhoneLayout();

    const settle = useCallback((confirmed: boolean): void => {
        const current = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        current?.resolve(confirmed);
    }, []);

    const confirm = useCallback<ConfirmFn>((options) => {
        // A new question replaces one still open, which counts as cancelled.
        pendingRef.current?.resolve(false);
        return new Promise<boolean>((resolve) => {
            const next = { options, resolve };
            pendingRef.current = next;
            setPending(next);
        });
    }, []);

    // Whatever is still waiting when the app goes away gets a "no".
    useEffect(() => () => pendingRef.current?.resolve(false), []);

    const cancel = useCallback((): void => settle(false), [settle]);
    const accept = useCallback((): void => settle(true), [settle]);
    const options = pending?.options;

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {isPhone ? (
                <BottomSheet open={options !== undefined} label={options?.title ?? ""} onClose={cancel} className="confirm-sheet">
                    {options ? (
                        <>
                            <div className="confirm-sheet-text">
                                <p className="confirm-sheet-title">{options.title}</p>
                                {options.message ? <p className="confirm-sheet-message">{options.message}</p> : null}
                            </div>
                            <div className="sheet-group">
                                <button
                                    type="button"
                                    className={`sheet-item confirm-sheet-action${options.danger ? " sheet-item-danger" : ""}`}
                                    onClick={accept}
                                >
                                    {options.confirmLabel}
                                </button>
                            </div>
                            <div className="sheet-group">
                                <button type="button" className="sheet-item confirm-sheet-action" onClick={cancel}>
                                    Cancel
                                </button>
                            </div>
                        </>
                    ) : null}
                </BottomSheet>
            ) : (
                <RoomDialog
                    open={options !== undefined}
                    title={options?.title ?? ""}
                    onClose={cancel}
                    className="confirm-dialog-overlay"
                    footer={
                        options ? (
                            <>
                                <button
                                    type="button"
                                    className="room-dialog-button room-dialog-button-secondary"
                                    onClick={cancel}
                                    autoFocus
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className={`room-dialog-button ${options.danger ? "room-dialog-button-danger" : "room-dialog-button-primary"}`}
                                    onClick={accept}
                                >
                                    {options.confirmLabel}
                                </button>
                            </>
                        ) : null
                    }
                >
                    {options?.message ? <p className="confirm-dialog-message">{options.message}</p> : null}
                </RoomDialog>
            )}
        </ConfirmContext.Provider>
    );
}

/** Asks with Jorvik's own box; outside a ConfirmProvider it falls back to the browser's. */
export function useConfirm(): ConfirmFn {
    const confirm = useContext(ConfirmContext);
    return useCallback<ConfirmFn>(
        async (options) => {
            if (confirm) {
                return confirm(options);
            }
            return window.confirm(options.message ? `${options.title}\n\n${options.message}` : options.title);
        },
        [confirm],
    );
}
