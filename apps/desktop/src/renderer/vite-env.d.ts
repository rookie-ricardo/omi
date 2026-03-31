/// <reference types="vite/client" />

declare global {
  interface Window {
    omi: {
      invoke<T>(method: string, params?: Record<string, unknown>): Promise<T>;
      subscribe(listener: (event: unknown) => void): () => void;
    };
  }
}

export {};
