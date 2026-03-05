import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function PatchBatchBar({
  hasItems,
  onAcceptAll,
  onRejectAll
}: {
  hasItems: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  return (
    <Card>
      <p style={{ marginTop: 0, marginBottom: 10, fontSize: 12, color: "var(--text-muted)" }}>{"\u0413\u0440\u0443\u043f\u043e\u0432\u0456 \u0434\u0456\u0457 \u0437 \u043f\u0440\u0430\u0432\u043a\u0430\u043c\u0438"}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={onRejectAll} disabled={!hasItems}>
          {"\u0412\u0456\u0434\u0445\u0438\u043b\u0438\u0442\u0438 \u0432\u0441\u0456"}
        </Button>
        <Button variant="primary" size="sm" onClick={onAcceptAll} disabled={!hasItems}>
          {"\u041f\u0440\u0438\u0439\u043d\u044f\u0442\u0438 \u0432\u0441\u0456"}
        </Button>
      </div>
    </Card>
  );
}
