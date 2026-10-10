import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Position {
    x: number;
    y: number;
}

interface RailContextMenuProps {
    position: Position | null;
    onMarkAllRead: () => void;
    onClose: () => void;
}

/** The menu on right-clicking an icon in the rail: your DMs, or a Space. */
export function RailContextMenu({ position, onMarkAllRead, onClose }: RailContextMenuProps): React.ReactElement | null {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [clampedPosition, setClampedPosition] = useState<Position | null>(position);

    useEffect(() => {
        if (!position) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        const onMouseDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (target && menuRef.current?.contains(target)) {
                return;
            }
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("mousedown", onMouseDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("mousedown", onMouseDown);
        };
    }, [onClose, position]);

    useLayoutEffect(() => {
        if (!position || !menuRef.current) {
            setClampedPosition(position);
            return;
        }
        const viewportPadding = 8;
        const rect = menuRef.current.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - viewportPadding;
        const maxY = window.innerHeight - rect.height - viewportPadding;
        setClampedPosition({
            x: Math.min(Math.max(position.x, viewportPadding), Math.max(maxX, viewportPadding)),
            y: Math.min(Math.max(position.y, viewportPadding), Math.max(maxY, viewportPadding)),
        });
    }, [position]);

    if (!position) {
        return null;
    }

    // Same look as the message menu, and on the desktop app it takes clicks, not window drags.
    return createPortal(
        <div
            ref={menuRef}
            className="message-context-menu"
            style={{ left: `${clampedPosition?.x ?? position.x}px`, top: `${clampedPosition?.y ?? position.y}px` }}
            role="menu"
        >
            <button
                type="button"
                className="message-context-menu-item"
                role="menuitem"
                onClick={() => {
                    onMarkAllRead();
                    onClose();
                }}
            >
                Mark all as read
            </button>
        </div>,
        document.body,
    );
}
