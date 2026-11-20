import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { DBusConnection, type DBusValue } from "./dbus";

/**
 * What music is playing, for the user's music activity. It comes from the media controls the system
 * already shows: MPRIS players on Linux, the media overlay's sessions on Windows, and Spotify or Apple
 * Music asked directly on macOS. Music apps count, and so do music sites in a browser; videos don't.
 * Only the player, title, artist and album reach the app, plus the cover when it asks for it, and only
 * while the user shares their music.
 */

export interface MusicPlayer {
    /** Lower-case letters, digits, "-" and "_", like a game id: "spotify", "youtube-music", "firefox". */
    id: string;
    name: string;
}

export interface DetectedTrack {
    /** Changes with the track; the app asks for the cover by it. */
    key: string;
    player: MusicPlayer;
    title: string;
    artist: string | null;
    album: string | null;
}

/** A track as the platform reports it, before it's known to be music. */
export interface RawTrack {
    /** Names the player goes by: MPRIS bus name, desktop entry and identity, or a Windows app id. */
    sources: string[];
    title: string;
    artist: string | null;
    album: string | null;
    /** The page playing it, when the browser says (Plasma's browser integration does). */
    url: string | null;
    /** Where the player keeps the cover: an https:// or file:// address. */
    artUrl: string | null;
}

interface KnownPlayer extends MusicPlayer {
    /** Lower-case names, matched against a source whole or against its parts. */
    names: string[];
}

export const MUSIC_PLAYERS: KnownPlayer[] = [
    { id: "spotify", name: "Spotify", names: ["spotify", "spotifymusic", "com.spotify.client"] },
    { id: "youtube-music", name: "YouTube Music", names: ["youtube-music", "youtubemusic", "youtube music", "ytmdesktop", "pear-desktop", "cinhimbnkkaeohfgghhklpknlkffjgod"] },
    { id: "apple-music", name: "Apple Music", names: ["applemusic", "applemusicwin", "com.apple.music", "itunes"] },
    { id: "cider", name: "Cider", names: ["cider"] },
    { id: "tidal", name: "TIDAL", names: ["tidal", "tidal-hifi"] },
    { id: "deezer", name: "Deezer", names: ["deezer", "deezer-desktop"] },
    { id: "amazon-music", name: "Amazon Music", names: ["amazon music", "amazonmusic"] },
    { id: "qobuz", name: "Qobuz", names: ["qobuz"] },
    { id: "soundcloud", name: "SoundCloud", names: ["soundcloud"] },
    { id: "plexamp", name: "Plexamp", names: ["plexamp"] },
    { id: "rhythmbox", name: "Rhythmbox", names: ["rhythmbox", "org.gnome.rhythmbox3"] },
    { id: "strawberry", name: "Strawberry", names: ["strawberry"] },
    { id: "clementine", name: "Clementine", names: ["clementine"] },
    { id: "elisa", name: "Elisa", names: ["elisa", "org.kde.elisa"] },
    { id: "lollypop", name: "Lollypop", names: ["lollypop"] },
    { id: "amberol", name: "Amberol", names: ["amberol", "io.bassi.amberol"] },
    { id: "audacious", name: "Audacious", names: ["audacious"] },
    { id: "quodlibet", name: "Quod Libet", names: ["quodlibet"] },
    { id: "cmus", name: "cmus", names: ["cmus"] },
    { id: "mpd", name: "MPD", names: ["mpd", "mpdris2"] },
    { id: "tauon", name: "Tauon", names: ["tauon", "tauonmb"] },
    { id: "feishin", name: "Feishin", names: ["feishin"] },
    { id: "foobar2000", name: "foobar2000", names: ["foobar2000"] },
    { id: "musicbee", name: "MusicBee", names: ["musicbee"] },
    { id: "aimp", name: "AIMP", names: ["aimp"] },
    { id: "winamp", name: "Winamp", names: ["winamp"] },
];

/** Browsers: what they play counts as music only on a music site, or when it comes with an album. */
export const BROWSERS: KnownPlayer[] = [
    { id: "firefox", name: "Firefox", names: ["firefox", "firefox-esr", "org.mozilla.firefox", "308046b0af4a39cb"] },
    { id: "librewolf", name: "LibreWolf", names: ["librewolf"] },
    { id: "zen", name: "Zen", names: ["zen", "zen-browser"] },
    { id: "chrome", name: "Chrome", names: ["chrome", "google-chrome"] },
    { id: "chromium", name: "Chromium", names: ["chromium", "chromium-browser"] },
    { id: "brave", name: "Brave", names: ["brave", "brave-browser"] },
    { id: "edge", name: "Edge", names: ["msedge", "microsoft-edge"] },
    { id: "vivaldi", name: "Vivaldi", names: ["vivaldi"] },
    { id: "opera", name: "Opera", names: ["opera"] },
    { id: "plasma-browser", name: "a browser", names: ["plasma-browser-integration"] },
];

/** Players that are mostly for video: their audio never counts. */
const VIDEO_PLAYERS = ["vlc", "mpv", "celluloid", "totem", "kodi", "smplayer", "haruna", "mplayer", "stremio", "freetube", "jellyfin", "showtime", "videos"];

/** Music sites, for a browser that says which page is playing. */
const MUSIC_SITES: { host: RegExp; player: MusicPlayer }[] = [
    { host: /^music\.youtube\.com$/, player: { id: "youtube-music", name: "YouTube Music" } },
    { host: /^open\.spotify\.com$/, player: { id: "spotify", name: "Spotify" } },
    { host: /(^|\.)soundcloud\.com$/, player: { id: "soundcloud", name: "SoundCloud" } },
    { host: /^music\.apple\.com$/, player: { id: "apple-music", name: "Apple Music" } },
    { host: /^(listen|app)\.tidal\.com$/, player: { id: "tidal", name: "TIDAL" } },
    { host: /(^|\.)deezer\.com$/, player: { id: "deezer", name: "Deezer" } },
    { host: /(^|\.)bandcamp\.com$/, player: { id: "bandcamp", name: "Bandcamp" } },
    { host: /^music\.amazon\.[a-z.]+$/, player: { id: "amazon-music", name: "Amazon Music" } },
    { host: /(^|\.)qobuz\.com$/, player: { id: "qobuz", name: "Qobuz" } },
];

const MAX_TEXT = 128;
const MAX_COVER_BYTES = 4 * 1024 * 1024;

function nameParts(source: string): string[] {
    const lower = source.toLowerCase().trim();
    // "org.mpris.MediaPlayer2.firefox.instance_1_42" -> "firefox"
    const bare = lower.replace(/^org\.mpris\.mediaplayer2\./, "").replace(/\.instance[_0-9]*$/, "").replace(/\.exe$/, "");
    return [lower, bare, ...bare.split(/[.!_\s/\\]+/), ...bare.split(/[.!_\s/\\-]+/)].filter(Boolean);
}

function findPlayer(list: KnownPlayer[], sources: string[]): KnownPlayer | null {
    const parts = new Set(sources.flatMap(nameParts));
    return list.find((player) => player.names.some((name) => parts.has(name))) ?? null;
}

function cleanText(value: string | null | undefined): string | null {
    // eslint-disable-next-line no-control-regex
    const text = (value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT).trim();
    return text || null;
}

function siteOf(url: string | null): MusicPlayer | null | undefined {
    if (!url) {
        return undefined;
    }
    try {
        const host = new URL(url).hostname.toLowerCase();
        return MUSIC_SITES.find((site) => site.host.test(host))?.player ?? null;
    } catch {
        return undefined;
    }
}

/** The player behind a track when the track is music; null for videos and players we don't take for music. */
export function musicPlayerOf(track: RawTrack): MusicPlayer | null {
    const known = findPlayer(MUSIC_PLAYERS, track.sources);
    if (known) {
        return { id: known.id, name: known.name };
    }
    const browser = findPlayer(BROWSERS, track.sources);
    if (browser) {
        const site = siteOf(track.url);
        if (site !== undefined) {
            return site; // The page is known: a music site, or something else (a video).
        }
        // YouTube Music, SoundCloud and the like name an album; a video on YouTube doesn't.
        return cleanText(track.album) && cleanText(track.artist) ? { id: browser.id, name: browser.name } : null;
    }
    const parts = new Set(track.sources.flatMap(nameParts));
    if (VIDEO_PLAYERS.some((name) => parts.has(name))) {
        return null;
    }
    // Some other player: music when it reads like a song from an album.
    const name = cleanText(track.sources.find((source) => !source.startsWith("org.mpris.")) ?? null);
    const id = name
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    return id && name && cleanText(track.album) && cleanText(track.artist) ? { id, name } : null;
}

/** "Rap God | YouTube Music" -> "Rap God": a browser without the page's song details sends the tab's title. */
function withoutSiteName(title: string, playerName: string): string {
    const names = [playerName, ...MUSIC_SITES.map((site) => site.player.name)];
    for (const name of names) {
        for (const separator of [" | ", " - ", " – ", " — ", " · "]) {
            const suffix = `${separator}${name}`;
            if (title.length > suffix.length && title.toLowerCase().endsWith(suffix.toLowerCase())) {
                return title.slice(0, -suffix.length).trim();
            }
        }
    }
    return title;
}

/**
 * Apple Music's tab titles name the artist: "Rap God - Song with Lyrics by Eminem" -> song "Rap God", artist "Eminem".
 * Also "- Song by", "- Single by", "- EP by" and "- Album by".
 */
const APPLE_MUSIC_TAB_TITLE = /^(.+?) - (?:Song|Single|EP|Album)(?: with Lyrics)? by (.+)$/i;

/** The track as the app gets it, when it is music. */
export function toDetectedTrack(raw: RawTrack): DetectedTrack | null {
    const player = musicPlayerOf(raw);
    const fullTitle = cleanText(raw.title);
    if (!player || !fullTitle) {
        return null;
    }
    let artist = cleanText(raw.artist);
    const album = cleanText(raw.album);
    let title = withoutSiteName(fullTitle, player.name);
    const apple = !artist && player.id === "apple-music" ? APPLE_MUSIC_TAB_TITLE.exec(title) : null;
    if (apple) {
        title = apple[1].trim();
        artist = apple[2].trim();
    }
    return { key: [player.id, title, artist ?? "", album ?? ""].join("\u0000"), player, title, artist, album };
}

/**
 * Of several things playing, the one to show: music apps before browsers, and of browsers one that names the artist.
 * Firefox on KDE shows up twice for the same tab: Firefox itself with only the tab's title, and Plasma's browser
 * integration with the song, artist, album and cover.
 */
export function pickTrack(tracks: RawTrack[]): { track: DetectedTrack; raw: RawTrack } | null {
    let fallback: { track: DetectedTrack; raw: RawTrack } | null = null;
    for (const raw of tracks) {
        const track = toDetectedTrack(raw);
        if (!track) {
            continue;
        }
        if (!findPlayer(BROWSERS, raw.sources)) {
            return { track, raw };
        }
        if (!fallback || (!fallback.track.artist && track.artist)) {
            fallback = { track, raw };
        }
    }
    return fallback;
}

// --- Linux: MPRIS over D-Bus ---

function text(value: DBusValue | undefined): string | null {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        const names = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
        return names.length > 0 ? names.join(", ") : null;
    }
    return null;
}

/** An MPRIS player's Metadata and names as a track; null unless it's playing. */
export function mprisTrack(busName: string, player: { [key: string]: DBusValue }, names: (string | null)[]): RawTrack | null {
    if (player.PlaybackStatus !== "Playing") {
        return null;
    }
    const metadata = (player.Metadata && typeof player.Metadata === "object" && !Array.isArray(player.Metadata)
        ? player.Metadata
        : {}) as { [key: string]: DBusValue };
    const title = text(metadata["xesam:title"]);
    if (!title) {
        return null;
    }
    return {
        sources: [busName, ...names.filter((name): name is string => Boolean(name))],
        title,
        artist: text(metadata["xesam:artist"]) ?? text(metadata["xesam:albumArtist"]),
        album: text(metadata["xesam:album"]),
        url: text(metadata["xesam:url"]),
        artUrl: text(metadata["mpris:artUrl"]),
    };
}

const MPRIS_PATH = "/org/mpris/MediaPlayer2";

async function mprisProperty(bus: DBusConnection, busName: string, iface: string, name: string): Promise<string | null> {
    try {
        const [value] = await bus.call({
            destination: busName,
            path: MPRIS_PATH,
            interface: "org.freedesktop.DBus.Properties",
            member: "Get",
            args: [iface, name],
        });
        return typeof value === "string" ? value : null;
    } catch {
        return null;
    }
}

export async function linuxTracks(bus: DBusConnection): Promise<RawTrack[]> {
    const [names] = await bus.call({
        destination: "org.freedesktop.DBus",
        path: "/org/freedesktop/DBus",
        interface: "org.freedesktop.DBus",
        member: "ListNames",
    });
    const players = (Array.isArray(names) ? names : []).filter(
        (name): name is string => typeof name === "string" && name.startsWith("org.mpris.MediaPlayer2."),
    );
    const tracks: RawTrack[] = [];
    for (const busName of players) {
        try {
            const [properties] = await bus.call({
                destination: busName,
                path: MPRIS_PATH,
                interface: "org.freedesktop.DBus.Properties",
                member: "GetAll",
                args: ["org.mpris.MediaPlayer2.Player"],
            });
            if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
                continue;
            }
            if (properties.PlaybackStatus !== "Playing") {
                continue;
            }
            const identity = await mprisProperty(bus, busName, "org.mpris.MediaPlayer2", "Identity");
            const desktopEntry = await mprisProperty(bus, busName, "org.mpris.MediaPlayer2", "DesktopEntry");
            const track = mprisTrack(busName, properties, [desktopEntry, identity]);
            if (track) {
                tracks.push(track);
            }
        } catch {
            // A player that doesn't answer is skipped.
        }
    }
    return tracks;
}

// --- Windows: the media sessions the volume overlay shows, through PowerShell ---

/**
 * Runs once and answers on stdin: "poll" gets a JSON line of the sessions playing now, "cover <app>"
 * the base64 thumbnail of that app's track (or an empty line).
 */
export const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${"`"}1' } | Select-Object -First 1
function Await($operation, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    $null = $task.Wait(5000)
    $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = Await ($managerType::RequestAsync()) $managerType
$playing = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null -or $line -eq 'quit') { break }
    try {
        if ($line -eq 'poll') {
            $sessions = @()
            foreach ($session in $manager.GetSessions()) {
                try {
                    if ($session.GetPlaybackInfo().PlaybackStatus -ne $playing) { continue }
                    $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
                    $sessions += [pscustomobject]@{ app = $session.SourceAppUserModelId; title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle }
                } catch {}
            }
            [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($sessions)))
        } elseif ($line.StartsWith('cover ')) {
            $app = $line.Substring(6)
            $out = ''
            foreach ($session in $manager.GetSessions()) {
                if ($session.SourceAppUserModelId -ne $app) { continue }
                $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
                if ($props.Thumbnail -eq $null) { break }
                $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                if ($stream.Size -gt 0 -and $stream.Size -le ${MAX_COVER_BYTES}) {
                    $reader = [Windows.Storage.Streams.DataReader]::new($stream)
                    $null = Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
                    $bytes = New-Object byte[] ([int]$stream.Size)
                    $reader.ReadBytes($bytes)
                    $out = [Convert]::ToBase64String($bytes)
                }
                break
            }
            [Console]::Out.WriteLine($out)
        } else {
            [Console]::Out.WriteLine('')
        }
    } catch {
        [Console]::Out.WriteLine('')
    }
    [Console]::Out.Flush()
}
`;

export function parseWindowsSessions(line: string): RawTrack[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return [];
    }
    const sessions = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
    return sessions.flatMap((session: unknown) => {
        const { app, title, artist, album } = (session ?? {}) as Record<string, unknown>;
        if (typeof app !== "string" || typeof title !== "string" || !title.trim()) {
            return [];
        }
        return [{
            sources: [app],
            title,
            artist: typeof artist === "string" ? artist : null,
            album: typeof album === "string" ? album : null,
            url: null,
            artUrl: null,
        }];
    });
}

/** One long-lived PowerShell answering one request at a time. */
class WindowsMediaHelper {
    private child: ChildProcessWithoutNullStreams | null = null;
    private buffered = "";
    private waiting: ((line: string | null) => void)[] = [];
    private queue: Promise<unknown> = Promise.resolve();

    private start(): ChildProcessWithoutNullStreams {
        if (this.child) {
            return this.child;
        }
        const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            this.buffered += chunk;
            let newline = this.buffered.indexOf("\n");
            while (newline >= 0) {
                const line = this.buffered.slice(0, newline).replace(/\r$/, "");
                this.buffered = this.buffered.slice(newline + 1);
                this.waiting.shift()?.(line);
                newline = this.buffered.indexOf("\n");
            }
        });
        child.stderr.resume();
        const gone = (): void => {
            if (this.child === child) {
                this.child = null;
                this.buffered = "";
                for (const resolve of this.waiting.splice(0)) resolve(null);
            }
        };
        child.on("exit", gone);
        child.on("error", gone);
        this.child = child;
        return child;
    }

    /** One request and its answer line; null when PowerShell isn't there or took too long. */
    public request(command: string, timeoutMs = 10_000): Promise<string | null> {
        const run = (): Promise<string | null> =>
            new Promise((resolve) => {
                let child: ChildProcessWithoutNullStreams;
                try {
                    child = this.start();
                } catch {
                    resolve(null);
                    return;
                }
                const timer = setTimeout(() => {
                    // A wedged helper is replaced on the next request.
                    this.stop();
                    resolve(null);
                }, timeoutMs);
                this.waiting.push((line) => {
                    clearTimeout(timer);
                    resolve(line);
                });
                child.stdin.write(`${command.replace(/[\r\n]/g, " ")}\n`);
            });
        const result = this.queue.then(run, run);
        this.queue = result.catch(() => undefined);
        return result;
    }

    public stop(): void {
        const child = this.child;
        this.child = null;
        this.buffered = "";
        for (const resolve of this.waiting.splice(0)) resolve(null);
        if (child) {
            child.stdin.end("quit\n");
            setTimeout(() => child.kill(), 1_000).unref();
        }
    }
}

// --- macOS: Spotify and Apple Music, asked with AppleScript ---

export const MAC_APPS = [
    { process: "/Spotify.app/", app: "Spotify", player: { id: "spotify", name: "Spotify" }, artwork: "artwork url of current track" },
    { process: "/Music.app/", app: "Music", player: { id: "apple-music", name: "Apple Music" }, artwork: null },
];

function run(command: string, args: string[], timeoutMs = 5_000): Promise<string> {
    return new Promise((resolve) => {
        execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (_error, stdout) =>
            resolve(typeof stdout === "string" ? stdout : ""),
        );
    });
}

export function parseAppleScriptTrack(output: string, sourceName: string): RawTrack | null {
    const [title, artist, album, artUrl] = output.replace(/\r?\n$/, "").split("\t");
    if (!title?.trim()) {
        return null;
    }
    return { sources: [sourceName], title, artist: artist || null, album: album || null, url: null, artUrl: artUrl || null };
}

/** The AppleScript that asks one app for its playing track: tab-separated title, artist, album, cover address. */
export function appleScriptFor(entry: (typeof MAC_APPS)[number]): string {
    const fields = ["name of current track", "artist of current track", "album of current track", entry.artwork ?? '""'];
    return `tell application "${entry.app}"
if player state is playing then
return ${fields.map((field) => `(${field} as text)`).join(" & tab & ")}
end if
end tell
return ""`;
}

async function macTracks(): Promise<RawTrack[]> {
    // Asking an app that isn't running would start it, so only running ones are asked.
    const processes = await run("ps", ["-axo", "comm="]);
    const tracks: RawTrack[] = [];
    for (const entry of MAC_APPS) {
        if (!processes.includes(entry.process)) {
            continue;
        }
        const track = parseAppleScriptTrack(await run("osascript", ["-e", appleScriptFor(entry)]), entry.player.id === "spotify" ? "spotify" : "com.apple.music");
        if (track) {
            tracks.push(track);
        }
    }
    return tracks;
}

// --- Covers ---

/** The bytes of a cover from where the player keeps it; null when there is none or it's too big. */
export async function readCover(artUrl: string | null): Promise<Buffer | null> {
    if (!artUrl) {
        return null;
    }
    try {
        if (artUrl.startsWith("file://")) {
            const file = fileURLToPath(artUrl);
            const stat = await fs.promises.stat(file);
            return stat.isFile() && stat.size > 0 && stat.size <= MAX_COVER_BYTES ? await fs.promises.readFile(file) : null;
        }
        if (artUrl.startsWith("https://")) {
            const response = await fetch(artUrl, { signal: AbortSignal.timeout(8_000), redirect: "follow" });
            if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_COVER_BYTES) {
                return null;
            }
            const bytes = Buffer.from(await response.arrayBuffer());
            return bytes.length > 0 && bytes.length <= MAX_COVER_BYTES ? bytes : null;
        }
    } catch {
        // No cover, then.
    }
    return null;
}

// --- Watching ---

/** Flatpak can read players when its manifest lets it; Snap can't see them. */
export function musicActivitySupported(): boolean {
    return !process.env.SNAP && ["linux", "win32", "darwin"].includes(process.platform);
}

/**
 * Checks what's playing every few seconds while turned on, and reports when the track changes. A short
 * pause or a gap between tracks doesn't count as stopping.
 */
export class MusicActivityWatcher {
    private timer: NodeJS.Timeout | null = null;
    private current: { track: DetectedTrack; raw: RawTrack } | null = null;
    private misses = 0;
    private bus: DBusConnection | null = null;
    private readonly windows = process.platform === "win32" ? new WindowsMediaHelper() : null;
    private checking = false;

    public constructor(
        private readonly onChange: (track: DetectedTrack | null) => void,
        private readonly intervalMs = process.platform === "darwin" ? 10_000 : 5_000,
        /** Checks in a row that find nothing before the music counts as stopped. */
        private readonly missesToStop = 3,
        private readonly readTracks?: () => Promise<RawTrack[]>,
    ) {}

    public get track(): DetectedTrack | null {
        return this.current?.track ?? null;
    }

    public setEnabled(enabled: boolean): void {
        if (enabled && !this.timer) {
            void this.check();
            this.timer = setInterval(() => void this.check(), this.intervalMs);
        } else if (!enabled && this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            this.bus?.close();
            this.bus = null;
            this.windows?.stop();
            this.misses = 0;
            this.update(null);
        }
    }

    /** The cover of the track playing now, as the player keeps it; null for any other track. */
    public async cover(key: string): Promise<Buffer | null> {
        const current = this.current;
        if (!current || current.track.key !== key) {
            return null;
        }
        if (this.windows) {
            const line = await this.windows.request(`cover ${current.raw.sources[0]}`);
            if (!line) {
                return null;
            }
            const bytes = Buffer.from(line, "base64");
            return bytes.length > 0 && bytes.length <= MAX_COVER_BYTES ? bytes : null;
        }
        return readCover(current.raw.artUrl);
    }

    private async tracks(): Promise<RawTrack[]> {
        if (this.readTracks) {
            return this.readTracks();
        }
        if (process.platform === "linux") {
            if (!this.bus || this.bus.isClosed) {
                this.bus = await DBusConnection.connectSession();
            }
            return linuxTracks(this.bus);
        }
        if (this.windows) {
            const line = await this.windows.request("poll");
            return line === null ? [] : parseWindowsSessions(line);
        }
        if (process.platform === "darwin") {
            return macTracks();
        }
        return [];
    }

    private async check(): Promise<void> {
        if (this.checking) {
            return;
        }
        this.checking = true;
        try {
            const found = pickTrack(await this.tracks());
            if (!this.timer) {
                return; // Turned off meanwhile.
            }
            if (found) {
                this.misses = 0;
                this.update(found);
            } else if (this.current) {
                this.misses += 1;
                if (this.misses >= this.missesToStop) {
                    this.update(null);
                }
            }
        } catch {
            // Try again next round.
        } finally {
            this.checking = false;
        }
    }

    private update(found: { track: DetectedTrack; raw: RawTrack } | null): void {
        const changed = found?.track.key !== this.current?.track.key;
        if (found && !changed) {
            this.current = found; // The same track; keep its cover address current.
            return;
        }
        this.current = found;
        if (changed) {
            this.onChange(found?.track ?? null);
        }
    }
}
