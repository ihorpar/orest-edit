"use client";

import { useEffect, useState } from "react";
import { resolveEditorAssetUrl } from "../../lib/editor/asset-store";

export function useResolvedEditorAssetUrl(source: string | null | undefined) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const normalizedSource = source?.trim() || null;

    if (!normalizedSource) {
      setResolvedUrl(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    void resolveEditorAssetUrl(normalizedSource)
      .then((url) => {
        if (!isCancelled) {
          setResolvedUrl(url);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setResolvedUrl(null);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [source]);

  return {
    resolvedUrl,
    isLoading
  };
}
