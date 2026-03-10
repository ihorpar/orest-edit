"use client";

import Link from "next/link";
import { useState } from "react";
import { useAiActivity } from "../providers/AiActivityProvider";

export function TopBar({
  activePath = "/editor"
}: {
  activePath?: "/editor" | "/settings";
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { runningCount, unreadCount } = useAiActivity();
  const hasActivity = runningCount > 0 || unreadCount > 0;
  const activityLabel =
    runningCount > 0 ? `ШІ виконує ${runningCount} запит(ів)` : unreadCount > 0 ? `ШІ підготував ${unreadCount} результат(ів)` : "ШІ";

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin"
      });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            OrestGPT <span className="brand-version">V1</span>
          </span>
        </div>
        <nav className="nav-links" aria-label="main navigation">
          <Link href="/editor" className="mono-ui nav-link" data-active={activePath === "/editor"}>
            {"\u0420\u0435\u0434\u0430\u043a\u0442\u043e\u0440"}
          </Link>
          <Link href="/settings" className="mono-ui nav-link" data-active={activePath === "/settings"}>
            {"\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f"}
          </Link>
        </nav>
      </div>

      <div className="topbar-right">
        <Link href="/editor" className="topbar-activity button-reset" data-active={hasActivity ? "true" : "false"} aria-label={activityLabel}>
          <span className="topbar-activity-orb" data-state={runningCount > 0 ? "running" : unreadCount > 0 ? "ready" : "idle"} aria-hidden="true" />
          <span className="mono-ui">ШІ</span>
          {runningCount > 0 ? <span className="mono-ui topbar-activity-count">{runningCount}</span> : null}
          {runningCount === 0 && unreadCount > 0 ? <span className="mono-ui topbar-activity-count">{unreadCount}</span> : null}
        </Link>
        <button type="button" className="mono-ui nav-link button-reset" onClick={handleLogout} disabled={isLoggingOut}>
          {"\u0412\u0438\u0439\u0442\u0438"}
        </button>
      </div>
    </header>
  );
}
