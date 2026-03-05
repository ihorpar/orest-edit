import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const uiFont = Inter({ subsets: ["latin"], variable: "--font-ui" });
const monoFont = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
const manuscriptFont = Playfair_Display({ subsets: ["latin"], variable: "--font-manuscript" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body className={`${uiFont.variable} ${monoFont.variable} ${manuscriptFont.variable}`}>{children}</body>
    </html>
  );
}
