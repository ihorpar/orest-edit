"use client";

import type { ReactNode } from "react";
import { AiActivityProvider } from "./AiActivityProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return <AiActivityProvider>{children}</AiActivityProvider>;
}
