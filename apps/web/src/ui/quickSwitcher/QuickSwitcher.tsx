import React, { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "../components/Avatar";
import { searchQuickSwitcher, type QuickSwitcherItem } from "./quickSwitcherSearch";

interface QuickSwitcherProps {
    items: readonly QuickSwitcherItem[];
    currentRoomId: string | null;
    onSelect: (item: QuickSwitcherItem) => void;
    onClose: () => void;
}

const LIST_ID = "quick-switcher-results";

function optionId(index: number): string {
    return `quick-switcher-option-${index}`;
}

function ItemIcon({ item }: { item: QuickSwitcherItem }): React.ReactElement {
    if (item.kind === "channel") {
        return (
            <span className="quick-switcher-glyph" aria-hidden="true">
                #
            </span>
        );
    }
    if (item.kind === "voice") {
        return (
            <span className="quick-switcher-glyph" aria-hidden="true">
                {"🔊"}
            </span>
        );
    }
    return (
        <Avatar
            className="quick-switcher-avatar"
            name={item.name}
            src={item.avatarSources[0] ?? null}
            sources={[...item.avatarSources]}
            seed={item.avatarSeed}
            userId={item.avatarSeed}
        />
    );
}

/** Jump to any channel, DM or space by name, without leaving the keyboard. */
export function QuickSwitcher({ items, currentRoomId, onSelect, onClose }: QuickSwitcherProps): React.ReactElement {
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLUListElement | null>(null);
    const results = useMemo(() => searchQuickSwitcher(items, query, currentRoomId), [currentRoomId, items, query]);
    const selected = results[Math.min(selectedIndex, results.length - 1)] ?? null;

    // Focus goes back where it was, usually the message box, when this closes.
    // Read while rendering: by the time effects run, the search box has it.
    const [previousFocus] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    useEffect(() => () => previousFocus?.focus(), [previousFocus]);

    useEffect(() => {
        listRef.current?.querySelector(`#${optionId(selectedIndex)}`)?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    const move = (step: number): void => {
        if (results.length > 0) {
            setSelectedIndex((current) => (Math.min(current, results.length - 1) + step + results.length) % results.length);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                move(1);
                return;
            case "ArrowUp":
                event.preventDefault();
                move(-1);
                return;
            case "Enter":
                event.preventDefault();
                if (selected) {
                    onSelect(selected);
                }
                return;
            case "Escape":
                event.preventDefault();
                onClose();
                return;
            case "Tab":
                // Nothing else in here takes focus; keep it in the search box.
                event.preventDefault();
                return;
        }
    };

    return (
        <div
            className="quick-switcher-overlay"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="quick-switcher" role="dialog" aria-modal="true" aria-label="Jump to a conversation">
                <input
                    className="quick-switcher-input"
                    autoFocus
                    value={query}
                    placeholder="Jump to a channel, DM or space"
                    spellCheck={false}
                    autoComplete="off"
                    role="combobox"
                    aria-label="Jump to a conversation"
                    aria-autocomplete="list"
                    aria-expanded={results.length > 0}
                    aria-controls={LIST_ID}
                    aria-activedescendant={selected ? optionId(results.indexOf(selected)) : undefined}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setSelectedIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                />
                {results.length > 0 ? (
                    <ul id={LIST_ID} ref={listRef} className="quick-switcher-results" role="listbox" aria-label="Conversations">
                        {results.map((item, index) => {
                            const isSelected = item === selected;
                            return (
                                <li
                                    key={item.roomId}
                                    id={optionId(index)}
                                    role="option"
                                    aria-selected={isSelected}
                                    className={`quick-switcher-option${isSelected ? " is-selected" : ""}${item.unread ? " is-unread" : ""}`}
                                    onMouseMove={() => {
                                        if (!isSelected) {
                                            setSelectedIndex(index);
                                        }
                                    }}
                                    // Keeps focus in the search box.
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onSelect(item)}
                                >
                                    <ItemIcon item={item} />
                                    <span className="quick-switcher-name">{item.name}</span>
                                    {item.count > 0 ? (
                                        <span className="quick-switcher-count" aria-label={`${item.count} unread`}>
                                            {item.count > 99 ? "99+" : item.count}
                                        </span>
                                    ) : null}
                                    {item.detail ? <span className="quick-switcher-detail">{item.detail}</span> : null}
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="quick-switcher-empty">{query.trim() ? "Nothing by that name." : "No conversations yet."}</p>
                )}
                <p className="quick-switcher-hint">
                    Start with <kbd>@</kbd> for people, <kbd>#</kbd> for channels or <kbd>*</kbd> for spaces.{" "}
                    <kbd>↑</kbd> <kbd>↓</kbd> to choose, <kbd>Enter</kbd> to go.
                </p>
            </div>
        </div>
    );
}
