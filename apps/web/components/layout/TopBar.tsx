import Link from "next/link";

export function TopBar({
  pendingCount,
  activePath = "/editor"
}: {
  pendingCount: number;
  activePath?: "/editor" | "/settings";
}) {
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
            {"\u0420\u0443\u043a\u043e\u043f\u0438\u0441"}
          </Link>
          <Link href="/settings" className="mono-ui nav-link" data-active={activePath === "/settings"}>
            {"\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f"}
          </Link>
        </nav>
      </div>
      <div className="topbar-right">
        <span className="mono-ui pending-badge">{pendingCount} {"\u043d\u0430 \u0440\u043e\u0437\u0433\u043b\u044f\u0434\u0456"}</span>
      </div>
    </header>
  );
}
