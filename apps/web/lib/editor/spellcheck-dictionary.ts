"use client";

const SPELLCHECK_DICTIONARY_DB_NAME = "orest-spellcheck-dictionary-v1";
const SPELLCHECK_DICTIONARY_STORE_NAME = "words";
const SPELLCHECK_DICTIONARY_DB_VERSION = 1;

interface SpellcheckDictionaryRecord {
  word: string;
  createdAt: string;
}

export function normalizeSpellcheckDictionaryWord(value: string): string {
  return value.trim().toLocaleLowerCase("uk-UA");
}

export function createSpellcheckDictionarySet(words: Iterable<string>): Set<string> {
  const normalizedWords = new Set<string>();

  for (const word of words) {
    const normalizedWord = normalizeSpellcheckDictionaryWord(word);

    if (normalizedWord) {
      normalizedWords.add(normalizedWord);
    }
  }

  return normalizedWords;
}

export function isSpellcheckWordInDictionary(word: string, dictionaryWords: Iterable<string>): boolean {
  const normalizedWord = normalizeSpellcheckDictionaryWord(word);

  if (!normalizedWord) {
    return false;
  }

  return createSpellcheckDictionarySet(dictionaryWords).has(normalizedWord);
}

export function filterSpellcheckIssuesByDictionary<T extends { badText: string }>(
  issues: T[],
  dictionaryWords: Iterable<string>
): T[] {
  const dictionary = createSpellcheckDictionarySet(dictionaryWords);

  if (dictionary.size === 0) {
    return issues;
  }

  return issues.filter((issue) => !dictionary.has(normalizeSpellcheckDictionaryWord(issue.badText)));
}

export async function readSpellcheckDictionaryWords(): Promise<string[]> {
  const database = await openSpellcheckDictionaryDatabase();

  if (!database) {
    return [];
  }

  const transaction = database.transaction(SPELLCHECK_DICTIONARY_STORE_NAME, "readonly");
  const store = transaction.objectStore(SPELLCHECK_DICTIONARY_STORE_NAME);
  const records = (await requestToPromise(store.getAll())) as SpellcheckDictionaryRecord[];
  await transactionToPromise(transaction);

  return Array.from(createSpellcheckDictionarySet(records.map((record) => record.word)));
}

export async function addSpellcheckDictionaryWord(word: string): Promise<void> {
  const normalizedWord = normalizeSpellcheckDictionaryWord(word);

  if (!normalizedWord) {
    return;
  }

  const database = await openSpellcheckDictionaryDatabase();

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

function openSpellcheckDictionaryDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(SPELLCHECK_DICTIONARY_DB_NAME, SPELLCHECK_DICTIONARY_DB_VERSION);

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
