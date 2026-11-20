import React from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { describeProfileLink } from "../../../../core/users/profileLinks";
import { twitchLoginOf } from "../../../../core/users/twitchLive";
import { useTwitchStream } from "./useTwitchStream";

function LinkRow({ client, href }: { client?: MatrixClient | null; href: string }): React.ReactElement {
    const link = describeProfileLink(href);
    const stream = useTwitchStream(client, link.kind === "twitch" ? twitchLoginOf(href) : null);
    const streamText = stream ? [stream.game, stream.title].filter(Boolean).join(" · ") : "";
    return (
        <li>
            <a
                className={`rp-link${stream ? " is-live" : ""}`}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                title={stream ? `Live on Twitch: ${streamText}` : link.href}
            >
                <span className={`rp-link-site is-${link.kind}`}>{link.site}</span>
                <span className="rp-link-main">
                    <span className="rp-link-label">
                        {link.label}
                        {stream ? <span className="rp-link-live">LIVE</span> : null}
                    </span>
                    {streamText ? <span className="rp-link-stream">{streamText}</span> : null}
                </span>
                <span className="rp-link-open" aria-hidden="true">
                    ↗
                </span>
            </a>
        </li>
    );
}

/** Someone's links (Twitch, YouTube, a website...), each opening in the browser; nothing when they have none. */
export function LinksCard({ client, links }: { client?: MatrixClient | null; links: string[] }): React.ReactElement | null {
    if (links.length === 0) {
        return null;
    }
    return (
        <section className="rp-card">
            <header className="rp-card-header">
                <h3 className="rp-card-title">Links</h3>
            </header>
            <ul className="rp-links">
                {links.map((href) => (
                    <LinkRow key={href} client={client} href={href} />
                ))}
            </ul>
        </section>
    );
}
