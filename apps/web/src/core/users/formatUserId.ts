/**
 * Shortens a Matrix user ID for display when the user is on our own server.
 *
 * `@alice:jorvik.app` renders as `@alice` for a local user, while a remote
 * `@bob:other.org` keeps its domain - the domain is the part that disambiguates
 * them, so dropping it would be misleading. This is the display counterpart of
 * qualifyMatrixUserId, which accepts `@alice` as input for the same reason.
 */
export function formatUserIdForDisplay(
    userId: string | null | undefined,
    localDomain: string | null | undefined,
): string {
    if (!userId) {
        return "";
    }
    if (!localDomain) {
        return userId;
    }

    const separatorIndex = userId.indexOf(":");
    if (separatorIndex < 0) {
        return userId;
    }

    return userId.slice(separatorIndex + 1) === localDomain ? userId.slice(0, separatorIndex) : userId;
}
