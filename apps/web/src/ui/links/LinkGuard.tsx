import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import { RoomDialog } from "../components/rooms/RoomDialog";
import { isMaskedLink, isTrustedLinkHost, linkHost, trustLinkHost } from "./maskedLinks";

// Shows the warning for a link; null where nothing provides one.
const LinkGuardContext = createContext<((href: string) => void) | null>(null);

/**
 * Asks before opening a link whose text doesn't show where it goes, and shows
 * the real address. Ticking "don't ask again" trusts that site on this device.
 */
export function LinkGuardProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const [pendingHref, setPendingHref] = useState<string | null>(null);
    const [trustSite, setTrustSite] = useState(false);
    const confirmLink = useCallback((href: string): void => {
        setTrustSite(false);
        setPendingHref(href);
    }, []);
    const pendingUrl = useMemo(() => {
        try {
            return pendingHref ? new URL(pendingHref) : null;
        } catch {
            return null;
        }
    }, [pendingHref]);
    const host = pendingHref ? linkHost(pendingHref) : null;
    const close = (): void => setPendingHref(null);
    const open = (): void => {
        if (!pendingUrl) {
            return;
        }
        if (trustSite && host) {
            trustLinkHost(host);
        }
        window.open(pendingUrl.toString(), "_blank", "noopener,noreferrer");
        close();
    };

    return (
        <LinkGuardContext.Provider value={confirmLink}>
            {children}
            <RoomDialog
                open={pendingUrl !== null}
                title="Open this link?"
                onClose={close}
                footer={
                    <>
                        <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={close} autoFocus>
                            Cancel
                        </button>
                        <button type="button" className="room-dialog-button room-dialog-button-primary" onClick={open}>
                            Open link
                        </button>
                    </>
                }
            >
                <p className="link-guard-intro">The text of this link doesn't show where it goes. It opens:</p>
                {pendingUrl ? (
                    <p className="link-guard-url">
                        {host ? (
                            <>
                                {`${pendingUrl.protocol}//${userInfo(pendingUrl)}`}
                                <strong>{pendingUrl.host}</strong>
                                {`${pendingUrl.pathname}${pendingUrl.search}${pendingUrl.hash}`}
                            </>
                        ) : (
                            pendingUrl.href
                        )}
                    </p>
                ) : null}
                {host ? (
                    <label className="link-guard-trust">
                        <input type="checkbox" checked={trustSite} onChange={(event) => setTrustSite(event.target.checked)} />
                        Don't ask again for links to {host}
                    </label>
                ) : null}
            </RoomDialog>
        </LinkGuardContext.Provider>
    );
}

// Anything before an @ in an address is a user name, not the site, though
// it can be made to look like one ("https://example.org@other.site/").
function userInfo(url: URL): string {
    if (!url.username && !url.password) {
        return "";
    }
    return `${url.username}${url.password ? `:${url.password}` : ""}@`;
}

/**
 * A link in a message. It opens outside the app; when its text hides where it
 * goes, Jorvik asks first, and hovering shows the real address.
 */
export function MessageLink({ href, text, children }: { href: string; text: string; children: React.ReactNode }): React.ReactElement {
    const confirmLink = useContext(LinkGuardContext);
    const masked = isMaskedLink(text, href);
    const guard = (event: React.MouseEvent<HTMLAnchorElement>): void => {
        const host = linkHost(href);
        if (!masked || !confirmLink || (host !== null && isTrustedLinkHost(host))) {
            return;
        }
        event.preventDefault();
        confirmLink(href);
    };

    return (
        <a
            className="timeline-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={masked ? href : undefined}
            onClick={guard}
            onAuxClick={(event) => {
                // A middle click opens links too.
                if (event.button === 1) {
                    guard(event);
                }
            }}
        >
            {children}
        </a>
    );
}
