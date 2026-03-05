import { Button } from "../ui/Button";

export function LeftSidebarConfig({
  loading,
  onRequestWholeFragment,
  pendingCount
}: {
  loading?: boolean;
  onRequestWholeFragment: () => void;
  pendingCount: number;
}) {
  return (
    <div className="sidebar-stack sidebar-stack-minimal">
      <section className="sidebar-section">
        <Button variant="primary" size="sm" loading={loading} onClick={onRequestWholeFragment} style={{ width: "100%" }}>
          Базова правка всього фрагмента
        </Button>
      </section>

      <section className="sidebar-section">
        <p className="mono-ui sidebar-title">На розгляді</p>
        <p className="sidebar-metric">{pendingCount}</p>
      </section>
    </div>
  );
}
