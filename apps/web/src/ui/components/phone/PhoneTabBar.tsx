import React from "react";

export type PhoneTab = "home" | "notifications" | "you";

interface PhoneTabBarProps {
    tab: PhoneTab;
    notificationCount: number;
    you: React.ReactNode;
    onSelect: (tab: PhoneTab) => void;
}

function HomeIcon(): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 11l8-6.5 8 6.5" />
            <path d="M6 9.5V19h4.5v-5h3v5H18V9.5" />
        </svg>
    );
}

function BellIcon(): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 16v-5a6 6 0 0 1 12 0v5" />
            <path d="M4 16h16" />
            <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
    );
}

export function PhoneTabBar({ tab, notificationCount, you, onSelect }: PhoneTabBarProps): React.ReactElement {
    const button = (id: PhoneTab, label: string, icon: React.ReactNode, extra?: React.ReactNode): React.ReactElement => (
        <button
            type="button"
            className={`phone-tab${tab === id ? " is-active" : ""}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => onSelect(id)}
        >
            {icon}
            <span className="phone-tab-label">{label}</span>
            {extra}
        </button>
    );

    return (
        <nav className="phone-tabbar" aria-label="Sections">
            {button("home", "Home", <HomeIcon />)}
            {button(
                "notifications",
                "Notifications",
                <BellIcon />,
                notificationCount > 0 ? (
                    <span className="phone-tab-badge" aria-label={`${notificationCount} new`}>
                        {notificationCount > 99 ? "99+" : notificationCount}
                    </span>
                ) : null,
            )}
            {button("you", "You", you)}
        </nav>
    );
}
