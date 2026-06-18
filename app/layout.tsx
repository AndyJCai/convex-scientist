import type { Metadata } from "next";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ChefPanel } from "./_chef-panel";
import { NewVersionBanner } from "@/components/NewVersionBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Convex App",
  description: "Built live via the Convex quickstart bootstrap.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>
          {children}
          {/* The floating Chef panel lives in the layout so it survives
              page.tsx rewrites — any agent redesign of the home page
              cannot remove this. Do NOT move <ChefPanel />
          <NewVersionBanner /> into
              app/page.tsx; do NOT delete this line. */}
          <ChefPanel />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
