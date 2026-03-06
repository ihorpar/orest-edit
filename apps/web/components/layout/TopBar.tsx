import Link from "next/link";

export function TopBar({
  activePath = "/editor"
}: {
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
            {"\u0420\u0435\u0434\u0430\u043a\u0442\u043e\u0440"}
          </Link>
          <Link href="/settings" className="mono-ui nav-link" data-active={activePath === "/settings"}>
            {"\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f"}
          </Link>
        </nav>
      </div>
    </header>
  );
}
