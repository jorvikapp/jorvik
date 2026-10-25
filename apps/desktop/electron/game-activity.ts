import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Which game is running, for the user's game activity. Steam's game comes from the process Steam
 * starts it under (Linux) or Steam's record of it (Windows, macOS), with its name from the Steam
 * library; anything else is matched by executable name against the list below. Only the game's id and
 * name reach the app, plus the icon Steam keeps of a Steam game, and only while the user shares their
 * activity.
 */

/** "steam-<appid>" for a Steam game; the list's own id otherwise. */
export interface DetectedGame {
    id: string;
    name: string;
}

interface KnownGame extends DetectedGame {
    /** Lower-case executable names, as tasklist, ps or /proc report them. */
    executables: string[];
}

/** Popular games that don't run through Steam: Riot, Epic, Battle.net, Mojang, Roblox and so on. */
export const KNOWN_GAMES: KnownGame[] = [
    { id: "minecraft", name: "Minecraft", executables: ["minecraft.windows.exe"] },
    { id: "league-of-legends", name: "League of Legends", executables: ["league of legends.exe", "leagueoflegends"] },
    { id: "valorant", name: "VALORANT", executables: ["valorant-win64-shipping.exe"] },
    { id: "fortnite", name: "Fortnite", executables: ["fortniteclient-win64-shipping.exe"] },
    { id: "roblox", name: "Roblox", executables: ["robloxplayerbeta.exe", "robloxplayer"] },
    { id: "genshin-impact", name: "Genshin Impact", executables: ["genshinimpact.exe"] },
    { id: "honkai-star-rail", name: "Honkai: Star Rail", executables: ["starrail.exe"] },
    { id: "osu", name: "osu!", executables: ["osu!.exe", "osu!"] },
    { id: "overwatch-2", name: "Overwatch 2", executables: ["overwatch.exe"] },
    { id: "wow", name: "World of Warcraft", executables: ["wow.exe", "world of warcraft"] },
    { id: "hearthstone", name: "Hearthstone", executables: ["hearthstone.exe", "hearthstone"] },
    { id: "diablo-iv", name: "Diablo IV", executables: ["diablo iv.exe"] },
    { id: "rocket-league", name: "Rocket League", executables: ["rocketleague.exe"] },
    { id: "apex-legends", name: "Apex Legends", executables: ["r5apex.exe"] },
    { id: "fall-guys", name: "Fall Guys", executables: ["fallguys_client_game.exe"] },
    { id: "gta-v", name: "Grand Theft Auto V", executables: ["gta5.exe", "gta5_enhanced.exe"] },
];

const MINECRAFT: DetectedGame = { id: "minecraft", name: "Minecraft" };

/** Steam's running game id, from registry.vdf (Linux, macOS) or `reg query` (Windows); null when none. */
export function parseRunningAppId(text: string): string | null {
    const vdf = /"RunningAppID"\s+"(\d+)"/i.exec(text);
    if (vdf) {
        return vdf[1] === "0" ? null : vdf[1];
    }
    const reg = /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(text);
    if (reg) {
        const id = parseInt(reg[1], 16);
        return id > 0 ? String(id) : null;
    }
    return null;
}

/**
 * Steam on Linux starts each game as `.../reaper SteamLaunch AppId=<id> -- <the game>`, and that process lasts
 * exactly as long as the game. Returns the id, or null for any other process.
 */
export function steamLaunchAppId(args: string[]): string | null {
    if (!args.includes("SteamLaunch")) {
        return null;
    }
    const id = args.map((arg) => /^AppId=(\d+)$/i.exec(arg)?.[1]).find(Boolean);
    return id && id !== "0" ? id : null;
}

/** The library folders in Steam's libraryfolders.vdf (Windows paths come with doubled backslashes). */
export function parseLibraryFolders(text: string): string[] {
    return [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((match) => match[1].replace(/\\\\/g, "\\"));
}

/** The game's name in a Steam appmanifest_<id>.acf. */
export function parseAppManifestName(text: string): string | null {
    return /"name"\s+"([^"]+)"/.exec(text)?.[1] ?? null;
}

/** Image names from `tasklist /fo csv /nh`, lower-case. */
export function parseTasklist(csv: string): string[] {
    return csv
        .split(/\r?\n/)
        .map((line) => /^"([^"]+)"/.exec(line)?.[1])
        .filter((name): name is string => Boolean(name))
        .map((name) => name.toLowerCase());
}

/** The base name of a path in either style, lower-case. */
export function executableName(file: string): string {
    return file.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

const JAVA_EXECUTABLES = new Set(["java", "javaw", "java.exe", "javaw.exe"]);

/**
 * Minecraft Java Edition: a process whose program is Java itself, with Minecraft in its arguments or
 * window title. Checking the program, not just the text, keeps out anything that merely mentions both.
 */
export function isMinecraftJava(executable: string, details: string): boolean {
    return JAVA_EXECUTABLES.has(executableName(executable)) && /minecraft/i.test(details);
}

/** `ps -axo pid=,<field>=` lines as pid -> value; values may contain spaces. */
export function parsePsColumn(output: string): Map<string, string> {
    const rows = new Map<string, string>();
    for (const line of output.split("\n")) {
        const found = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
        if (found) {
            rows.set(found[1], found[2]);
        }
    }
    return rows;
}

export function matchKnownGame(executables: Iterable<string>): DetectedGame | null {
    const running = new Set(executables);
    const game = KNOWN_GAMES.find((known) => known.executables.some((name) => running.has(name)));
    return game ? { id: game.id, name: game.name } : null;
}

function run(command: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
        execFile(command, args, { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
            resolve(error ? "" : String(stdout));
        });
    });
}

async function readText(file: string): Promise<string> {
    try {
        return await fs.promises.readFile(file, "utf8");
    } catch {
        return "";
    }
}

interface RunningPrograms {
    executables: Set<string>;
    minecraftJava: boolean;
    /** Linux only: the games Steam has started, by app id. */
    steamAppIds: string[];
}

/** Steam's own program, as tasklist and /proc name it. */
const STEAM_CLIENTS = ["steam.exe", "steam"];

/** The game Steam has on record as running: the registry on Windows, registry.vdf elsewhere. */
async function steamRecordedAppId(): Promise<string | null> {
    if (process.platform === "win32") {
        return parseRunningAppId(await run("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "RunningAppID"]));
    }
    const home = os.homedir();
    const registries =
        process.platform === "darwin"
            ? [path.join(home, "Library", "Application Support", "Steam", "registry.vdf")]
            : [path.join(home, ".steam", "registry.vdf"), path.join(home, ".var", "app", "com.valvesoftware.Steam", ".steam", "registry.vdf")];
    for (const registry of registries) {
        const appId = parseRunningAppId(await readText(registry));
        if (appId) {
            return appId;
        }
    }
    return null;
}

/** Where Steam is installed; each install lists its other library folders. */
async function steamRoots(): Promise<string[]> {
    const home = os.homedir();
    if (process.platform === "win32") {
        const steamPath = /SteamPath\s+REG_SZ\s+(.+)/i.exec(await run("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"]));
        return steamPath ? [steamPath[1].trim()] : [];
    }
    if (process.platform === "darwin") {
        return [path.join(home, "Library", "Application Support", "Steam")];
    }
    return [
        path.join(home, ".steam", "steam"),
        path.join(home, ".local", "share", "Steam"),
        path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    ];
}

async function steamGame(running: RunningPrograms): Promise<DetectedGame | null> {
    let appIds = running.steamAppIds;
    // Without a launch process to go by (Windows and macOS have none), use Steam's own record. It can outlive
    // a Steam that crashed mid-game, so on Windows and Linux it only counts while Steam itself is running.
    const steamOpen = process.platform === "darwin" || STEAM_CLIENTS.some((name) => running.executables.has(name));
    if (appIds.length === 0 && steamOpen) {
        const recorded = await steamRecordedAppId();
        appIds = recorded ? [recorded] : [];
    }
    if (appIds.length === 0) {
        return null;
    }
    for (const root of await steamRoots()) {
        const libraries = new Set([root, ...parseLibraryFolders(await readText(path.join(root, "steamapps", "libraryfolders.vdf")))]);
        for (const appId of appIds) {
            for (const library of libraries) {
                const name = parseAppManifestName(await readText(path.join(library, "steamapps", `appmanifest_${appId}.acf`)));
                if (name) {
                    return { id: `steam-${appId}`, name };
                }
            }
        }
    }
    return null;
}

/** Steam's app id for a game named "steam-<appid>"; null for any other game. */
export function steamAppIdOf(gameId: string): string | null {
    return /^steam-(\d{1,10})$/.exec(gameId)?.[1] ?? null;
}

/** Steam's own library cache names a game's icon by its hash: librarycache/<appid>/<sha1>.jpg. */
const STEAM_ICON_FILE = /^[0-9a-f]{40}\.jpg$/i;
/** Steam's icons are a few kilobytes; a file much bigger than that isn't one. */
const MAX_STEAM_ICON_BYTES = 512 * 1024;

/**
 * The icon files Steam keeps of a game for its library list, newest first: in the game's own folder in
 * Steam's library cache, or as <appid>_icon.jpg in the cache itself on a Steam from before that layout.
 * Empty when Steam hasn't kept one.
 */
export async function steamIconFiles(appId: string): Promise<string[]> {
    const found: { file: string; modified: number }[] = [];
    for (const root of await steamRoots()) {
        const cache = path.join(root, "appcache", "librarycache");
        const folder = path.join(cache, appId);
        let names: string[] = [];
        try {
            names = await fs.promises.readdir(folder);
        } catch {
            // An older Steam, or no Steam here.
        }
        const candidates = [
            ...names.filter((name) => STEAM_ICON_FILE.test(name)).map((name) => path.join(folder, name)),
            path.join(cache, `${appId}_icon.jpg`),
        ];
        for (const file of candidates) {
            try {
                const stat = await fs.promises.stat(file);
                if (stat.isFile() && stat.size > 0 && stat.size <= MAX_STEAM_ICON_BYTES) {
                    found.push({ file, modified: stat.mtimeMs });
                }
            } catch {
                // Not there.
            }
        }
        if (found.length > 0) {
            break;
        }
    }
    return found.sort((left, right) => right.modified - left.modified).map((entry) => entry.file);
}

async function runningPrograms(): Promise<RunningPrograms> {
    if (process.platform === "win32") {
        const names = parseTasklist(await run("tasklist", ["/fo", "csv", "/nh"]));
        let minecraftJava = false;
        if (names.includes("javaw.exe")) {
            // Only verbose tasklist shows window titles, so ask for it just for Java.
            const verbose = await run("tasklist", ["/v", "/fo", "csv", "/nh", "/fi", "imagename eq javaw.exe"]);
            minecraftJava = isMinecraftJava("javaw.exe", verbose);
        }
        return { executables: new Set(names), minecraftJava, steamAppIds: [] };
    }
    if (process.platform === "darwin") {
        const programs = parsePsColumn(await run("ps", ["-axo", "pid=,comm="]));
        const commandLines = parsePsColumn(await run("ps", ["-axww", "-o", "pid=,args="]));
        const minecraftJava = [...programs].some(([pid, program]) => isMinecraftJava(program, commandLines.get(pid) ?? ""));
        return { executables: new Set([...programs.values()].map(executableName)), minecraftJava, steamAppIds: [] };
    }
    // Linux: Wine and Proton games show up with their Windows .exe among the arguments.
    const executables = new Set<string>();
    const steamAppIds: string[] = [];
    let minecraftJava = false;
    let pids: string[] = [];
    try {
        pids = (await fs.promises.readdir("/proc")).filter((entry) => /^\d+$/.test(entry));
    } catch {
        return { executables, minecraftJava, steamAppIds };
    }
    for (const pid of pids) {
        const args = (await readText(`/proc/${pid}/cmdline`)).split("\0").filter(Boolean);
        if (args.length === 0) {
            continue;
        }
        executables.add(executableName(args[0]));
        for (const arg of args) {
            if (/\.exe$/i.test(arg)) {
                executables.add(executableName(arg));
            }
        }
        if (!minecraftJava && isMinecraftJava(args[0], args.slice(1).join(" "))) {
            minecraftJava = true;
        }
        const launched = steamLaunchAppId(args);
        if (launched && !steamAppIds.includes(launched)) {
            steamAppIds.push(launched);
        }
    }
    return { executables, minecraftJava, steamAppIds };
}

export async function detectGame(): Promise<DetectedGame | null> {
    const running = await runningPrograms();
    const steam = await steamGame(running);
    if (steam) {
        return steam;
    }
    return running.minecraftJava ? MINECRAFT : matchKnownGame(running.executables);
}

/** Flatpak and Snap keep other programs out of sight, so there is nothing to detect there. */
export function gameActivitySupported(): boolean {
    return !process.env.FLATPAK_ID && !process.env.SNAP;
}

/** Checks for a game every 20 seconds while turned on, and reports when it changes. */
export class GameActivityWatcher {
    private timer: NodeJS.Timeout | null = null;
    private current: DetectedGame | null = null;

    public constructor(
        private readonly onChange: (game: DetectedGame | null) => void,
        private readonly intervalMs = 20_000,
    ) {}

    public get game(): DetectedGame | null {
        return this.current;
    }

    public setEnabled(enabled: boolean): void {
        if (enabled && !this.timer) {
            void this.check();
            this.timer = setInterval(() => void this.check(), this.intervalMs);
        } else if (!enabled && this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            this.update(null);
        }
    }

    private async check(): Promise<void> {
        try {
            this.update(await detectGame());
        } catch {
            // Try again next round.
        }
    }

    private update(game: DetectedGame | null): void {
        if (game?.id !== this.current?.id || game?.name !== this.current?.name) {
            this.current = game;
            this.onChange(game);
        }
    }
}
