import React from "react";

import { describeProfileLink } from "../../../../core/users/profileLinks";

/** Someone's links (Twitch, YouTube, a website...), each opening in the browser; nothing when they have none. */
export function LinksCard({ links }: { links: string[] }): React.ReactElement | null {
    if (links.length === 0) {
        return null;
    }
    return (
        <section className="rp-card">
            <header className="rp-card-header">
                <h3 className="rp-card-title">Links</h3>
            </header>
            <ul className="rp-links">
                {links.map((href) => {
                    const link = describeProfileLink(href);
                    return (
                        <li key={href}>
                            <a className="rp-link" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href}>
                                <span className={`rp-link-site is-${link.kind}`}>{link.site}</span>
                                <span className="rp-link-label">{link.label}</span>
                                <span className="rp-link-open" aria-hidden="true">
                                    ↗
                                </span>
                            </a>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
