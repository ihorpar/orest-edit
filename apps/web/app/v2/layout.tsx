import type { ReactNode } from "react";
import { Golos_Text, Source_Serif_4 } from "next/font/google";

const uiFont = Golos_Text({ subsets: ["latin", "cyrillic"], variable: "--font-v2-ui", display: "swap" });
const textFont = Source_Serif_4({
  subsets: ["latin", "cyrillic"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-v2-text",
  display: "swap"
});

export default function V2Layout({ children }: { children: ReactNode }) {
  return <div className={`${uiFont.variable} ${textFont.variable}`}>{children}</div>;
}
