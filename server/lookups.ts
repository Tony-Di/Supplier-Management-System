import { ValidationError } from "./errors";
import type { Store } from "./storeShape";

export function findSupplier(store: Store, id: string) {
  return store.suppliers.find((supplier) => supplier.id === id);
}

export function findModel(store: Store, id: string) {
  return store.models.find((model) => model.id === id);
}

export function findItem(store: Store, id: string) {
  return store.items.find((item) => item.id === id);
}

export function findDrawingSet(store: Store, id: string) {
  return store.drawingSets.find((drawingSet) => drawingSet.id === id);
}

export function findDrawingItem(store: Store, drawingSetId: string, drawingItemId: string) {
  return findDrawingSet(store, drawingSetId)?.drawingItems.find((drawingItem) => drawingItem.id === drawingItemId);
}

export function findProject(store: Store, id: string) {
  return store.projects.find((project) => project.id === id);
}

export function assertReferences(ids: string[], finder: (id: string) => unknown, label: string) {
  const missing = ids.filter((id) => !finder(id));
  if (missing.length > 0) {
    throw new ValidationError(`${label} not found: ${missing.join(", ")}`);
  }
}
