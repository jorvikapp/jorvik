/** Apple keyboards use Command where others use Ctrl for app shortcuts. */
export function usesCommandKey(): boolean {
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

/** A shortcut with that main key, as this keyboard has it: "Ctrl+K" or "⌘K", "Ctrl+Shift+I" or "⌘⇧I". */
export function commandShortcutLabel(key: string): string {
    return usesCommandKey() ? `⌘${key.replace("Shift+", "⇧")}` : `Ctrl+${key}`;
}
