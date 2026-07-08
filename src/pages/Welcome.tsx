import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

const WELCOME_DURATION_MS = 1500;

export default function Welcome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/", { replace: true });
    }, WELCOME_DURATION_MS);
    return () => clearTimeout(timer);
  }, [navigate]);

  // Use first name only for a warm, informal greeting
  const firstName = user?.staff_name?.trim().split(/\s+/)[0] ?? "there";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-2">
      <p className="text-lg text-muted-foreground">Welcome,</p>
      <h1 className="text-5xl font-bold text-foreground tracking-tight">{firstName}</h1>
    </div>
  );
}
