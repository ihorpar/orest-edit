import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter, Lora } from "next/font/google";
import { AppProviders } from "../components/providers/AppProviders";
import "./styles/foundation.css";
import "./globals.css";
import "./styles/auth.css";
import "./styles/layout.css";
import "./styles/review.css";
import "./styles/floating.css";
import "./styles/step-review.css";
import "./styles/editor.css";
import "./styles/overlays.css";
import "./styles/review-chat.css";
import "./styles/sidebar.css";
import "./styles/settings.css";

const uiFont = Inter({ subsets: ["latin"], variable: "--font-ui" });
const monoFont = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
const manuscriptFont = Lora({ subsets: ["latin", "cyrillic"], variable: "--font-manuscript" });

export const metadata: Metadata = {
  title: {
    default: "Orest Edit | AI Редактор рукопису",
    template: "%s | Orest Edit"
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body className={`${uiFont.variable} ${monoFont.variable} ${manuscriptFont.variable}`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
