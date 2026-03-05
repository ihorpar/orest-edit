import Link from "next/link";

export default function HomePage() {
  return (
    <main className="app-shell" style={{ padding: 40 }}>
      <div style={{ maxWidth: 760 }}>
        <h1 style={{ marginTop: 0, fontSize: 44, lineHeight: 1.05 }}>MEDEDIT V1</h1>
        <p style={{ maxWidth: 620, fontSize: 18, lineHeight: 1.7, color: "#475569" }}>
          {"\u0406\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442 \u0434\u043b\u044f \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440\u0430, \u044f\u043a\u0438\u0439 \u043f\u0435\u0440\u0435\u0442\u0432\u043e\u0440\u044e\u0454 \u0441\u043a\u043b\u0430\u0434\u043d\u0438\u0439 \u043d\u0430\u0443\u043a\u043e\u0432\u0438\u0439 \u0442\u0435\u043a\u0441\u0442 \u043d\u0430 \u043f\u0440\u043e\u0441\u0442\u0443 \u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0443 \u0447\u0435\u0440\u0435\u0437 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u0456 AI-\u043f\u0440\u0430\u0432\u043a\u0438."}
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28 }}>
          <Link href="/editor" className="mono-ui" style={{ color: "#2563eb" }}>
            {"\u0412\u0456\u0434\u043a\u0440\u0438\u0442\u0438 \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440"}
          </Link>
          <Link href="/settings" className="mono-ui" style={{ color: "#0f172a" }}>
            {"\u0412\u0456\u0434\u043a\u0440\u0438\u0442\u0438 \u043d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f"}
          </Link>
        </div>
      </div>
    </main>
  );
}
