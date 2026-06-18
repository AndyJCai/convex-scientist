"use client";

import { useState } from "react";
import { usePasskeyAuth, useConvexAuth, useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";

export function PasskeyButton() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { registerPasskey, signInWithPasskey } = usePasskeyAuth();
  const { signOut } = useAuthActions();
  const [busy, setBusy] = useState(false);

  if (isLoading) return null;
  if (isAuthenticated) {
    return (
      <Button variant="outline" size="sm" onClick={() => void signOut()}>
        Sign out
      </Button>
    );
  }

  async function continueWithPasskey() {
    setBusy(true);
    try {
      // Returning user: use an existing discoverable passkey for this site.
      await signInWithPasskey();
    } catch {
      // No usable passkey here (or the credential isn't known to the server)
      // → create a brand-new passkey + account in the same gesture.
      try {
        await registerPasskey();
      } catch {
        /* user dismissed both prompts — stay on the sign-in screen */
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button disabled={busy} onClick={() => void continueWithPasskey()}>
      {busy ? "Waiting for your passkey…" : "Continue with a passkey"}
    </Button>
  );
}
