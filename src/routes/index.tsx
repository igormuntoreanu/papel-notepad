import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [App, setApp] = useState<ComponentType | null>(null);
  useEffect(() => {
    void import("@/components/quire/quire-app").then((m) => setApp(() => m.QuireApp));
  }, []);
  if (!App) return <Boot />;
  return <App />;
}

function Boot() {
  return (
    <div className="desk" data-skin="paper" data-mode="day">
      <header className="toolbar">
        <span className="brand-name">Papel</span>
      </header>
      <div className="body">
        <main className="stage">
          <div className="sheet-frame" data-edge="torn">
            <div className="sheet">
              <p className="boot-line">Opening a fresh sheet…</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
