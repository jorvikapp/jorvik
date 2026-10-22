// Push notifications, loaded by sw.js. Each push is what Sygnal's webpush sends for a pusher set by
// src/core/push/webPush.ts: room_id, room_name, event_id, sender, sender_display_name, type,
// membership, user_is_target, unread and content, plus jorvik_hide_body when bodies are off.

const JORVIK_PUSH_ICON = "/branding/jorvik-app-192-7b87c503.png";
const JORVIK_PUSH_BADGE = "/branding/jorvik-badge-96-0e43c159.png";
const JORVIK_PUSH_BODY_LIMIT = 300;

// Safari (iPhone, iPad, Mac) drops a subscription whose pushes don't all show a notification.
function jorvikPushMustAlwaysShow(userAgent) {
    return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android|SamsungBrowser/.test(userAgent);
}

function jorvikPushDescribeMessage(content, sender) {
    if (!content || typeof content !== "object") {
        return "New message";
    }
    switch (content.msgtype) {
        case "m.image":
            return "Sent an image";
        case "m.video":
            return "Sent a video";
        case "m.audio":
            return "Sent a voice message";
        case "m.file":
            return "Sent a file";
        case "m.location":
            return "Shared a location";
        default:
            break;
    }
    const body = typeof content.body === "string" ? content.body.trim() : "";
    if (!body) {
        return "New message";
    }
    const text = content.msgtype === "m.emote" ? `${sender} ${body}` : body;
    return text.length > JORVIK_PUSH_BODY_LIMIT ? `${text.slice(0, JORVIK_PUSH_BODY_LIMIT - 1)}…` : text;
}

function jorvikPushDescribe(data) {
    if (!data || typeof data !== "object") {
        return null;
    }
    const roomId = typeof data.room_id === "string" ? data.room_id : null;
    const eventId = typeof data.event_id === "string" ? data.event_id : null;
    const sender = data.sender_display_name || data.sender || "Someone";
    const roomName = typeof data.room_name === "string" && data.room_name ? data.room_name : null;
    // The homeserver names a chat without a name after the other person in it.
    const direct = !roomName || roomName === sender;

    if (data.membership === "invite" && data.user_is_target) {
        return direct
            ? { title: sender, body: "Invited you to chat", roomId, eventId }
            : { title: roomName, body: `${sender} invited you`, roomId, eventId };
    }

    let body;
    if (data.type === "m.room.encrypted") {
        // Encrypted: the phone can't read it in the background, only that something came.
        body = "New message";
    } else if (data.type === "m.sticker") {
        body = "Sent a sticker";
    } else if (data.type === "m.room.message") {
        body = data.jorvik_hide_body ? "New message" : jorvikPushDescribeMessage(data.content, sender);
    } else {
        body = "New activity";
    }
    return { title: direct ? sender : `${sender} (${roomName})`, body, roomId, eventId };
}

// Asks a window whether it shows this room right now; no answer in time counts as no.
function jorvikPushAsk(client, message, timeoutMs) {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(false), timeoutMs);
        channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            resolve(event.data === true);
        };
        client.postMessage(message, [channel.port2]);
    });
}

async function jorvikPushRoomOnScreen(roomId) {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const looking = windows.filter((client) => client.focused && client.visibilityState === "visible");
    const answers = await Promise.all(
        looking.map((client) => jorvikPushAsk(client, { type: "jorvik:is_room_open", roomId }, 500)),
    );
    return answers.some(Boolean);
}

async function jorvikPushUpdateBadge(data) {
    const nav = self.navigator;
    if (!data || typeof data.unread !== "number" || typeof nav.setAppBadge !== "function") {
        return;
    }
    try {
        if (data.unread > 0) {
            await nav.setAppBadge(data.unread);
        } else {
            await nav.clearAppBadge();
        }
    } catch {
        // Badges are a nicety; some browsers only allow them for installed apps.
    }
}

async function jorvikPushHandle(event) {
    let data = null;
    try {
        data = event.data ? event.data.json() : null;
    } catch {
        data = null;
    }
    await jorvikPushUpdateBadge(data);
    const notice = jorvikPushDescribe(data) || { title: "Jorvik", body: "New activity", roomId: null, eventId: null };
    // Everywhere but Safari, a chat you are looking at needs no notification.
    if (notice.roomId && !jorvikPushMustAlwaysShow(self.navigator.userAgent) && (await jorvikPushRoomOnScreen(notice.roomId))) {
        return;
    }
    await self.registration.showNotification(notice.title, {
        body: notice.body,
        icon: JORVIK_PUSH_ICON,
        badge: JORVIK_PUSH_BADGE,
        // One notification per chat: a newer message replaces the last one but still alerts.
        tag: notice.roomId || "jorvik",
        renotify: true,
        data: { roomId: notice.roomId, eventId: notice.eventId },
    });
}

async function jorvikPushOpen(roomId) {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((candidate) => candidate.focused) || windows[0];
    if (client) {
        try {
            await client.focus();
        } catch {
            // Not allowed to take focus; the room still opens.
        }
        if (roomId) {
            client.postMessage({ type: "jorvik:open_room", roomId });
        }
        return;
    }
    const url = new URL(self.registration.scope);
    if (roomId) {
        url.searchParams.set("room", roomId);
    }
    await self.clients.openWindow(url.toString());
}

self.addEventListener("push", (event) => {
    event.waitUntil(jorvikPushHandle(event));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const roomId = event.notification.data && typeof event.notification.data.roomId === "string" ? event.notification.data.roomId : null;
    event.waitUntil(jorvikPushOpen(roomId));
});
