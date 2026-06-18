"use client";

import { useConvexAuth } from "@convex-dev/auth/react";
import { AuthPanel } from "@/components/AuthPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceShell } from "@/components/research/WorkspaceShell";

/** Shared chrome for the whole authenticated app. The sidebar (in WorkspaceShell)
 * lives here so it persists across `/`, `/tasks/:id` and `/projects/:id` instead of
 * remounting on every navigation. Signed-out visitors get the landing card. */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <SignedOut />;
  return <WorkspaceShell>{children}</WorkspaceShell>;
}

function SignedOut() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight">🔬 Convex Scientist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An autonomous research companion — survey the literature, propose hypotheses,
          and analyze results.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Get started</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Your account is secured by a <strong>passkey</strong> — no password, no email.
            First time here? <strong>Create a passkey account</strong> and your device&apos;s
            biometrics (Touch ID / Face ID) or security key will set it up in one step —
            that also signs you in. Been here before? Use <strong>sign in</strong>.
          </p>
          <AuthPanel />
        </CardContent>
      </Card>
    </main>
  );
}
