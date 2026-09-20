/**
 * Unread indicator drawn onto the tray icon.
 *
 * Portable by design: no XDG_CURRENT_DESKTOP checks and nothing KDE-specific.
 * It mirrors the same count the shared setBadgeCount() already receives, so
 * app.setBadgeCount() keeps working wherever LauncherEntry is supported while
 * this provides the indicator anywhere a tray host exists (KDE tray-only,
 * XFCE/Cinnamon/MATE, wlroots panels, GNOME + AppIndicator extension).
 *
 * Also used on Windows, where the taskbar overlay is not enough on its own: a
 * window hidden to the tray has no taskbar button to carry it, which is exactly
 * when the tray icon is the only thing left to show a count on.
 *
 * Not used on macOS, which has the dock badge.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Tray } from 'electron';

const DEBOUNCE_MS = 200; // Matrix sync bursts collapse into one icon swap
const KEEP_FILES = 3; // a lazy tray host must never read a file we deleted

/** Minimal slice of Electron's nativeImage, injectable so this stays unit-testable. */
interface Imaging {
    createFromPath(p: string): {
        isEmpty(): boolean;
        resize(opts: { width: number; height: number }): { toPNG(): Buffer };
    };
}

export interface TrayBadgeOptions {
    /** May be null; every call then becomes a no-op. */
    tray: Tray | null;
    /** Directory holding tray-0.png .. tray-99.png and tray-99plus.png. */
    assetDir: string;
    /**
     * The icon the app itself chose (resolveIconPath()). When the count is 0 this
     * is restored verbatim, so clearing a badge always returns the exact icon the
     * app started with - which matters in dev, where resolveIconPath() falls back
     * to build/icon.png while the badge set is generated from the packaged source.
     */
    baseIconPath?: string;
    /** Writable scratch directory, normally app.getPath('temp'). */
    tmpDir: string;
    /** Rendered size; matches the existing tray sizing in main.ts. */
    iconPx?: number;
    imaging?: Imaging;
}

export class TrayBadge {
    private tray: Tray | null;
    private readonly assetDir: string;
    private readonly baseIconPath: string | null;
    private readonly iconPx: number;
    private readonly injectedImaging?: Imaging;
    private workDir: string | null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pending: number | null = null;
    private applied: number | null = null;
    private seq = 0;
    private recent: string[] = [];
    private disposed = false;
    private imagingCache?: Imaging;

    constructor(opts: TrayBadgeOptions) {
        this.tray = opts.tray ?? null;
        this.assetDir = opts.assetDir;
        this.baseIconPath = opts.baseIconPath ?? null;
        this.iconPx = opts.iconPx ?? 32;
        this.injectedImaging = opts.imaging;
        this.workDir = path.join(opts.tmpDir, `jorvik-tray-${process.pid}`);
        try {
            fs.mkdirSync(this.workDir, { recursive: true });
        } catch {
            this.workDir = null; // fall back to pointing straight at the asset
        }
    }

    /** 0 -> plain icon, 1..99 -> numeric, 100+ -> 99+ */
    static assetFor(n: number): string {
        if (n <= 0) return 'tray-0.png';
        if (n >= 100) return 'tray-99plus.png';
        return `tray-${n}.png`;
    }

    /** Call when the Tray is recreated (some apps rebuild it on theme change). */
    setTray(tray: Tray | null): void {
        this.tray = tray ?? null;
        this.applied = null; // force the next update through
    }

    /** Mirror an unread count onto the tray icon. Safe to call at any rate. */
    update(count: number): void {
        if (this.disposed) return;
        const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
        this.pending = n;
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            const next = this.pending;
            this.pending = null;
            if (next !== null && next !== this.applied) this.apply(next);
        }, DEBOUNCE_MS);
        if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    }

    private imaging(): Imaging {
        if (!this.imagingCache) {
            // Lazy so the module can be imported (and tested) outside Electron.
            this.imagingCache = this.injectedImaging ?? (require('electron').nativeImage as Imaging);
        }
        return this.imagingCache;
    }

    /** Count 0 restores the app's own icon when one was supplied. */
    private sourceFor(n: number): string {
        if (n <= 0 && this.baseIconPath) return this.baseIconPath;
        return path.join(this.assetDir, TrayBadge.assetFor(n));
    }

    private apply(n: number): void {
        const tray = this.tray;
        if (!tray || (tray as any).isDestroyed?.()) return;

        const src = this.sourceFor(n);
        if (!fs.existsSync(src)) return;

        // AppIndicator and several other SNI hosts cache by icon PATH: reusing a
        // filename makes the icon update once and then stop. Every render goes to
        // a fresh path, and older ones are swept a few generations later.
        let target = src;
        if (this.workDir) {
            try {
                const image = this.imaging().createFromPath(src);
                if (image.isEmpty()) return;
                // Resize here rather than shipping 32px assets: the source stays
                // crisp for HiDPI, and the result matches main.ts's tray sizing.
                const png = image.resize({ width: this.iconPx, height: this.iconPx }).toPNG();
                target = path.join(this.workDir, `t${this.seq++}-${TrayBadge.assetFor(n)}`);
                fs.writeFileSync(target, png);
                this.recent.push(target);
                while (this.recent.length > KEEP_FILES) {
                    try {
                        fs.unlinkSync(this.recent.shift() as string);
                    } catch {
                        /* already gone */
                    }
                }
            } catch {
                target = src;
            }
        }

        try {
            tray.setImage(target);
            this.applied = n;
        } catch {
            // a tray that rejects the image must never break the caller
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.workDir) {
            try {
                fs.rmSync(this.workDir, { recursive: true, force: true });
            } catch {
                /* best effort */
            }
        }
    }
}
