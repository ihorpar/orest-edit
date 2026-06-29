"use client";

import {
  getLegacySpellcheckDictionaryDbName,
  getProductLocaleConfig,
  getSpellcheckDictionaryDbName,
  type AppLocale
} from "../i18n/product-locale";

const SPELLCHECK_DICTIONARY_STORE_NAME = "words";
const SPELLCHECK_DICTIONARY_DB_VERSION = 1;

interface SpellcheckDictionaryRecord {
  word: string;
  createdAt: string;
}

export function normalizeSpellcheckDictionaryWord(value: string, locale: AppLocale = "uk"): string {
  return value.trim().toLocaleLowerCase(getProductLocaleConfig(locale).displayLocale);
}

export function createSpellcheckDictionarySet(words: Iterable<string>, locale: AppLocale = "uk"): Set<string> {
  const normalizedWords = new Set<string>();

  for (const word of words) {
    const normalizedWord = normalizeSpellcheckDictionaryWord(word, locale);

    if (normalizedWord) {
      normalizedWords.add(normalizedWord);
    }
  }

  return normalizedWords;
}

export function isSpellcheckWordInDictionary(word: string, dictionaryWords: Iterable<string>, locale: AppLocale = "uk"): boolean {
  const normalizedWord = normalizeSpellcheckDictionaryWord(word, locale);

  if (!normalizedWord) {
    return false;
  }

  return createSpellcheckDictionarySet(dictionaryWords, locale).has(normalizedWord);
}

export function filterSpellcheckIssuesByDictionary<T extends { badText: string }>(
  issues: T[],
  dictionaryWords: Iterable<string>,
  locale: AppLocale = "uk"
): T[] {
  const dictionary = createSpellcheckDictionarySet(dictionaryWords, locale);

  if (dictionary.size === 0) {
    return issues;
  }

  return issues.filter((issue) => !dictionary.has(normalizeSpellcheckDictionaryWord(issue.badText, locale)));
}

export async function readSpellcheckDictionaryWords(locale: AppLocale = "uk"): Promise<string[]> {
  const records = await readSpellcheckDictionaryRecords(getSpellcheckDictionaryDbName(locale));

  if (records.length > 0 || locale !== "uk") {
    return Array.from(createSpellcheckDictionarySet(records.map((record) => record.word), locale));
  }

  const legacyRecords = await readSpellcheckDictionaryRecords(getLegacySpellcheckDictionaryDbName());
  const legacyWords = Array.from(createSpellcheckDictionarySet(legacyRecords.map((record) => record.word), locale));

  await Promise.all(legacyWords.map((word) => addSpellcheckDictionaryWord(word, locale)));
  return legacyWords;
}

export async function addSpellcheckDictionaryWord(word: string, locale: AppLocale = "uk"): Promise<void> {
  const normalizedWord = normalizeSpellcheckDictionaryWord(word, locale);

  if (!normalizedWord) {
    return;
  }

  const database = await openSpellcheckDictionaryDatabase(getSpellcheckDictionaryDbName(locale));

  if (!database) {
    return;
  }

  const transaction = database.transaction(SPELLCHECK_DICTIONARY_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SPELLCHECK_DICTIONARY_STORE_NAME);
  const record: SpellcheckDictionaryRecord = {
    word: normalizedWord,
    createdAt: new Date().toISOString()
  };

  await requestToPromise(store.put(record));
  await transactionToPromise(transaction);
}

async function readSpellcheckDictionaryRecords(dbName: string): Promise<SpellcheckDictionaryRecord[]> {
  const database = await openSpellcheckDictionaryDatabase(dbName);

  if (!database) {
    return [];
  }

  const transaction = database.transaction(SPELLCHECK_DICTIONARY_STORE_NAME, "readonly");
  const store = transaction.objectStore(SPELLCHECK_DICTIONARY_STORE_NAME);
  const records = (await requestToPromise(store.getAll())) as SpellcheckDictionaryRecord[];
  await transactionToPromise(transaction);

  return records;
}

function openSpellcheckDictionaryDatabase(dbName: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(dbName, SPELLCHECK_DICTIONARY_DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error("Не вдалося відкрити словник правопису."));
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(SPELLCHECK_DICTIONARY_STORE_NAME)) {
        database.createObjectStore(SPELLCHECK_DICTIONARY_STORE_NAME, { keyPath: "word" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.oncomplete = () => resolve();
  });
}
