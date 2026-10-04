import type { Room } from "matrix-js-sdk/src/matrix";

/**
 * Finding mentions in what someone typed. A full user ID mentions any member
 * of the room; the short form, "@riff", mentions the member with that name on
 * our own homeserver, so people on the same server don't need to type it.
 * Someone on another server keeps the full ID: the short form never reaches
 * across servers, where the same name can belong to someone else.
 */

export interface MentionSpan {
    // Where the mention is in the typed text, without surrounding punctuation.
    start: number;
    end: number;
    userId: string;
}

const LEADING_TRIM = new Set(["(", "[", "{", "<"]);
const TRAILING_TRIM = new Set([")", "]", "}", ">", ".", ",", "!", "?", ";", ":"]);
const SHORT_MENTION_PATTERN = /^@[a-z0-9._=\-/+]+$/i;
const MENTIONABLE_MEMBERSHIPS = new Set(["join", "invite", "knock"]);

export function findMentions(rawText: string, room: Room, localDomain: string | null): MentionSpan[] {
    const spans: MentionSpan[] = [];
    const tokenPattern = /\S+/g;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(rawText)) !== null) {
        let start = match.index;
        let end = start + match[0].length;
        while (start < end && LEADING_TRIM.has(rawText[start])) {
            start += 1;
        }
        while (end > start && TRAILING_TRIM.has(rawText[end - 1])) {
            end -= 1;
        }

        const userId = resolveMention(rawText.slice(start, end), room, localDomain);
        if (userId) {
            spans.push({ start, end, userId });
        }
    }

    return spans;
}

/** What the mention picker types for someone: the short form for people on our server. */
export function mentionText(userId: string, localDomain: string | null): string {
    const separator = userId.indexOf(":");
    if (localDomain && separator > 0 && userId.slice(separator + 1) === localDomain) {
        return userId.slice(0, separator);
    }
    return userId;
}

function resolveMention(token: string, room: Room, localDomain: string | null): string | null {
    if (!token.startsWith("@")) {
        return null;
    }

    let userId: string;
    if (token.includes(":")) {
        userId = token;
    } else if (localDomain && SHORT_MENTION_PATTERN.test(token)) {
        // Names on a homeserver are lowercase, whatever was typed.
        userId = `${token.toLowerCase()}:${localDomain}`;
    } else {
        return null;
    }

    const member = room.getMember(userId);
    return member && MENTIONABLE_MEMBERSHIPS.has(member.membership ?? "") ? userId : null;
}
