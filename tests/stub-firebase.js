// Test double for js/firebase.js: "Firebase" backed by the shared in-memory fake.
const fake = window.__fake;
export const configured = window.__configured !== false;
export const F = { ...fake.F, query: c => c, orderBy: () => 0, limit: () => 0 };
const auth = { currentUser: null };
export const A = {
  auth,
  onAuthStateChanged: (a, cb) => setTimeout(() => { a.currentUser = { uid: window.__uid, isAnonymous: window.__anon !== false, displayName: window.__gname || '', providerData: [] }; cb(a.currentUser); }, 0),
  signInAnonymously: async () => {}, signOut: async () => {},
  GoogleAuthProvider: class { static credentialFromError() { return {}; } },
  signInWithPopup: async () => {}, linkWithPopup: async () => {}, signInWithCredential: async () => {}
};
