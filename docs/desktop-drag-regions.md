# Desktop window dragging is opt-out, and that is the wrong default

Raised 2026-09-23, after frozen scrollbars in Settings. Recorded as a follow-up;
the immediate fix only added Settings to the opt-out list.

## What the rule does

`apps/web/src/ui/styles/App.css`:

```css
html { -webkit-app-region: drag; }

button, a, input, textarea, select, [contenteditable="true"],
.timeline, .room-list-items, .pane-bottom, .right-panel,
.channel-header-actions, .composer-bar, .composer-input-shell {
    -webkit-app-region: no-drag;
}
```

The whole window is a drag region. An `app-region: drag` area is treated by the
OS as titlebar, so it swallows mouse input, wheel events included. Anything that
needs to scroll, or otherwise receive the mouse, has to punch a hole with
`no-drag`.

The property does nothing in a browser, so **every bug in this class is
desktop-only and invisible on the web**. That is what made the Settings report
confusing: the layout, the overflow and the scroll container were all correct.

## Why the opt-out list does not work

It has to be extended every time anyone adds a scrollable surface, and nothing
enforces it. At the time of writing, of roughly twenty scrollable containers in
the app, only `.timeline` and `.room-list-items` were opted out -- the two the
author happened to exercise. Settings was added on 2026-09-23. Still swallowing
the wheel:

```
.right-panel-body          .rs-members-list      .rs-search-results
.rs-pins-list              .rp-members-list      .members-list
.reaction-picker-grid-custom                     .room-dialog
.room-dialog-autocomplete  .join-public-results  .voice-room-content
.voice-settings-pane       .voice-room-capture-source-list
.import-tree               .composer-gif-picker  .composer-emojis-popover
```

Note `.right-panel` is opted out but `.right-panel-body` is the element that
actually scrolls, so the entry does not help -- a reminder that the list has to
name the exact scrolling element, not an ancestor.

## The fix worth making

Invert it: drop `html { -webkit-app-region: drag; }` and mark only the intended
titlebar strip as draggable. Then new scrollers work by default and nobody has
to remember this file.

Two things to check when doing it, both of which the current default hides:

- Windows already reserves a titlebar strip. `App.css` sets
  `--desktop-titlebar-overlay-height: 32px` under
  `.app-shell.is-desktop-runtime.is-desktop-win32`, and several components pad
  themselves by it. That strip is the natural drag surface.
- Linux and macOS take different paths through `main.ts`, so confirm each still
  has somewhere to grab the window before removing the blanket rule.

This is a behaviour change to window dragging, not a styling tweak, so it wants
its own change and its own test pass rather than riding along with a bug fix.
