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
    <div className="desk" data-skin="ink">
      <main className="desk-body">
        <p className="boot-line">Opening a fresh sheet…</p>
      </main>
    </div>
  );
}
