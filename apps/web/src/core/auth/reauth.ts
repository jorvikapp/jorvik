import { Method, type MatrixClient } from "matrix-js-sdk/src/matrix";

/**
 * Some requests need people to show it's them again (signing out another session, replacing their
 * signing keys). The server answers 401 with the ways it accepts and a session to finish them in.
 * Jorvik does one step: the account password, single sign-on on the server's own page, or, on servers
 * where the account lives in Matrix Authentication Service, approving the change on the account page.
 */

export type ReauthWay =
    | { kind: "password" }
    /** The server's page that goes through single sign-on; the request is then sent again with the session. */
    | { kind: "sso"; url: string }
    /** The account page where the change is approved; the request is then sent again as it was. */
    | { kind: "approve"; url: string };

export type ReauthPageWay = Extract<ReauthWay, { kind: "sso" | "approve" }>;

export interface ReauthChallenge {
    session: string | null;
    /** What the server accepts that Jorvik can do, password first. Empty: nothing Jorvik can do. */
    ways: ReauthWay[];
}

const SSO_STAGES = ["m.login.sso", "org.matrix.login.sso"];
const APPROVE_STAGES = ["org.matrix.cross_signing_reset", "m.oauth"];

interface ChallengeData {
    session?: unknown;
    flows?: unknown;
    params?: unknown;
}

/** The ways the server offers in a 401 that asks to show it's you; null for any other error. */
export function readReauthChallenge(client: MatrixClient, error: unknown): ReauthChallenge | null {
    const failure = error as { httpStatus?: unknown; data?: ChallengeData } | null | undefined;
    const data = failure?.data;
    if (failure?.httpStatus !== 401 || !data || !Array.isArray(data.flows)) {
        return null;
    }

    const session = typeof data.session === "string" && data.session.length > 0 ? data.session : null;
    const params = (data.params && typeof data.params === "object" ? data.params : {}) as Record<string, { url?: unknown } | undefined>;
    // Only flows of a single step.
    const stages = data.flows
        .map((flow) => (flow as { stages?: unknown } | null)?.stages)
        .filter((flowStages): flowStages is unknown[] => Array.isArray(flowStages) && flowStages.length === 1)
        .map((flowStages) => flowStages[0])
        .filter((stage): stage is string => typeof stage === "string");

    const ways: ReauthWay[] = [];
    if (stages.includes("m.login.password")) {
        ways.push({ kind: "password" });
    }
    const ssoStage = SSO_STAGES.find((stage) => stages.includes(stage));
    if (ssoStage && session) {
        ways.push({ kind: "sso", url: client.getFallbackAuthUrl(ssoStage, session) });
    }
    const approveStage = APPROVE_STAGES.find((stage) => stages.includes(stage) && typeof params[stage]?.url === "string");
    if (approveStage) {
        ways.push({ kind: "approve", url: params[approveStage]!.url as string });
    }

    return { session, ways };
}

export function passwordAuth(userId: string, password: string, session: string | null): Record<string, unknown> {
    return {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: userId },
        password,
        ...(session ? { session } : {}),
    };
}

/** What to send again once the step on the server's page is done: the session says the rest. */
export function afterPageAuth(way: ReauthPageWay, session: string | null): Record<string, unknown> | null {
    return way.kind === "sso" && session ? { session } : null;
}

/**
 * The ways the server will want, asked with a request that changes nothing: signing out no sessions.
 * Null when it can't say (some servers don't offer that request).
 */
export async function probeReauthWays(client: MatrixClient): Promise<ReauthWay[] | null> {
    try {
        await client.http.authedRequest(Method.Post, "/delete_devices", undefined, { devices: [] });
        return [];
    } catch (error) {
        return readReauthChallenge(client, error)?.ways ?? null;
    }
}
