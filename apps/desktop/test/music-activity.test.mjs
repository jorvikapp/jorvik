// Music activity (electron/music-activity.ts and electron/dbus.ts), from the compiled dist/electron: npm test builds it.
// The D-Bus test needs dbus-daemon and python3 with dbus and gi; it is skipped without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const music = require("../dist/electron/music-activity.js");
const dbus = require("../dist/electron/dbus.js");
const here = path.dirname(fileURLToPath(import.meta.url));

const raw = (sources, more = {}) => ({ sources, title: "Song", artist: "Artist", album: null, url: null, artUrl: null, ...more });

test("music apps count, whatever their bus name, desktop entry or Windows app id", () => {
    for (const sources of [
        ["org.mpris.MediaPlayer2.spotify", "spotify", "Spotify"],
        ["SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"],
        ["Spotify.exe"],
        ["com.spotify.Client"],
    ]) {
        assert.deepEqual(music.musicPlayerOf(raw(sources)), { id: "spotify", name: "Spotify" }, sources.join());
    }
    assert.equal(music.musicPlayerOf(raw(["org.mpris.MediaPlayer2.tidal-hifi"])).id, "tidal");
    assert.equal(music.musicPlayerOf(raw(["org.mpris.MediaPlayer2.YoutubeMusic", "com.github.th-ch.youtube-music", "YouTube Music"])).id, "youtube-music");
    assert.equal(music.musicPlayerOf(raw(["Chrome._crx_cinhimbnkkaeohfgghhklpknlkffjgod"])).id, "youtube-music");
    assert.equal(music.musicPlayerOf(raw(["AppleInc.AppleMusicWin_nzyj5cx40ttqa!App"])).id, "apple-music");
});

test("a browser counts on a music site, or with an album when it doesn't say the page", () => {
    const firefox = ["org.mpris.MediaPlayer2.firefox.instance_1_83", "firefox", "Mozilla Firefox"];
    assert.deepEqual(music.musicPlayerOf(raw(firefox, { album: "Album" })), { id: "firefox", name: "Firefox" });
    assert.equal(music.musicPlayerOf(raw(firefox)), null, "a YouTube video has no album");
    assert.equal(music.musicPlayerOf(raw(firefox, { album: "Album", artist: null })), null);
    const plasma = ["org.mpris.MediaPlayer2.plasma-browser-integration"];
    assert.equal(music.musicPlayerOf(raw(plasma, { url: "https://music.youtube.com/watch?v=x" })).name, "YouTube Music");
    assert.equal(music.musicPlayerOf(raw(plasma, { url: "https://www.youtube.com/watch?v=x", album: "Album" })), null);
    assert.equal(music.musicPlayerOf(raw(["msedge.exe"], { album: "A" })).id, "edge");
});

test("video players never count; another player does with an artist and album", () => {
    assert.equal(music.musicPlayerOf(raw(["org.mpris.MediaPlayer2.vlc", "vlc", "VLC media player"], { album: "A" })), null);
    assert.equal(music.musicPlayerOf(raw(["org.mpris.MediaPlayer2.mpv", "mpv"], { album: "A" })), null);
    assert.deepEqual(music.musicPlayerOf(raw(["org.mpris.MediaPlayer2.Gapless", "Gapless"], { album: "A" })), { id: "gapless", name: "Gapless" });
    assert.equal(music.musicPlayerOf(raw(["org.mpris.MediaPlayer2.Gapless", "Gapless"])), null);
});

test("music apps win over a browser, and text is cleaned", () => {
    const picked = music.pickTrack([
        raw(["firefox"], { album: "Album", title: "Browser song" }),
        raw(["spotify"], { title: "  Real\nsong ", artist: "A\u0000B" }),
    ]);
    assert.equal(picked.track.player.id, "spotify");
    assert.equal(picked.track.title, "Real song");
    assert.equal(picked.track.artist, "A B");
    assert.equal(music.pickTrack([raw(["vlc"])]), null);
});

test("of two browser entries for one tab, the one with the artist wins, and the site's name leaves the title", () => {
    const url = "https://music.youtube.com/playlist?list=LM";
    const firefox = raw(["org.mpris.MediaPlayer2.firefox.instance_1_1434"], { title: "Rap God | YouTube Music", artist: "", album: "", url });
    const plasma = raw(["org.mpris.MediaPlayer2.plasma-browser-integration"], { title: "Rap God", artist: "Eminem", album: "Rap God", url });
    for (const tracks of [[firefox, plasma], [plasma, firefox]]) {
        const picked = music.pickTrack(tracks);
        assert.equal(picked.track.title, "Rap God");
        assert.equal(picked.track.artist, "Eminem");
        assert.equal(picked.track.player.name, "YouTube Music");
    }
    const alone = music.pickTrack([firefox]).track;
    assert.equal(alone.title, "Rap God");
    assert.equal(alone.artist, null);
    assert.equal(music.toDetectedTrack(raw(["spotify"], { title: "YouTube Music" })).title, "YouTube Music", "a title that is only the name stays");
});

test("Windows sessions and AppleScript output parse", () => {
    const sessions = music.parseWindowsSessions('[{"app":"Spotify.exe","title":"T","artist":"A","album":""}]');
    assert.equal(sessions.length, 1);
    assert.equal(music.parseWindowsSessions('{"app":"Spotify.exe","title":"T"}').length, 1);
    assert.deepEqual(music.parseWindowsSessions("not json"), []);
    const track = music.parseAppleScriptTrack("Song\tArtist\tAlbum\thttps://i.scdn.co/image/x\n", "spotify");
    assert.equal(track.artUrl, "https://i.scdn.co/image/x");
    assert.equal(music.parseAppleScriptTrack("\n", "spotify"), null);
});

test("the session bus address is read like libdbus does", () => {
    assert.equal(dbus.sessionBusPath("unix:path=/run/user/1000/bus"), "/run/user/1000/bus");
    assert.equal(dbus.sessionBusPath("unix:abstract=/tmp/dbus-x,guid=abc"), "\0/tmp/dbus-x");
    assert.equal(dbus.sessionBusPath("tcp:host=x;unix:path=/a%20b"), "/a b");
});

test("the watcher reports a track change, and stopping only after a few empty checks", async () => {
    let tracks = [raw(["spotify"], { title: "One" })];
    const seen = [];
    const watcher = new music.MusicActivityWatcher((track) => seen.push(track?.title ?? null), 20, 2, async () => tracks);
    watcher.setEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    tracks = [raw(["spotify"], { title: "Two" })];
    await new Promise((resolve) => setTimeout(resolve, 50));
    tracks = [];
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(seen, ["One", "Two"], "one empty check isn't a stop");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(seen, ["One", "Two", null]);
    watcher.setEnabled(false);
});

const haveDbus = spawnSync("sh", ["-c", "command -v dbus-daemon && python3 -c 'import dbus, gi'"]).status === 0;

test("reads players from a real session bus", { skip: !haveDbus && "no dbus-daemon or python3 dbus/gi" }, async () => {
    const daemon = spawn("dbus-daemon", ["--session", "--nofork", "--print-address=1"], { stdio: ["ignore", "pipe", "inherit"] });
    const address = await new Promise((resolve) => daemon.stdout.once("data", (chunk) => resolve(String(chunk).trim())));
    const env = { ...process.env, DBUS_SESSION_BUS_ADDRESS: address };
    const players = [];
    const startPlayer = (suffix, spec) =>
        new Promise((resolve, reject) => {
            const child = spawn("python3", [path.join(here, "fixtures/fake-mpris-player.py"), suffix, JSON.stringify(spec)], {
                env,
                stdio: ["ignore", "pipe", "inherit"],
            });
            players.push(child);
            child.stdout.once("data", () => resolve());
            child.once("exit", (code) => reject(new Error(`player exited ${code}`)));
        });
    try {
        await startPlayer("spotify", {
            Identity: "Spotify",
            DesktopEntry: "spotify",
            PlaybackStatus: "Playing",
            Metadata: {
                "xesam:title": "Ünïcode — title",
                "xesam:artist": ["First", "Second"],
                "xesam:album": "Album",
                "mpris:artUrl": "https://i.scdn.co/image/abc",
                "mpris:length": 215000000,
            },
        });
        await startPlayer("firefox.instance_1_9", {
            Identity: "Mozilla Firefox",
            DesktopEntry: "firefox",
            PlaybackStatus: "Playing",
            Metadata: { "xesam:title": "Some video", "xesam:artist": ["Channel"], "xesam:album": "" },
        });
        await startPlayer("rhythmbox", {
            Identity: "Rhythmbox",
            PlaybackStatus: "Paused",
            Metadata: { "xesam:title": "Paused song", "xesam:artist": ["X"], "xesam:album": "Y" },
        });

        process.env.DBUS_SESSION_BUS_ADDRESS = address;
        const bus = await dbus.DBusConnection.connectSession();
        const tracks = await music.linuxTracks(bus);
        bus.close();
        assert.equal(tracks.length, 2, "the paused player is left out");
        const spotify = tracks.find((track) => track.sources[0] === "org.mpris.MediaPlayer2.spotify");
        assert.equal(spotify.title, "Ünïcode — title");
        assert.equal(spotify.artist, "First, Second");
        assert.equal(spotify.album, "Album");
        assert.equal(spotify.artUrl, "https://i.scdn.co/image/abc");
        assert.deepEqual(spotify.sources, ["org.mpris.MediaPlayer2.spotify", "spotify", "Spotify"]);
        const picked = music.pickTrack(tracks);
        assert.equal(picked.track.player.id, "spotify");
        assert.equal(music.pickTrack(tracks.filter((track) => track !== spotify)), null, "a video in the browser isn't music");
    } finally {
        for (const child of players) child.kill();
        daemon.kill();
    }
});
