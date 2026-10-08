// Tiny in-memory stand-in for the Firestore calls rooms.js uses. Snapshots arrive asynchronously, like the real thing.
export function makeFake() {
  const store = new Map();            // path -> data
  const listeners = new Set();        // {path, kind, fn}
  const clone = o => JSON.parse(JSON.stringify(o, (k, v) => v instanceof Date ? v.getTime() : v));
  const parts = p => p.split('/');
  const docSnap = path => ({ id: parts(path).pop(), exists: () => store.has(path), data: () => store.has(path) ? clone(store.get(path)) : undefined });
  const children = col => [...store.keys()].filter(k => k.startsWith(col + '/') && parts(k).length === parts(col).length + 1).sort();
  const notify = changed => queueMicrotask(() => { for (const l of [...listeners]) {
    if (l.kind === 'doc' && l.path === changed) l.fn(docSnap(changed));
    if (l.kind === 'col' && changed.startsWith(l.path + '/') && parts(changed).length === parts(l.path).length + 1) l.fn({ docs: children(l.path).map(docSnap) });
  } });
  const F = {
    db: {},
    doc: (db, ...segs) => ({ kind: 'doc', path: segs.join('/') }),
    collection: (db, ...segs) => ({ kind: 'col', path: segs.join('/') }),
    serverTimestamp: () => Date.now(),
    getDoc: async r => docSnap(r.path),
    getDocs: async r => ({ docs: children(r.path).map(docSnap) }),
    setDoc: async (r, d) => { store.set(r.path, clone(d)); notify(r.path); },
    updateDoc: async (r, d) => { if (!store.has(r.path)) throw new Error('no doc ' + r.path); store.set(r.path, { ...store.get(r.path), ...clone(d) }); notify(r.path); },
    deleteDoc: async r => { store.delete(r.path); notify(r.path); },
    onSnapshot: (r, fn) => { const l = { path: r.path, kind: r.kind === 'doc' ? 'doc' : 'col', fn }; listeners.add(l);
      queueMicrotask(() => l.kind === 'doc' ? fn(docSnap(r.path)) : fn({ docs: children(r.path).map(docSnap) })); return () => listeners.delete(l); },
    runTransaction: async (db, fn) => {
      const tx = { get: async r => docSnap(r.path), update: (r, d) => { tx._w.push([r, d]); }, _w: [] };
      await fn(tx); for (const [r, d] of tx._w) await F.updateDoc(r, d);
    }
  };
  return { F, store };
}
