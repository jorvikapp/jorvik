import { useEffect, useState } from "react";

import { type AppVersionInfo, getBuildVersionInfo, resolveAppVersionInfo } from "./appVersion";

/**
 * Starts from the build-time constant so the version is never blank, then
 * upgrades to the packaged desktop version once the bridge answers.
 */
export function useAppVersion(): AppVersionInfo {
    const [info, setInfo] = useState<AppVersionInfo>(() => getBuildVersionInfo());

    useEffect(() => {
        let cancelled = false;
        void resolveAppVersionInfo().then((resolved) => {
            if (!cancelled) {
                setInfo(resolved);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return info;
}
