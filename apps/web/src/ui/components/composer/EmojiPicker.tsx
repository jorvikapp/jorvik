import React, { useEffect, useMemo, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import { loadAvailableEmojis } from "../../emoji/EmojiResolver";
import { loadUnicodeEmoji, type UnicodeEmojiGroup } from "../../emoji/unicodeEmoji";
import { subscribeEmojiPackUpdated } from "../../emoji/emojiEvents";
import { mxcThumbnailToHttp } from "../../utils/mxc";

interface EmojiPickerProps {
    client: MatrixClient;
    room: Room;
    activeSpaceId: string | null;
    onSelect: (value: string) => void;
    onClose: () => void;
}

interface QuickEmoji {
    value: string;
    label: string;
}

const QUICK_EMOJIS: QuickEmoji[] = [
    { value: "\u{1F44D}", label: "thumbs up" },
    { value: "\u{2764}\u{FE0F}", label: "heart" },
    { value: "\u{1F602}", label: "tears of joy" },
    { value: "\u{1F62E}", label: "surprised" },
    { value: "\u{1F525}", label: "fire" },
    { value: "\u{1F389}", label: "party" },
    { value: "\u{2705}", label: "check" },
    { value: "\u{1F440}", label: "eyes" },
];

/** One glyph per Unicode group, used as the category tab label. */
const GROUP_ICONS: Record<string, string> = {
    "Smileys & Emotion": "\u{1F600}",
    "People & Body": "\u{1F44B}",
    "Animals & Nature": "\u{1F436}",
    "Food & Drink": "\u{1F355}",
    "Travel & Places": "\u{2708}\u{FE0F}",
    Activities: "\u{26BD}",
    Objects: "\u{1F4A1}",
    Symbols: "\u{2764}\u{FE0F}",
    Flags: "\u{1F3F3}\u{FE0F}",
};

/** Cap rendered results while searching; 1900 buttons at once is not useful. */
const MAX_SEARCH_RESULTS = 200;

export function EmojiPicker({
    client,
    room,
    activeSpaceId,
    onSelect,
    onClose,
}: EmojiPickerProps): React.ReactElement {
    const [search, setSearch] = useState("");
    const [customEmojis, setCustomEmojis] = useState<Array<{ shortcode: string; name: string; url: string }>>([]);
    const [groups, setGroups] = useState<UnicodeEmojiGroup[]>([]);
    const [groupIndex, setGroupIndex] = useState(0);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadUnicodeEmoji().then(
            (loaded) => {
                if (!cancelled) {
                    setGroups(loaded);
                    setLoadError(null);
                }
            },
            (error: unknown) => {
                if (!cancelled) {
                    setLoadError(error instanceof Error ? error.message : "Could not load emoji.");
                }
            },
        );
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const load = async (): Promise<void> => {
            try {
                const emojis = await loadAvailableEmojis(client, room, activeSpaceId);
                if (!cancelled) {
                    setCustomEmojis(emojis);
                }
            } catch {
                if (!cancelled) {
                    setCustomEmojis([]);
                }
            }
        };

        void load();
        const unsubscribeEmojiPackUpdated = subscribeEmojiPackUpdated(() => {
            void load();
        });

        return () => {
            cancelled = true;
            unsubscribeEmojiPackUpdated();
        };
    }, [activeSpaceId, client, room]);

    const normalizedSearch = search.trim().toLowerCase();

    const filteredQuick = useMemo(() => {
        if (!normalizedSearch) {
            return QUICK_EMOJIS;
        }

        return QUICK_EMOJIS.filter((emoji) => emoji.label.includes(normalizedSearch));
    }, [normalizedSearch]);

    // Searching spans every group; browsing renders only the active category so
    // the picker never mounts ~1900 buttons at once.
    const unicodeResults = useMemo(() => {
        if (!normalizedSearch) {
            return groups[groupIndex]?.emojis ?? [];
        }

        const matches: { value: string; name: string }[] = [];
        for (const group of groups) {
            for (const emoji of group.emojis) {
                if (emoji.name.includes(normalizedSearch)) {
                    matches.push(emoji);
                    if (matches.length >= MAX_SEARCH_RESULTS) {
                        return matches;
                    }
                }
            }
        }
        return matches;
    }, [groupIndex, groups, normalizedSearch]);

    const filteredCustom = useMemo(() => {
        const searchable = customEmojis.map((emoji) => ({
            ...emoji,
            http: mxcThumbnailToHttp(client, emoji.url, 28, 28),
        }));

        if (!normalizedSearch) {
            return searchable;
        }

        return searchable.filter((emoji) => {
            const shortcode = emoji.shortcode.toLowerCase();
            const name = emoji.name.toLowerCase();
            return shortcode.includes(normalizedSearch) || name.includes(normalizedSearch);
        });
    }, [client, customEmojis, normalizedSearch]);

    return (
        <div className="composer-emoji-picker" role="dialog" aria-label="Emoji picker">
            <div className="composer-emoji-picker-header">
                <input
                    className="composer-emoji-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search emoji"
                    autoFocus
                />
                <button
                    type="button"
                    className="composer-emoji-close"
                    onClick={onClose}
                    aria-label="Close emoji picker"
                    title="Close"
                >
                    x
                </button>
            </div>

            {groups.length > 0 && !normalizedSearch ? (
                <div className="composer-emoji-tabs" role="tablist" aria-label="Emoji categories">
                    {groups.map((group, index) => (
                        <button
                            key={group.name}
                            type="button"
                            role="tab"
                            aria-selected={index === groupIndex}
                            className={`composer-emoji-tab${index === groupIndex ? " is-active" : ""}`}
                            onClick={() => setGroupIndex(index)}
                            title={group.name}
                        >
                            {GROUP_ICONS[group.name] ?? "\u{2B50}"}
                        </button>
                    ))}
                </div>
            ) : null}

            <div className="composer-emoji-scroll">
            {filteredQuick.length > 0 && !normalizedSearch ? (
                <div className="composer-emoji-section">
                    <div className="composer-emoji-section-title">Quick</div>
                    <div className="composer-emoji-grid">
                        {filteredQuick.map((emoji) => (
                            <button
                                key={emoji.value}
                                type="button"
                                className="composer-emoji-item"
                                onClick={() => onSelect(emoji.value)}
                                title={emoji.label}
                            >
                                {emoji.value}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {unicodeResults.length > 0 ? (
                <div className="composer-emoji-section">
                    <div className="composer-emoji-section-title">
                        {normalizedSearch ? "Results" : (groups[groupIndex]?.name ?? "Emoji")}
                    </div>
                    <div className="composer-emoji-grid">
                        {unicodeResults.map((emoji) => (
                            <button
                                key={`${emoji.value}-${emoji.name}`}
                                type="button"
                                className="composer-emoji-item"
                                onClick={() => onSelect(emoji.value)}
                                title={emoji.name}
                            >
                                {emoji.value}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {loadError ? <div className="composer-emoji-empty">{loadError}</div> : null}

            {filteredCustom.length > 0 ? (
                <div className="composer-emoji-section">
                    <div className="composer-emoji-section-title">Custom</div>
                    <div className="composer-emoji-grid composer-emoji-grid-custom">
                        {filteredCustom.map((emoji) => (
                            <button
                                key={emoji.shortcode}
                                type="button"
                                className="composer-emoji-item composer-emoji-item-custom"
                                onClick={() => onSelect(emoji.shortcode)}
                                title={emoji.shortcode}
                            >
                                {emoji.http ? (
                                    <img src={emoji.http} alt={emoji.shortcode} loading="lazy" decoding="async" />
                                ) : (
                                    emoji.shortcode
                                )}
                                <span>{emoji.shortcode}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {unicodeResults.length === 0 && filteredCustom.length === 0 && !loadError ? (
                <div className="composer-emoji-empty">No emojis found</div>
            ) : null}
            </div>
        </div>
    );
}
