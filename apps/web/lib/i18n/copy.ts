import type { AppLocale } from "./product-locale";
import en from "./copy/en";
import uk from "./copy/uk";

export const PRODUCT_COPY = {
  uk,
  en
} as const;

export type ProductCopy = (typeof PRODUCT_COPY)[AppLocale];

export function getProductCopy(locale: AppLocale): ProductCopy {
  return PRODUCT_COPY[locale];
}
