// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { api } from "../services/api";
import { CollectionStore, type CollectionContext } from "../lib/collection";

export function useCollection(
  context: CollectionContext,
  onExpired: () => void,
) {
  const storeRef = useRef<CollectionStore | null>(null);
  if (!storeRef.current) storeRef.current = new CollectionStore(api, onExpired);
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useLayoutEffect(() => {
    store.configure(context);
    return store.dispose;
  }, [
    store,
    context.userId,
    context.key,
    context.view,
    context.query,
    context.debounced,
    context.libraryId,
    context.albumId,
    context.artist,
    context.reload,
  ]);
  return {
    ...state,
    collectionReady:
      state.key === context.key && state.userId === context.userId,
    collectionError: state.error,
    refreshCollection: store.refresh,
    invalidateCollection: store.invalidate,
    loadMore: store.loadMore,
    setTracks: store.setTracks,
  };
}
