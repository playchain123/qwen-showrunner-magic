import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/dashboard_/showrunner/")({
  ssr: false,
  component: NewShowrunner,
});

function NewShowrunner() {
  const navigate = useNavigate();
  useEffect(() => {
    const id = crypto.randomUUID();
    void navigate({ to: "/dashboard_/showrunner/$id", params: { id }, replace: true });
  }, [navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white/60 text-sm">
      Opening a fresh showrunner…
    </div>
  );
}