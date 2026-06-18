"use client";

import { useConvexAuth } from "@convex-dev/auth/react";
import { PasskeyButton } from "@/components/PasskeyButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-12">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">🔬 AI Scientist</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An autonomous research companion — propose hypotheses, run experiments,
            and track findings.
          </p>
        </div>
        <PasskeyButton />
      </header>

      {isLoading ? null : isAuthenticated ? <Dashboard /> : <SignedOut />}
    </main>
  );
}

function SignedOut() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to start researching</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          Your account is secured by a <strong>passkey</strong> — no password, no email.
          One click creates (or unlocks) your private research workspace using your
          device&apos;s biometrics or security key.
        </p>
        <PasskeyButton />
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>You&apos;re in. Let&apos;s design your AI Scientist.</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          The workspace is live and reactive. We&apos;re about to plan what the AI
          Scientist actually does — open the Chef panel (lower-right) to follow along,
          and we&apos;ll fill this dashboard with real features as we build them.
        </p>
        <p className="text-xs">First feature lands here shortly.</p>
      </CardContent>
    </Card>
  );
}
