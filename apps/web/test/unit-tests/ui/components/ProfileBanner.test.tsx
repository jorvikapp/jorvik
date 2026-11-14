import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BANNER_FIELD, bannerMxcFrom, clearSavedBanners, rememberBanner } from "../../../../src/core/users/profileBanner";
import { bannerGradient, ProfileBanner, useProfileBannerSrc } from "../../../../src/ui/components/profile/ProfileBanner";
import { ProfileTab } from "../../../../src/ui/settings/user/tabs/ProfileTab";

vi.mock("../../../../src/ui/activity/useActivityPrivacy", () => ({
    useActivityPrivacy: () => ({ settings: { enabled: false, hidden_games: [], space_scope: "none", share_with_friends: false } }),
}));
vi.mock("../../../../src/ui/activity/useActivity", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useJoinedSpaces: () => [],
    useUserActivity: () => null,
}));
vi.mock("../../../../src/core/activity/activityPrivacy", () => ({
    activityAudience: () => [],
    describeActivityAudience: () => "Nobody sees your game.",
}));

const BANNER = "mxc://test.local/BannerGif_1";
const http = (mxc: string): string => `http://hs/${mxc.slice(6)}`;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearSavedBanners();
    vi.restoreAllMocks();
});

function fakeClient(profile: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
        getUserId: () => "@alice:test.local",
        getDomain: () => "test.local",
        mxcUrlToHttp: (mxc: string) => http(mxc),
        getProfileInfo: vi.fn(async () => profile),
        doesServerSupportExtendedProfiles: vi.fn(async () => true),
        getExtendedProfileProperty: vi.fn(async () => null),
        setExtendedProfileProperty: vi.fn(async () => undefined),
        deleteExtendedProfileProperty: vi.fn(async () => undefined),
        getMediaConfig: vi.fn(async () => ({ "m.upload.size": 50 * 1_048_576 })),
        uploadContent: vi.fn(async () => ({ content_uri: BANNER })),
        ...extra,
    };
}

describe("bannerMxcFrom", () => {
    it("takes only an mxc:// address", () => {
        expect(bannerMxcFrom(BANNER)).toBe(BANNER);
        expect(bannerMxcFrom(` ${BANNER} `)).toBe(BANNER);
        expect(bannerMxcFrom("https://example.com/a.gif")).toBeNull();
        expect(bannerMxcFrom("mxc://test.local/../x")).toBeNull();
        expect(bannerMxcFrom("javascript:alert(1)")).toBeNull();
        expect(bannerMxcFrom(42)).toBeNull();
        expect(bannerMxcFrom(undefined)).toBeNull();
    });
});

describe("ProfileBanner", () => {
    it("shows the picture over the colours, and only the colours when it fails to load", () => {
        act(() => root.render(<ProfileBanner className="b" src="http://hs/x.gif" background={bannerGradient("@bob:s")} />));
        const strip = container.querySelector<HTMLElement>(".b")!;
        expect(strip.style.background).toContain("linear-gradient");
        const img = strip.querySelector("img")!;
        expect(img.getAttribute("src")).toBe("http://hs/x.gif");
        act(() => img.dispatchEvent(new Event("error")));
        expect(strip.querySelector("img")).toBeNull();
        expect(strip.style.background).toContain("linear-gradient");
    });

    it("is just the colours without a picture", () => {
        act(() => root.render(<ProfileBanner className="b" src={null} background="red" />));
        expect(container.querySelector("img")).toBeNull();
    });
});

function Probe({ client, profile }: { client: never; profile?: Record<string, unknown> | null }): React.ReactElement {
    return <span>{useProfileBannerSrc(client, "@bob:test.local", profile) ?? "none"}</span>;
}

describe("useProfileBannerSrc", () => {
    it("reads the banner from a profile that's already loaded", () => {
        const client = fakeClient({});
        act(() => root.render(<Probe client={client as never} profile={{ [BANNER_FIELD]: BANNER }} />));
        expect(container.textContent).toBe(http(BANNER));
        expect(client.getProfileInfo).not.toHaveBeenCalled();
        act(() => root.render(<Probe client={client as never} profile={{ [BANNER_FIELD]: "https://evil/x.gif" }} />));
        expect(container.textContent).toBe("none");
    });

    it("fetches the profile itself when not given one, and a banner saved now wins", async () => {
        const client = fakeClient({ [BANNER_FIELD]: BANNER });
        await act(async () => root.render(<Probe client={client as never} />));
        expect(container.textContent).toBe(http(BANNER));
        act(() => rememberBanner("@bob:test.local", null));
        expect(container.textContent).toBe("none");
    });
});

describe("ProfileTab banner", () => {
    it("uploads a GIF, previews it, and saves it to the profile field", async () => {
        const client = fakeClient({ displayname: "alice" });
        await act(async () => root.render(<ProfileTab client={client as never} onToast={vi.fn()} />));
        const upload = [...container.querySelectorAll("button")].find((b) => b.textContent === "Upload banner")!;
        expect(upload).toBeTruthy();
        const input = container.querySelector<HTMLInputElement>('input[accept="image/png,image/jpeg,image/gif,image/webp"]')!;
        const file = new File(["GIF89a"], "wave.gif", { type: "image/gif" });
        Object.defineProperty(input, "files", { value: [file] });
        await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
        expect(client.uploadContent).toHaveBeenCalledWith(file, expect.objectContaining({ type: "image/gif" }));
        expect(container.querySelector(".profile-preview-banner img")?.getAttribute("src")).toBe(http(BANNER));

        const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save profile")!;
        await act(async () => save.click());
        expect(client.setExtendedProfileProperty).toHaveBeenCalledWith(BANNER_FIELD, BANNER);
    });

    it("refuses a file that isn't a PNG, JPEG, GIF or WebP, or is over the limit", async () => {
        const client = fakeClient({}, { getMediaConfig: vi.fn(async () => ({ "m.upload.size": 1_048_576 })) });
        await act(async () => root.render(<ProfileTab client={client as never} onToast={vi.fn()} />));
        const input = container.querySelector<HTMLInputElement>('input[accept="image/png,image/jpeg,image/gif,image/webp"]')!;
        const send = async (file: File) => {
            Object.defineProperty(input, "files", { value: [file], configurable: true });
            await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
        };
        await send(new File(["x"], "notes.txt", { type: "text/plain" }));
        expect(container.querySelector(".settings-inline-error")?.textContent).toMatch(/PNG, JPEG, GIF or WebP/);
        await send(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
        expect(container.querySelector(".settings-inline-error")?.textContent).toMatch(/PNG, JPEG, GIF or WebP/);
        // The server's limit (1 MB here) wins when it is lower than the banner limit.
        await send(new File([new Uint8Array(3 * 1_048_576)], "big.gif", { type: "image/gif" }));
        expect(container.querySelector(".settings-inline-error")?.textContent).toMatch(/3\.0 MB; a banner can be up to 1 MB/);
        expect(client.uploadContent).not.toHaveBeenCalled();
    });

    it("holds a banner to 10 MB even when the server takes more, and takes WebP", async () => {
        const client = fakeClient({});
        await act(async () => root.render(<ProfileTab client={client as never} onToast={vi.fn()} />));
        const input = container.querySelector<HTMLInputElement>('input[accept="image/png,image/jpeg,image/gif,image/webp"]')!;
        const send = async (file: File) => {
            Object.defineProperty(input, "files", { value: [file], configurable: true });
            await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
        };
        await send(new File([new Uint8Array(11 * 1_048_576)], "huge.gif", { type: "image/gif" }));
        expect(container.querySelector(".settings-inline-error")?.textContent).toMatch(/11\.0 MB; a banner can be up to 10 MB/);
        expect(client.uploadContent).not.toHaveBeenCalled();
        await send(new File(["RIFF"], "wave.webp", { type: "image/webp" }));
        expect(client.uploadContent).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ type: "image/webp" }));
    });

    it("removing the banner deletes the field", async () => {
        const client = fakeClient({ [BANNER_FIELD]: BANNER });
        await act(async () => root.render(<ProfileTab client={client as never} onToast={vi.fn()} />));
        const remove = [...container.querySelectorAll("button")].find((b) => b.textContent === "Remove banner")!;
        await act(async () => remove.click());
        expect(container.querySelector(".profile-preview-banner img")).toBeNull();
        const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save profile")!;
        await act(async () => save.click());
        expect(client.deleteExtendedProfileProperty).toHaveBeenCalledWith(BANNER_FIELD);
    });
});
