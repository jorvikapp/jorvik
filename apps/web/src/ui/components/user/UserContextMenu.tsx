import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { UserMenuEntry, UserMenuItem } from "../../users/userMenus";

export interface MenuPoint {
    x: number;
    y: number;
}

export interface UserContextMenuProps {
    /** Where it was opened: the pointer, or where the finger pressed. */
    point: MenuPoint;
    /** For screen readers: whose menu this is. */
    label: string;
    entries: UserMenuEntry[];
    onClose: () => void;
}

const EDGE = 8;

/**
 * Where the menu goes: at the point, opening leftwards or upwards instead when it would run off the right or
 * bottom of the screen, and kept on the screen whatever happens.
 */
export function placeMenu(
    point: MenuPoint,
    size: { width: number; height: number },
    viewport: { width: number; height: number },
): MenuPoint {
    let x = point.x;
    let y = point.y;
    if (x + size.width > viewport.width - EDGE) {
        x = point.x - size.width;
    }
    if (y + size.height > viewport.height - EDGE) {
        y = point.y - size.height;
    }
    return {
        x: Math.min(Math.max(x, EDGE), Math.max(EDGE, viewport.width - size.width - EDGE)),
        y: Math.min(Math.max(y, EDGE), Math.max(EDGE, viewport.height - size.height - EDGE)),
    };
}

type Section = { kind: "items"; entries: UserMenuEntry[] } | { kind: "group"; label: string; id: string; entries: UserMenuEntry[] };

/** Items after a label belong to it, as a group, until the next separator. */
function sections(entries: UserMenuEntry[]): Section[] {
    const out: Section[] = [];
    let current: Section = { kind: "items", entries: [] };
    for (const entry of entries) {
        if (entry.kind === "label") {
            out.push(current);
            current = { kind: "group", label: entry.label, id: entry.id, entries: [] };
            continue;
        }
        if (entry.kind === "separator" && current.kind === "group") {
            out.push(current);
            current = { kind: "items", entries: [] };
        }
        current.entries.push(entry);
    }
    out.push(current);
    return out.filter((section) => section.kind === "group" || section.entries.length > 0);
}

/**
 * The menu on right-clicking someone, or long-pressing them on a phone. It closes on a click outside, Escape,
 * choosing an item, scrolling, or the window losing focus or changing size. The keyboard moves through it
 * with the arrows (Home and End too) and Tab stays inside it.
 */
export function UserContextMenu({ point, label, entries, onClose }: UserContextMenuProps): React.ReactElement {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const openerRef = useRef<Element | null>(null);
    const [placed, setPlaced] = useState<MenuPoint | null>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const items = (): HTMLButtonElement[] => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

    useLayoutEffect(() => {
        openerRef.current = document.activeElement;
        const menu = menuRef.current;
        if (!menu) {
            return;
        }
        // Its own size, not the on-screen one, which the opening animation scales down for a moment.
        setPlaced(placeMenu(point, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
        items()[0]?.focus({ preventScroll: true });
        // A right-click's press focuses what was clicked once the menu is already open: take focus back.
        const frame = requestAnimationFrame(() => {
            if (menuRef.current && !menuRef.current.contains(document.activeElement)) {
                items()[0]?.focus({ preventScroll: true });
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [point]);

    useEffect(() => {
        const close = (): void => onCloseRef.current();
        const outside = (event: Event): void => {
            const target = event.target as Node | null;
            if (target && menuRef.current?.contains(target)) {
                return;
            }
            close();
        };
        // Pointer events, not mouse ones: after a long press, a phone sends a stray mousedown where the finger
        // was, which would close the menu it just opened. A real tap or click elsewhere is a pointerdown.
        window.addEventListener("pointerdown", outside, true);
        window.addEventListener("scroll", outside, true);
        window.addEventListener("wheel", outside, { capture: true, passive: true });
        window.addEventListener("blur", close);
        window.addEventListener("resize", close);
        return () => {
            window.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("scroll", outside, true);
            window.removeEventListener("wheel", outside, { capture: true } as EventListenerOptions);
            window.removeEventListener("blur", close);
            window.removeEventListener("resize", close);
        };
    }, []);

    const closeAndReturnFocus = (): void => {
        const opener = openerRef.current;
        onClose();
        if (opener instanceof HTMLElement && opener.isConnected) {
            opener.focus({ preventScroll: true });
        }
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const move = (index: number): void => {
            event.preventDefault();
            list[(index + list.length) % list.length]?.focus();
        };
        switch (event.key) {
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                closeAndReturnFocus();
                return;
            case "ArrowDown":
                move(at + 1);
                return;
            case "ArrowUp":
                move(at < 0 ? list.length - 1 : at - 1);
                return;
            case "Home":
                move(0);
                return;
            case "End":
                move(list.length - 1);
                return;
            case "Tab":
                // Focus stays in the menu while it's open.
                move(event.shiftKey ? at - 1 : at + 1);
                return;
            case "Enter":
            case " ":
                if (at >= 0) {
                    event.preventDefault();
                    list[at].click();
                }
                return;
        }
    };

    const renderEntry = (entry: UserMenuEntry): React.ReactNode => {
        if (entry.kind === "separator") {
            return <div key={entry.id} role="separator" className="user-menu-separator" />;
        }
        if (entry.kind === "label") {
            return null;
        }
        const run = (chosen: UserMenuItem): void => {
            closeAndReturnFocus();
            chosen.run();
        };
        return (
            <button
                key={entry.id}
                type="button"
                role="menuitem"
                data-item={entry.id}
                className={`user-menu-item${entry.tone && entry.tone !== "default" ? ` is-${entry.tone}` : ""}`}
                onClick={() => run(entry)}
            >
                {entry.label}
            </button>
        );
    };

    return createPortal(
        <div
            ref={menuRef}
            className="user-menu"
            role="menu"
            aria-label={label}
            style={{ left: placed?.x ?? point.x, top: placed?.y ?? point.y, visibility: placed ? "visible" : "hidden" }}
            onKeyDown={onKeyDown}
            onContextMenu={(event) => event.preventDefault()}
        >
            {sections(entries).map((section, index) =>
                section.kind === "group" ? (
                    <div key={section.id} role="group" aria-labelledby={`${section.id}-title`} className="user-menu-group">
                        <div id={`${section.id}-title`} className="user-menu-label">
                            {section.label}
                        </div>
                        {section.entries.map(renderEntry)}
                    </div>
                ) : (
                    <React.Fragment key={`items-${index}`}>{section.entries.map(renderEntry)}</React.Fragment>
                ),
            )}
        </div>,
        document.body,
    );
}
