import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface KeysStore {
  googleAiSet: boolean;
  openAiSet: boolean;
  loaded: boolean;
  refreshKeys: () => Promise<void>;
}

export const useKeysStore = create<KeysStore>((set) => ({
  googleAiSet: false,
  openAiSet: false,
  loaded: false,

  refreshKeys: async () => {
    try {
      const [google, openai] = await Promise.all([
        invoke<boolean>("test_api_key", { account: "google_ai" }).catch(() => false),
        invoke<boolean>("test_api_key", { account: "openai" }).catch(() => false),
      ]);
      set({
        googleAiSet: google,
        openAiSet: openai,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
}));
