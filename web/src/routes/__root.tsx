import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getHealth, type Health } from "../lib/api";

function HealthBadge() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getHealth().then(setHealth, () => setFailed(true));
  }, []);

  const ok = health?.status === "ok";
  const label = failed ? "server offline" : !health ? "checando…" : ok ? "online" : "degradado";
  const color = failed || (health && !ok) ? "bg-red-500" : ok ? "bg-emerald-500" : "bg-zinc-500";

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <span className={`size-2 rounded-full ${color}`} />
      <span>{label}</span>
      {health && (
        <span className="hidden sm:inline text-zinc-500">
          · {health.config.embedModel} + {health.config.chatModel}
        </span>
      )}
    </div>
  );
}

export const Route = createRootRoute({
  component: () => (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-6 border-b border-edge px-6 py-3">
        <span className="font-semibold tracking-tight">little-rag</span>

        <nav className="flex gap-1 text-sm">
          {[
            { to: "/", label: "Chat" },
            { to: "/documents", label: "Documentos" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="rounded-md px-3 py-1.5 text-zinc-400 transition hover:bg-panel hover:text-zinc-100"
              activeProps={{ className: "bg-panel text-zinc-100" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <HealthBadge />
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  ),
});
