import { useAuth } from "@/lib/auth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";
import type { WhatsAppStatus } from "@/types";
import logo from "@/assets/logo.jpeg";

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [toggling, setToggling] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await apiClient.get<WhatsAppStatus>("/v1/business/whatsapp/status");
      setStatus(res);
    } catch {
      // Non-fatal — the toggle just won't render until this succeeds.
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handlePause = async () => {
    if (!window.confirm("Pause WhatsApp orders? Customers won't be able to order until you resume.")) {
      return;
    }
    setToggling(true);
    try {
      const res = await apiClient.post<WhatsAppStatus>("/v1/business/whatsapp/pause");
      setStatus(res);
    } finally {
      setToggling(false);
    }
  };

  const handleResume = async () => {
    setToggling(true);
    try {
      const res = await apiClient.post<WhatsAppStatus>("/v1/business/whatsapp/resume");
      setStatus(res);
    } finally {
      setToggling(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top">
        <div className="mx-auto max-w-lg px-4 py-4">
          <h1 className="text-xl font-bold text-foreground">Profile</h1>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6">
          <img src={logo} alt="NextGen Intelligence" className="h-14 w-auto rounded-lg" />
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{user?.staff_name || "Staff"}</p>
            <p className="text-sm text-muted-foreground">{user?.email || ""}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium text-foreground">{user?.role || "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Business</span>
            <span className="font-medium text-foreground">{user?.business_name || "—"}</span>
          </div>
        </div>

        {status && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">WhatsApp Orders</p>
                <p className="text-xs text-muted-foreground">
                  {status.paused
                    ? `Paused${status.paused_by_name ? ` by ${status.paused_by_name}` : ""} — customers see your busy message`
                    : "Accepting orders normally"}
                </p>
              </div>
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  status.paused ? "bg-destructive" : "bg-green-500"
                }`}
              />
            </div>
            <button
              onClick={status.paused ? handleResume : handlePause}
              disabled={toggling}
              className={`flex h-12 w-full items-center justify-center rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 ${
                status.paused
                  ? "bg-green-600 text-white"
                  : "bg-secondary text-foreground border border-border"
              }`}
            >
              {toggling ? "…" : status.paused ? "Resume WhatsApp Orders" : "Pause — Too Busy"}
            </button>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="flex h-14 w-full items-center justify-center rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground transition-colors"
        >
          Log Out
        </button>

        <p className="text-center text-xs text-muted-foreground">
          NextGen Intelligence © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
