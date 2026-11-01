// Minimal IndexedDB wrapper: project state in "projects", the video file in "files" (written once)
export type Saved = { id: string; name: string; savedAt: number; state: any }

const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('clipforge', 1)
  r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('files') }
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((res, rej) => {
    const r = fn(db.transaction(store, mode).objectStore(store))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }))
}
export const putProject = (p: Saved) => tx('projects', 'readwrite', s => s.put(p))
export const listProjects = () => tx<Saved[]>('projects', 'readonly', s => s.getAll())
export const putFile = (id: string, f: File) => tx('files', 'readwrite', s => s.put(f, id))
export const getFile = (id: string) => tx<File | undefined>('files', 'readonly', s => s.get(id))
export const delProject = (id: string) => Promise.all([tx('projects', 'readwrite', s => s.delete(id)), tx('files', 'readwrite', s => s.delete(id))])
