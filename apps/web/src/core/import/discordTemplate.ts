import { defaultChannelImportConfig, type ChannelImportConfig, type JsonExport, type JsonExportChannel } from "./importJsonFlow";

// A Discord server template is the layout of a Discord server: its categories, channels and roles, and who can see
// and post in each channel. Its owner shares it as a discord.new link, and Discord gives it to anyone who asks,
// without signing in. It has no messages, members or emoji.

const TEMPLATE_API = "https://discord.com/api/v10/guilds/templates/";
const FETCH_TIMEOUT_MS = 20_000;

// discord.new/<code>, discord.com/template/<code> (also on discordapp.com, ptb. and canary.), or the code alone.
const TEMPLATE_LINK =
    /^(?:https?:\/\/)?(?:www\.)?(?:discord\.new|(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/template)\/([A-Za-z0-9_-]{2,64})\/?(?:[?#].*)?$/i;
const TEMPLATE_CODE = /^[A-Za-z0-9_-]{2,64}$/;

// Discord's channel types. Announcement, forum and media channels come over as text channels, stages as voice ones.
const CATEGORY = 4;
const TEXT_TYPES = new Set([0, 5, 15, 16]);
const VOICE_TYPES = new Set([2, 13]);

const ADMINISTRATOR = 1n << 3n;
const MANAGE_SERVER = 1n << 5n;
// Kick, ban, manage channels, manage messages, manage roles and time out: the rights that make a role a moderator.
const MODERATION = (1n << 1n) | (1n << 2n) | (1n << 4n) | (1n << 13n) | (1n << 28n) | (1n << 40n);
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const ALL_PERMISSIONS = (1n << 64n) - 1n;

interface DiscordOverwrite {
    id: string | number;
    type: number | string;
    allow?: string;
    deny?: string;
}

interface DiscordRole {
    id: string | number;
    name: string;
    permissions?: string;
}

interface DiscordChannel {
    id: string | number;
    type: number;
    name: string;
    position?: number;
    topic?: string | null;
    parent_id?: string | number | null;
    permission_overwrites?: DiscordOverwrite[];
}

export interface DiscordTemplate {
    code: string;
    source_guild_id?: string;
    updated_at?: string;
    serialized_source_guild: {
        name: string;
        description?: string | null;
        roles: DiscordRole[];
        channels: DiscordChannel[];
    };
}

/** A Discord server ready for the JSON importer: its layout, and each channel's settings matched to Discord's. */
export interface DiscordImport {
    exportData: JsonExport;
    channelConfig: Record<string, ChannelImportConfig>;
}

/** Says what went wrong getting a template, in words for the person importing. */
export class DiscordTemplateError extends Error {}

// Templates always have @everyone, but if one didn't, everyone could read and post, as in a new Discord server.
const DEFAULT_EVERYONE: DiscordRole = { id: 0, name: "@everyone", permissions: String(VIEW_CHANNEL | SEND_MESSAGES) };

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasId(value: Record<string, unknown>): boolean {
    return typeof value.id === "string" || typeof value.id === "number";
}

/** The template code in a discord.new link, or in a link to the template on discord.com, or a code on its own. */
export function parseDiscordTemplateCode(input: string): string | null {
    const text = input.trim();
    const link = TEMPLATE_LINK.exec(text);
    if (link) {
        return link[1];
    }
    return TEMPLATE_CODE.test(text) ? text : null;
}

/** The template in Discord's answer, without any channels or roles it couldn't use, or null when there's none. */
export function readDiscordTemplate(raw: unknown): DiscordTemplate | null {
    if (!isRecord(raw) || typeof raw.code !== "string" || !isRecord(raw.serialized_source_guild)) {
        return null;
    }
    const guild = raw.serialized_source_guild;
    if (typeof guild.name !== "string" || !Array.isArray(guild.roles) || !Array.isArray(guild.channels)) {
        return null;
    }
    const roles = guild.roles.filter((role): role is DiscordRole => isRecord(role) && hasId(role) && typeof role.name === "string");
    const channels = guild.channels.filter(
        (channel): channel is DiscordChannel =>
            isRecord(channel) && hasId(channel) && typeof channel.type === "number" && typeof channel.name === "string",
    );
    return {
        code: raw.code,
        source_guild_id: typeof raw.source_guild_id === "string" ? raw.source_guild_id : undefined,
        updated_at: typeof raw.updated_at === "string" ? raw.updated_at : undefined,
        serialized_source_guild: {
            name: guild.name,
            description: typeof guild.description === "string" ? guild.description : null,
            roles,
            channels,
        },
    };
}

/** Gets a template from Discord. Throws a DiscordTemplateError when it can't. */
export async function fetchDiscordTemplate(code: string): Promise<DiscordTemplate> {
    let response: Response;
    try {
        response = await fetch(`${TEMPLATE_API}${encodeURIComponent(code)}`, {
            credentials: "omit",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    } catch {
        throw new DiscordTemplateError("Couldn't reach Discord. Check your connection and try again.");
    }
    if (response.status === 404) {
        throw new DiscordTemplateError("Discord has no template at that link. Check the link, or make a new template.");
    }
    if (response.status === 429) {
        throw new DiscordTemplateError("Discord is getting too many requests. Wait a minute and try again.");
    }
    if (!response.ok) {
        throw new DiscordTemplateError(`Discord couldn't send the template (error ${response.status}). Try again later.`);
    }
    const template = readDiscordTemplate(await response.json().catch(() => null));
    if (!template) {
        throw new DiscordTemplateError("Discord sent a template Jorvik can't read.");
    }
    return template;
}

function bits(value: unknown): bigint {
    try {
        return typeof value === "string" || typeof value === "number" ? BigInt(value) : 0n;
    } catch {
        return 0n;
    }
}

function sameId(a: string | number, b: string | number): boolean {
    return String(a) === String(b);
}

/** What a role can do in a channel: everyone's and the role's own rights, then the channel's changes to them. */
function permissionsIn(channel: DiscordChannel, role: DiscordRole, everyone: DiscordRole): bigint {
    let allowed = bits(everyone.permissions) | bits(role.permissions);
    if ((allowed & ADMINISTRATOR) !== 0n) {
        return ALL_PERMISSIONS;
    }
    const overwrites = channel.permission_overwrites ?? [];
    for (const target of role === everyone ? [everyone] : [everyone, role]) {
        // Type 0 changes a role's rights. Templates have no changes for single members, which are type 1.
        const overwrite = overwrites.find((o) => (o.type === 0 || o.type === "role") && sameId(o.id, target.id));
        if (overwrite) {
            allowed = (allowed & ~bits(overwrite.deny)) | bits(overwrite.allow);
        }
    }
    return allowed;
}

/** The Jorvik rank closest to a role's rights across the server: admin, moderator or member. */
function roleRank(role: DiscordRole, everyone: DiscordRole): 0 | 50 | 100 {
    const allowed = bits(everyone.permissions) | bits(role.permissions);
    if ((allowed & (ADMINISTRATOR | MANAGE_SERVER)) !== 0n) {
        return 100;
    }
    return (allowed & MODERATION) !== 0n ? 50 : 0;
}

function canSee(allowed: bigint): boolean {
    return (allowed & VIEW_CHANNEL) !== 0n;
}

function canPost(allowed: bigint): boolean {
    return canSee(allowed) && (allowed & SEND_MESSAGES) !== 0n;
}

/**
 * Who can join and post in a channel, to match Discord. A channel everyone could see is open for anyone to join, and
 * the rest are invite-only. Jorvik decides who can post by rank, not role, so when only some roles could post, it's the
 * lowest of their ranks. Where everyone could read, though, a member role that could post still makes it moderators:
 * otherwise everyone could post where Discord let only that role.
 */
function channelConfigFor(channel: DiscordChannel, roles: DiscordRole[], everyone: DiscordRole): ChannelImportConfig {
    const config = defaultChannelImportConfig();
    const everyoneAllowed = permissionsIn(channel, everyone, everyone);
    config.isPublic = canSee(everyoneAllowed);
    // Voice channels have no chat to post in.
    if (VOICE_TYPES.has(channel.type) || canPost(everyoneAllowed)) {
        return config;
    }
    const ranks = roles
        .filter((role) => role !== everyone && canPost(permissionsIn(channel, role, everyone)))
        .map((role) => roleRank(role, everyone));
    config.minPL = !config.isPublic && ranks.includes(0) ? 0 : ranks.some((rank) => rank <= 50) ? 50 : 100;
    return config;
}

function compareIds(a: string | number, b: string | number): number {
    const x = String(a);
    const y = String(b);
    return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

function byPosition(a: DiscordChannel, b: DiscordChannel): number {
    return (a.position ?? 0) - (b.position ?? 0) || compareIds(a.id, b.id);
}

/** Turns a template into what the JSON importer takes, with each channel set up to match Discord. */
export function discordTemplateToImport(template: DiscordTemplate): DiscordImport {
    const guild = template.serialized_source_guild;
    const everyone = guild.roles.find((role) => sameId(role.id, 0) || role.name === "@everyone") ?? DEFAULT_EVERYONE;
    const isVoice = (channel: DiscordChannel): boolean => VOICE_TYPES.has(channel.type);

    const categories = guild.channels.filter((channel) => channel.type === CATEGORY).sort(byPosition);
    const categoryIds = new Set(categories.map((category) => String(category.id)));
    // Discord's order: text channels before voice ones, then by position. The importer keeps it within each category.
    const channels = guild.channels
        .filter((channel) => TEXT_TYPES.has(channel.type) || isVoice(channel))
        .sort((a, b) => Number(isVoice(a)) - Number(isVoice(b)) || byPosition(a, b));

    const channelConfig: Record<string, ChannelImportConfig> = {};
    const exportChannels: JsonExportChannel[] = channels.map((channel, index) => {
        const id = String(channel.id);
        const parentId = channel.parent_id === null || channel.parent_id === undefined ? null : String(channel.parent_id);
        channelConfig[id] = channelConfigFor(channel, guild.roles, everyone);
        return {
            id,
            name: channel.name,
            type: isVoice(channel) ? "voice" : "text",
            position: index,
            category_id: parentId !== null && categoryIds.has(parentId) ? parentId : null,
            topic: channel.topic ?? null,
        };
    });

    return {
        exportData: {
            exported_at: template.updated_at ?? new Date().toISOString(),
            guild: { id: template.source_guild_id ?? template.code, name: guild.name, description: guild.description ?? null },
            categories: categories.map((category, index) => ({ id: String(category.id), name: category.name, position: index })),
            channels: exportChannels,
            emojis: [],
        },
        channelConfig,
    };
}
