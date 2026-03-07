"use client";

import { createPatchId } from "./patch-contract";

const editorAssetDbName = "orest-editor-assets-v1";
const editorAssetStoreName = "assets";
const objectUrlCache = new Map<string, string>();

interface StoredEditorAssetRecord {
  assetId: string;
  mimeType: string;
  blob: Blob;
  createdAt: string;
}

export function createEditorAssetToken(assetId: string): string {
  return `asset:${assetId}`;
}

export function parseEditorAssetToken(source: string): string | null {
  const normalized = source.trim();

  if (!normalized.startsWith("asset:")) {
    return null;
  }

  const assetId = normalized.slice("asset:".length).trim();
  return assetId || null;
}

export async function storeEditorAssetFromBlob(input: {
  blob: Blob;
  assetId?: string;
  mimeType?: string;
}): Promise<{ assetId: string; token: string; mimeType: string }> {
  const assetId = input.assetId?.trim() || createPatchId("asset-local");
  const mimeType = input.mimeType?.trim() || input.blob.type || "application/octet-stream";
  const database = await openEditorAssetDatabase();
  const transaction = database.transaction(editorAssetStoreName, "readwrite");
  const store = transaction.objectStore(editorAssetStoreName);
  const record: StoredEditorAssetRecord = {
    assetId,
    mimeType,
    blob: input.blob,
    createdAt: new Date().toISOString()
  };

  await requestToPromise(store.put(record));
  await transactionToPromise(transaction);

  const existingUrl = objectUrlCache.get(assetId);

  if (existingUrl) {
    URL.revokeObjectURL(existingUrl);
    objectUrlCache.delete(assetId);
  }

  return {
    assetId,
    token: createEditorAssetToken(assetId),
    mimeType
  };
}

export async function storeEditorAssetFromDataUrl(input: {
  dataUrl: string;
  assetId?: string;
  mimeType?: string;
}): Promise<{ assetId: string; token: string; mimeType: string }> {
  const blob = dataUrlToBlob(input.dataUrl, input.mimeType);
  return storeEditorAssetFromBlob({
    blob,
    assetId: input.assetId,
    mimeType: blob.type || input.mimeType
  });
}

export async function resolveEditorAssetUrl(source: string): Promise<string | null> {
  const assetId = parseEditorAssetToken(source);

  if (!assetId) {
    return source.trim() || null;
  }

  const cachedUrl = objectUrlCache.get(assetId);

  if (cachedUrl) {
    return cachedUrl;
  }

  const database = await openEditorAssetDatabase();
  const transaction = database.transaction(editorAssetStoreName, "readonly");
  const store = transaction.objectStore(editorAssetStoreName);
  const record = (await requestToPromise(store.get(assetId))) as StoredEditorAssetRecord | undefined;
  await transactionToPromise(transaction);

  if (!record?.blob) {
    return null;
  }

  const objectUrl = URL.createObjectURL(record.blob);
  objectUrlCache.set(assetId, objectUrl);
  return objectUrl;
}

function openEditorAssetDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступний у цьому середовищі."));
      return;
    }

    const request = window.indexedDB.open(editorAssetDbName, 1);

    request.onerror = () => reject(request.error ?? new Error("Не вдалося відкрити asset database."));
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(editorAssetStoreName)) {
        database.createObjectStore(editorAssetStoreName, { keyPath: "assetId" });
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

function dataUrlToBlob(dataUrl: string, fallbackMimeType?: string): Blob {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new Error("Некоректний data URL для зображення.");
  }

  const mimeType = match[1] || fallbackMimeType || "application/octet-stream";
  const encodedData = match[2] || "";
  const binary = atob(encodedData);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}
