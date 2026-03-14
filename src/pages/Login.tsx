import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/logo.jpeg";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [businessCode, setBusinessCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessCode.trim() || !pin.trim()) {
      setError("Please enter both business code and PIN");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login({ business_code: businessCode.trim(), pin: pin.trim() });
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Login failed. Check your credentials.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <img src={logo} alt="NextGen Intelligence" className="h-16 w-auto rounded-lg" />
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Staff Login</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your business code and PIN to continue
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="business-code" className="text-sm font-medium text-foreground">
              Business Code
            </label>
            <input
              id="business-code"
              type="text"
              value={businessCode}
              onChange={(e) => setBusinessCode(e.target.value.toUpperCase())}
              placeholder="e.g. ONU9XE"
              autoComplete="off"
              autoCapitalize="characters"
              className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-lg font-semibold tracking-widest text-foreground placeholder:text-muted-foreground placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="pin" className="text-sm font-medium text-foreground">
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter your PIN"
              autoComplete="off"
              className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-lg font-semibold tracking-widest text-foreground placeholder:text-muted-foreground placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex h-14 w-full items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          NextGen Intelligence © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
