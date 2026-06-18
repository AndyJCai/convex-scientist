"use client";

import { useState } from "react";
import { usePasskeyAuth } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";

/**
 * Signed-out auth UI with two explicit actions. WebAuthn can't tell us whether a
 * passkey already exists, so instead of one ambiguous button we offer a clear
 * "create account" (registerPasskey) and a separate "sign in" (signInWithPasskey).
 * First-time users click Create → a single Touch ID / security-key prompt → done.
 */
export function AuthPanel() {
  const { registerPasskey, signInWithPasskey } = usePasskeyAuth();
  const [busy, setBusy] = useState<null | "create" | "signin">(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy("create");
    setError(null);
    try {
      await registerPasskey();
      // On success the provider flips auth state and this panel unmounts.
    } catch {
      setError("Couldn't create a passkey. Please try again.");
      setBusy(null);
    }
  }

  async function signIn() {
    setBusy("signin");
    setError(null);
    try {
      await signInWithPasskey();
    } catch {
      setError("No passkey found on this device — create an account first.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={busy !== null}
        onClick={() => void create()}
      >
        {busy === "create" ? "Creating your passkey…" : "Create a passkey account"}
      </Button>
      <Button
        variant="outline"
        className="w-full"
        disabled={busy !== null}
        onClick={() => void signIn()}
      >
        {busy === "signin" ? "Waiting for your passkey…" : "I already have a passkey — sign in"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
