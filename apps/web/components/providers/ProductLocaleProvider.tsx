"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getProductCopy, type ProductCopy } from "../../lib/i18n/copy";
import {
  APP_LOCALE_UPDATED_EVENT,
  getDefaultAppLocale,
  getProductLocaleConfig,
  readActiveAppLocale,
  writeActiveAppLocale,
  type AppLocale
} from "../../lib/i18n/product-locale";

interface ProductLocaleContextValue {
  locale: AppLocale;
  copy: ProductCopy;
  setLocale: (locale: AppLocale) => void;
}

const ProductLocaleContext = createContext<ProductLocaleContextValue | null>(null);

export function ProductLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(getDefaultAppLocale());

  useEffect(() => {
    setLocaleState(readActiveAppLocale());

    function handleLocaleRefresh() {
      setLocaleState(readActiveAppLocale());
    }

    window.addEventListener(APP_LOCALE_UPDATED_EVENT, handleLocaleRefresh);
    window.addEventListener("storage", handleLocaleRefresh);

    return () => {
      window.removeEventListener(APP_LOCALE_UPDATED_EVENT, handleLocaleRefresh);
      window.removeEventListener("storage", handleLocaleRefresh);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "uk";
    document.title = getProductCopy(locale).appTitle;
  }, [locale]);

  function setLocale(nextLocale: AppLocale) {
    writeActiveAppLocale(nextLocale);
    setLocaleState(nextLocale);
    window.dispatchEvent(new CustomEvent(APP_LOCALE_UPDATED_EVENT, { detail: { locale: nextLocale } }));
  }

  const value = useMemo<ProductLocaleContextValue>(
    () => ({
      locale,
      copy: getProductCopy(locale),
      setLocale
    }),
    [locale]
  );

  return <ProductLocaleContext.Provider value={value}>{children}</ProductLocaleContext.Provider>;
}

export function useProductLocale() {
  const context = useContext(ProductLocaleContext);

  if (!context) {
    throw new Error("useProductLocale must be used inside ProductLocaleProvider.");
  }

  return context;
}

export function useProductLocaleConfig() {
  const { locale } = useProductLocale();
  return getProductLocaleConfig(locale);
}

export function useProductCopy() {
  return useProductLocale().copy;
}
