# Linux launcher badge investigation

Investigated 2026-09-10. No build, dependency upgrade, or release was performed.

## Jorvik's current path

`unreadNotificationTotal` reaches `heorot:setBadgeCount` through the preload
bridge. Main normalizes the number and calls `app.setBadgeCount`. The current
lockfile selects Electron 40.0.0. Main sets `jorvik.desktop` as the desktop name.
The released IPC/preload path discards the native boolean and returns void;
a resolved renderer promise therefore does not establish badge success.

Local diagnostic logging now records Electron version, normalized count, API
presence, the actual return value, and desktop name. It does not record message
contents, room identifiers, or credentials. This logging is not in the existing
1.2.14 binary. Its actual host-side return value has not been observed.

## Electron 40 versus 44

Electron 40.0.0 still implements Linux badges. `Browser::SetBadgeCount` returns
true only when a count is supplied and `unity::IsRunning()` succeeds. The latter
loads `libunity.so.4`, `.6`, or `.9` and consults the Unity inspector. Failure
returns false. Plasma's task manager registers the compatibility service
`com.canonical.Unity`, so the name of this check does not mean KDE is inherently
unsupported. With libunity and successful launcher detection, Electron 40 can
send badges to Plasma. Success is not a guarantee that a visible task matches.

The Unity removal PR was merged in May 2026 for the 44 development line; it was
not the implementation shipped in 40.0.0. Electron 44.0.0 restores these APIs
using direct session-bus signals without libunity. Its boolean reports that a
desktop identity was available and emission was queued; it does not acknowledge
delivery or rendering by Plasma.

Sources:

- [Electron 40 badge call](https://github.com/electron/electron/blob/v40.0.0/shell/browser/browser_linux.cc)
- [Electron 40 libunity loader](https://github.com/electron/electron/blob/v40.0.0/shell/browser/linux/unity_service.cc)
- [Unity removal PR](https://github.com/electron/electron/pull/51649)
- [Electron 44 announcement](https://www.electronjs.org/blog/electron-44-0)
- [Electron 44 LauncherEntry implementation](https://github.com/electron/electron/blob/v44.0.0/shell/browser/linux/launcher_entry.cc)

## Plasma identity and signal

The expected session-bus signal is:

```text
interface: com.canonical.Unity.LauncherEntry
member: Update
object path used by Electron 44: /com/canonical/unity/launcherentry
signature: sa{sv}
URI: application://jorvik.desktop
properties: count = int64, count-visible = boolean
```

Zero sets `count-visible` to false. Unlike notification hints (`desktop-entry=jorvik`),
the launcher URI includes `.desktop`. This URI names the desktop file, not the
AppImage executable or the notification PNG.

Plasma strips `application://`, resolves the remainder through
`KService::serviceByStorageId`, and associates it with the task's desktop storage
ID. An unresolved entry is rejected. Badge settings can suppress counts. The
known stale Exec target remains relevant to launcher/window association, but it
does not explain libunity loading or the native API return value.

Plasma watches the sender's D-Bus unique name and removes its launcher state on
disconnect. A custom fallback must retain a connection, handle failure/reconnect,
and clear counts appropriately. Spawning `dbus-send` or `gdbus emit` per count
would not provide reliable persistent badges.

Sources:

- [Plasma 6.5 backend](https://github.com/KDE/plasma-desktop/blob/Plasma/6.5/applets/taskmanager/smartlauncherbackend.cpp)
- [Plasma task identity matching](https://github.com/KDE/plasma-desktop/blob/Plasma/6.5/applets/taskmanager/smartlauncheritem.cpp)

## Host checks without rebuilding Jorvik

Check the linker cache for the dependency (custom library search paths can also
provide it):

```sh
ldconfig -p | grep -E 'libunity\.so\.(4|6|9)'
```

The following optional diagnostic requires the Python `dbus` module. Run it in
the graphical user's terminal with Jorvik visible in the task manager. It sends
a synthetic count of 2 on a dedicated connection, holds it for 20 seconds, then
clears it. It does not change desktop files or unread counts. If the module is
unavailable, stop rather than treating that as a badge failure.

```python
import time
import dbus
from dbus.lowlevel import SignalMessage

bus = dbus.SessionBus(private=True)

def send_count(count):
    signal = SignalMessage(
        "/com/canonical/unity/launcherentry",
        "com.canonical.Unity.LauncherEntry",
        "Update",
    )
    signal.append(
        "application://jorvik.desktop",
        {"count": dbus.Int64(count), "count-visible": dbus.Boolean(count != 0)},
        signature="sa{sv}",
    )
    bus.send_message(signal)
    bus.flush()

try:
    send_count(2)
    print("Synthetic badge 2 sent; inspect the taskbar for 20 seconds.")
    time.sleep(20)
finally:
    try:
        send_count(0)
    finally:
        bus.close()
```

A visible 2 confirms the host protocol, task identity, and badge display path.
No visible badge means those still need investigation; upgrading the transport
alone cannot be assumed to fix the host. This test does not reveal the return
value of the already-running Electron 40 process.

## Recommendation

Prefer Electron 44's upstream implementation when a runtime migration can be
validated: Jorvik can retain its existing badge API and desktop identity with no
custom D-Bus code. An application-owned persistent D-Bus fallback is a narrower
short-term alternative if remaining on Electron 40 is necessary, but carries
connection lifecycle and dependency maintenance. Do not change unread
calculation, notification images, or Web Notification delivery for either path.

Still pending: host libunity availability, the actual Electron 40 return value,
and a host-side badge transport/identity test. No approach has been deployed.
