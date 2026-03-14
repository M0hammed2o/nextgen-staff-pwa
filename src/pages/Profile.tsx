import { useAuth } from "@/lib/auth";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.jpeg";

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
