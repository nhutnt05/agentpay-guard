import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer } from "@/components/ui/Footer";
import { Navigation } from "@/components/ui/Navigation";
import { WalletProviders } from "@/components/wallet/WalletProviders";
import { APP_NAME, APP_TAGLINE } from "@/config/app";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — On-chain payment firewall for AI agents`, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
};

export const viewport: Viewport = {
  themeColor: "#07090e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <WalletProviders>
          <Navigation />
          <div id="main" className="flex flex-1 flex-col">
            {children}
          </div>
          <Footer />
        </WalletProviders>
      </body>
    </html>
  );
}
