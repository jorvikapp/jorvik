import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { usePhoneBackLayer } from "../../layout/phoneBackStack";

interface BottomSheetProps {
    open: boolean;
    label: string;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
}

// Dragging the grip down this far, or flicking it, closes the sheet.
const CLOSE_DRAG_PX = 80;

// A panel that rises from the bottom of the screen, for menus on phones. It closes on the scrim,
// on Escape, on the phone's back button, or by dragging its grip down.
export function BottomSheet({ open, label, onClose, children, className }: BottomSheetProps): React.ReactElement | null {
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{ pointerId: number; startY: number; startT: number } | null>(null);
    const [dragY, setDragY] = useState(0);

    usePhoneBackLayer(open, onClose);

    useEffect(() => {
        if (!open) {
            setDragY(0);
            return undefined;
        }
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        sheetRef.current?.focus({ preventScroll: true });
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            previouslyFocused?.focus({ preventScroll: true });
        };
    }, [onClose, open]);

    const onGripPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
        dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startT: event.timeStamp };
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // The pointer is already gone.
        }
    }, []);
    const onGripPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
        const drag = dragRef.current;
        if (drag && event.pointerId === drag.pointerId) {
            setDragY(Math.max(0, event.clientY - drag.startY));
        }
    }, []);
    const onGripPointerEnd = useCallback(
        (event: React.PointerEvent<HTMLDivElement>): void => {
            const drag = dragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) {
                return;
            }
            dragRef.current = null;
            const distance = Math.max(0, event.clientY - drag.startY);
            const velocity = distance / Math.max(16, event.timeStamp - drag.startT);
            setDragY(0);
            if (event.type === "pointerup" && (distance > CLOSE_DRAG_PX || (distance > 12 && velocity > 0.6))) {
                onClose();
            }
        },
        [onClose],
    );

    if (!open || typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <div className="bottom-sheet-layer">
            <div className="bottom-sheet-scrim" onClick={onClose} aria-hidden="true" />
            <div
                ref={sheetRef}
                className={`bottom-sheet${className ? ` ${className}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                tabIndex={-1}
                style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
            >
                <div
                    className="bottom-sheet-grip"
                    onPointerDown={onGripPointerDown}
                    onPointerMove={onGripPointerMove}
                    onPointerUp={onGripPointerEnd}
                    onPointerCancel={onGripPointerEnd}
                    aria-hidden="true"
                >
                    <span />
                </div>
                <div className="bottom-sheet-body">{children}</div>
            </div>
        </div>,
        document.body,
    );
}
