import { webLinkHref } from "../../core/users/profileLinks";

/**
 * Where a status message points when the whole message is one web address; null for anything else.
 * Only http and https: a status can never open another kind of link.
 */
export function statusLinkHref(statusMessage: string | null | undefined): string | null {
    return webLinkHref(statusMessage);
}
