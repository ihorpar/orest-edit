import { redirect } from "next/navigation";

// The classic editor stays the default; NEXT_PUBLIC_OREST_DEFAULT_EDITOR=v2 makes the new one the entry point.
export default function HomePage() {
  redirect(process.env.NEXT_PUBLIC_OREST_DEFAULT_EDITOR === "v2" ? "/v2" : "/editor");
}
