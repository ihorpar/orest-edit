"use client";

import type { ReactNode } from "react";
import { ProductLocaleProvider } from "./ProductLocaleProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return <ProductLocaleProvider>{children}</ProductLocaleProvider>;
}
