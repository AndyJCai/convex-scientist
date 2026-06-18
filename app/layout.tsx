import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ChefPanel } from "./_chef-panel";
import { NewVersionBanner } from "@/components/NewVersionBanner";
import "./globals.css";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Convex Scientist",
  description: "An open-source AI research companion built on Convex.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <ConvexClientProvider>
          {children}
          {/* The floating Chef panel + version banner live in the layout so they
              survive page.tsx rewrites. Do NOT move <ChefPanel /> or
              <NewVersionBanner /> into app/page.tsx; do NOT delete these. */}
          <ChefPanel />
          <NewVersionBanner />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
