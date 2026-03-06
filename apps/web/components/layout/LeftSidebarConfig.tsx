export function LeftSidebarConfig({
  pendingCount
}: {
  pendingCount: number;
}) {
  return (
    <div className="sidebar-stack sidebar-stack-minimal">
      <section className="sidebar-section">
        <p className="mono-ui sidebar-title">На розгляді</p>
        <p className="sidebar-metric">{pendingCount}</p>
      </section>

      <section className="sidebar-section">
        <p className="mono-ui sidebar-title">Фокус</p>
        <p className="sidebar-body">Виділіть фрагмент у рукописі. Далі справа з’явиться одна панель для базової або кастомної правки.</p>
      </section>
    </div>
  );
}
