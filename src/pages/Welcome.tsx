import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { landingPath, usePOSSettings } from "@/lib/pos-settings";

const WELCOME_DURATION_MS = 1500;

export default function Welcome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: settings } = usePOSSettings();

  // Land on a tab this tenant actually shows. A till-only restaurant has
  // nothing on Live Orders, so opening the app there would greet staff with a
  // permanently empty screen. If settings have not arrived by the time the
  // greeting ends we fall back to "/", which is the behaviour every existing
  // tenant already has.
  const target = landingPath(settings);

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate(target ?? "/", { replace: true });
    }, WELCOME_DURATION_MS);
    return () => clearTimeout(timer);
  }, [navigate, target]);

  // Use first name only for a warm, informal greeting
  const firstName = user?.staff_name?.trim().split(/\s+/)[0] ?? "there";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-2">
      <p className="text-lg text-muted-foreground">Welcome,</p>
      <h1 className="text-5xl font-bold text-foreground tracking-tight">{firstName}</h1>
    </div>
  );
}
