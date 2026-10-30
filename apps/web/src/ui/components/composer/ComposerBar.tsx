import React from "react";

interface ComposerBarProps {
    disabled: boolean;
    dragActive: boolean;
    value: string;
    placeholder: string;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    emojiButtonRef: React.RefObject<HTMLButtonElement | null>;
    onChange: (value: string, caret: number | null) => void;
    onCursorActivity: (caret: number | null) => void;
    onBlur: (event: React.FocusEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
    onDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
    onAttach: () => void;
    // On phones the + opens a menu of where to pick from.
    attachMenu?: boolean;
    // Phones get a send button; elsewhere Enter sends.
    showSend?: boolean;
    // Files waiting to go: they can be sent without any text.
    hasFilesToSend?: boolean;
    onSend?: () => void;
    onToggleEmoji: () => void;
    onToggleGif: () => void;
    emojiPicker: React.ReactNode;
    gifPicker: React.ReactNode;
}

export function ComposerBar({
    disabled,
    dragActive,
    value,
    placeholder,
    textareaRef,
    emojiButtonRef,
    onChange,
    onCursorActivity,
    onBlur,
    onKeyDown,
    onPaste,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onAttach,
    attachMenu = false,
    showSend = false,
    hasFilesToSend = false,
    onSend,
    onToggleEmoji,
    onToggleGif,
    emojiPicker,
    gifPicker,
}: ComposerBarProps): React.ReactElement {
    return (
        <div className="composer-bar">
            <button
                type="button"
                className="composer-plus-button"
                onClick={onAttach}
                disabled={disabled}
                aria-haspopup={attachMenu ? "dialog" : undefined}
                aria-label="Upload attachment"
                title="Upload attachment"
            >
                +
            </button>
            <div
                className={`composer-input-shell${dragActive ? " is-drag-active" : ""}`}
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <textarea
                    ref={textareaRef}
                    className="composer-textarea"
                    value={value}
                    onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
                    onSelect={(event) => onCursorActivity(event.currentTarget.selectionStart)}
                    onClick={(event) => onCursorActivity(event.currentTarget.selectionStart)}
                    onKeyUp={(event) => onCursorActivity(event.currentTarget.selectionStart)}
                    onBlur={onBlur}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    placeholder={placeholder}
                    disabled={disabled}
                    rows={1}
                />
                <div className="composer-input-actions">
                    <div className="composer-emoji-anchor">
                        <button type="button" className="composer-action-button composer-gif-button" onClick={onToggleGif} disabled={disabled} aria-label="Open GIF picker" title="GIF">GIF</button>
                        {gifPicker}
                    </div>
                    <div className="composer-emoji-anchor">
                        <button
                            ref={emojiButtonRef}
                            type="button"
                            className="composer-action-button"
                            onClick={onToggleEmoji}
                            disabled={disabled}
                            aria-label="Open emoji picker"
                            title="Emoji"
                        >
                            {"\u{1F604}"}
                        </button>
                        {emojiPicker}
                    </div>
                </div>
            </div>
            {showSend && (value.trim().length > 0 || hasFilesToSend) ? (
                <button
                    type="button"
                    className="composer-send-button"
                    onClick={onSend}
                    // Keeps the message box focused, so the keyboard stays up for the next message.
                    onMouseDown={(event) => event.preventDefault()}
                    disabled={disabled}
                    aria-label="Send message"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5 12h13" />
                        <path d="M13 6l6 6-6 6" />
                    </svg>
                </button>
            ) : null}
        </div>
    );
}
