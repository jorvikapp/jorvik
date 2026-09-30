import type { User } from "matrix-js-sdk/src/matrix";

/**
 * A user's plain display name, or undefined when none is known.
 *
 * Read this rather than User.displayName. The SDK's store copies each room
 * member's name onto the User, and a member's name becomes "Name (@id:server)"
 * in any room where someone else shares the display name, so displayName
 * flips between the two forms depending on which room was processed last.
 * rawDisplayName keeps the plain name, but starts out as the user ID.
 */
export function plainUserDisplayName(user: User | null | undefined): string | undefined {
    if (!user) {
        return undefined;
    }
    if (user.rawDisplayName && user.rawDisplayName !== user.userId) {
        return user.rawDisplayName;
    }

    const disambiguation = ` (${user.userId})`;
    const displayName = user.displayName?.endsWith(disambiguation)
        ? user.displayName.slice(0, -disambiguation.length)
        : user.displayName;
    return displayName && displayName !== user.userId ? displayName : undefined;
}
