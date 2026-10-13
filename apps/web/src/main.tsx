import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui/App";
import { registerMediaServiceWorker } from "./ui/serviceWorker/registerMediaServiceWorker";
import { applyAppearanceTheme, loadUserLocalSettings } from "./ui/settings/user/settingsStore";
import { installPhoneLayout } from "./ui/layout/phoneLayout";

// Paint the first screen in the saved theme. AppShell keeps it applied, but it only mounts once
// you're signed in, so in light mode every start used to go dark first, then flip to light.
const { appearance } = loadUserLocalSettings();
applyAppearanceTheme(appearance);
void window.heorotDesktop?.setAppearanceTheme?.(appearance.theme);

// Before the first paint too, so a phone never shows the desktop layout first.
installPhoneLayout();

void registerMediaServiceWorker();

const rootElement = document.getElementById("root");
if (!rootElement) {
    throw new Error("Missing #root mount element");
}

createRoot(rootElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
