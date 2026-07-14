import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { fetchStaffDirectory } from "@/lib/api";
import type { StaffDirectoryEntry } from "@/types";
import PinKeypad from "@/components/PinKeypad";
import logo from "@/assets/logo.jpeg";

const PIN_LENGTH = 4;

export default function Login() {
  const { login, savedBusiness, changeStore } = useAuth();
  const navigate = useNavigate();

  const [businessCode, setBusinessCode] = useState("");
  const [staffList, setStaffList] = useState<StaffDirectoryEntry[]>([]);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffDirectoryEntry | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // "setup" = enter store code; "staff" = pick your name; "pin" = enter PIN.
  // Returning devices skip straight to the staff list.
  const [step, setStep] = useState<"setup" | "staff" | "pin">(
    savedBusiness ? "staff" : "setup"
  );

  const loadStaff = useCallback(async (code: string) => {
    setError("");
    setLoading(true);
    try {
      const dir = await fetchStaffDirectory(code);
      setStaffList(dir.staff);
      setBusinessName(dir.business_name);
      setStep("staff");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Store not found. Check the code and try again.";
      setError(msg);
      setStep("setup");
    } finally {
      setLoading(false);
    }
  }, []);

  // Returning device: fetch the staff list fresh (never cached) on mount
  useEffect(() => {
    if (savedBusiness && step === "staff" && staffList.length === 0 && !loading) {
      void loadStaff(savedBusiness.business_code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-submit once PIN is fully entered
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !loading) {
      void handlePinSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function handlePinSubmit() {
    if (!selectedStaff) return;
    const code = savedBusiness ? savedBusiness.business_code : businessCode.trim();
    setError("");
    setLoading(true);
    try {
      await login({ business_code: code, staff_id: selectedStaff.id, pin });
      navigate("/welcome", { replace: true });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Incorrect PIN. Please try again.";
      setError(msg);
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  function handleCodeContinue() {
    const trimmed = businessCode.trim();
    if (trimmed.length !== 6) {
      setError("Store code must be 6 characters");
      return;
    }
    void loadStaff(trimmed);
  }

  function handleSelectStaff(staff: StaffDirectoryEntry) {
    setSelectedStaff(staff);
    setPin("");
    setError("");
    setStep("pin");
  }

  function handleBackToStaff() {
    setSelectedStaff(null);
    setPin("");
    setError("");
    setStep("staff");
  }

  function handleChangeStore() {
    changeStore();
    setBusinessCode("");
    setStaffList([]);
    setBusinessName(null);
    setSelectedStaff(null);
    setPin("");
    setError("");
    setStep("setup");
  }

  const restaurantName =
    businessName ?? savedBusiness?.business_name ?? businessCode.trim();

  // ── Step 1: Business Code entry (first-time device setup) ─────────────────
  if (step === "setup") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center gap-4">
            <img src={logo} alt="NextGen Intelligence" className="h-16 w-auto rounded-lg" />
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground">Welcome</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your store code to get started
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="store-code" className="text-sm font-medium text-foreground">
                Store Code
              </label>
              <input
                id="store-code"
                type="text"
                value={businessCode}
                onChange={(e) => setBusinessCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleCodeContinue()}
                placeholder="e.g. ONU9XE"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={6}
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-lg font-semibold tracking-widest text-foreground placeholder:text-muted-foreground placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground">Provided by your manager</p>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleCodeContinue}
              disabled={loading}
              className="flex h-14 w-full items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Checking..." : "Continue"}
            </button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            NextGen Intelligence © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    );
  }

  // ── Step 2: Pick your name ─────────────────────────────────────────────────
  if (step === "staff") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center gap-3">
            <img src={logo} alt={restaurantName} className="h-16 w-auto rounded-lg" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground">{restaurantName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Who's logging in?</p>
            </div>
          </div>

          {loading && (
            <div className="flex justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {!loading && staffList.length === 0 && !error && (
            <p className="text-center text-sm text-muted-foreground">
              No staff set up yet. Ask your manager to add you.
            </p>
          )}

          {/* Big till-style touch targets */}
          <div className="grid grid-cols-2 gap-3">
            {staffList.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectStaff(s)}
                className="flex h-16 items-center justify-center rounded-lg border border-border bg-secondary px-3 text-base font-semibold text-foreground transition-colors hover:border-primary hover:bg-primary/10"
              >
                {s.staff_name}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
              {error}
            </div>
          )}

          <p className="text-center">
            <button
              type="button"
              onClick={handleChangeStore}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
            >
              Change Store
            </button>
          </p>

          <p className="text-center text-xs text-muted-foreground">
            NextGen Intelligence © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    );
  }

  // ── Step 3: PIN entry for the selected staff member ───────────────────────
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Restaurant + staff branding */}
        <div className="flex flex-col items-center gap-3">
          <img src={logo} alt={restaurantName} className="h-16 w-auto rounded-lg" />
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">
              Hi, {selectedStaff?.staff_name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your PIN to continue</p>
          </div>
        </div>

        {/* PIN keypad */}
        <PinKeypad
          value={pin}
          onChange={setPin}
          maxLength={PIN_LENGTH}
          disabled={loading}
        />

        {/* Loading */}
        {loading && (
          <div className="flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
            {error}
          </div>
        )}

        {/* Not you? / Change Store */}
        <div className="flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={handleBackToStaff}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            Not you?
          </button>
          <button
            type="button"
            onClick={handleChangeStore}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            Change Store
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          NextGen Intelligence © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
