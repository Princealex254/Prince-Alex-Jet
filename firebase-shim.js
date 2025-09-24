// Firebase-backed Supabase compatibility shim
// Loads Firebase via ESM CDN and exposes a minimal Supabase-like API on window.supabase

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  query as fsQuery,
  where,
  orderBy,
  limit as fsLimit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// Use user's provided Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyC8-TWRr_vOMTv72scXxu-9l5uVHRVputo',
  authDomain: 'group-saving-chama.firebaseapp.com',
  projectId: 'group-saving-chama',
  storageBucket: 'group-saving-chama.firebasestorage.app',
  messagingSenderId: '570981365925',
  appId: '1:570981365925:web:42422e51e4e02c6ab4f54c'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function mapFirebaseUser(user) {
  if (!user) return null;
  return { id: user.uid, email: user.email };
}

class QueryBuilder {
  constructor(tableName) {
    this.tableName = tableName;
    this.operation = 'select';
    this.payload = null;
    this.filters = [];
    this.sort = null;
    this.limitCount = null;
    this.wantSingle = false;
  }

  select() {
    this.operation = 'select';
    return this;
  }

  insert(data) {
    this.operation = 'insert';
    this.payload = data;
    // Allow chaining .select().single() after insert
    return this;
  }

  update(data) {
    this.operation = 'update';
    this.payload = data;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  order(field, { ascending = true } = {}) {
    this.sort = { field, ascending };
    return this;
  }

  limit(n) {
    this.limitCount = n;
    return this;
  }

  single() {
    this.wantSingle = true;
    return this;
  }

  async _execute() {
    try {
      const colRef = collection(db, this.tableName);

      if (this.operation === 'select') {
        const constraints = [];
        for (const f of this.filters) {
          constraints.push(where(f.field, '==', f.value));
        }
        if (this.sort) {
          constraints.push(orderBy(this.sort.field, this.sort.ascending ? 'asc' : 'desc'));
        }
        if (this.limitCount) {
          constraints.push(fsLimit(this.limitCount));
        }
        const q = constraints.length ? fsQuery(colRef, ...constraints) : colRef;
        const snap = await getDocs(q);
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return { data: this.wantSingle ? (rows[0] || null) : rows, error: null };
      }

      if (this.operation === 'insert') {
        const record = Array.isArray(this.payload) ? this.payload[0] : this.payload;
        const toInsert = { ...record };
        if (!('created_at' in toInsert)) {
          toInsert.created_at = serverTimestamp();
        }
        const docRef = await addDoc(colRef, toInsert);
        const inserted = { id: docRef.id, ...record };
        return { data: this.wantSingle ? inserted : inserted, error: null };
      }

      if (this.operation === 'update') {
        // Find docs matching filters then update each
        const constraints = [];
        for (const f of this.filters) {
          constraints.push(where(f.field, '==', f.value));
        }
        const q = constraints.length ? fsQuery(colRef, ...constraints) : colRef;
        const snap = await getDocs(q);
        const updates = [];
        for (const d of snap.docs) {
          const docRef = doc(db, this.tableName, d.id);
          const payload = { ...this.payload };
          if (!('updated_at' in payload)) {
            payload.updated_at = serverTimestamp();
          }
          await updateDoc(docRef, payload);
          updates.push({ id: d.id, ...d.data(), ...this.payload });
        }
        return { data: this.wantSingle ? (updates[0] || null) : updates, error: null };
      }

      if (this.operation === 'delete') {
        // Find docs matching filters then delete each
        const constraints = [];
        for (const f of this.filters) {
          constraints.push(where(f.field, '==', f.value));
        }
        const q = constraints.length ? fsQuery(colRef, ...constraints) : colRef;
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          const docRef = doc(db, this.tableName, d.id);
          await deleteDoc(docRef);
        }
        return { data: null, error: null };
      }

      return { data: null, error: new Error('Unsupported operation') };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  then(resolve, reject) {
    // Make this object thenable so `await queryBuilder...` works
    return this._execute().then(resolve, reject);
  }
}

function createClientShim() {
  return {
    auth: {
      async getUser() {
        const user = auth.currentUser;
        return { data: { user: mapFirebaseUser(user) }, error: null };
      },
      async signInWithPassword({ email, password }) {
        try {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          return { data: { user: mapFirebaseUser(cred.user) }, error: null };
        } catch (e) {
          return { data: null, error: e };
        }
      },
      async signUp({ email, password }) {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          return { data: { user: mapFirebaseUser(cred.user) }, error: null };
        } catch (e) {
          return { data: null, error: e };
        }
      },
      async signOut() {
        try {
          await fbSignOut(auth);
          return { error: null };
        } catch (e) {
          return { error: e };
        }
      },
      async resetPasswordForEmail(email) {
        try {
          await sendPasswordResetEmail(auth, email);
          return { error: null };
        } catch (e) {
          return { error: e };
        }
      },
      async updateUser({ password }) {
        try {
          if (!auth.currentUser) throw new Error('No current user');
          await updatePassword(auth.currentUser, password);
          return { error: null };
        } catch (e) {
          return { error: e };
        }
      },
      onAuthStateChange(callback) {
        return onAuthStateChanged(auth, (user) => {
          const event = user ? 'SIGNED_IN' : 'SIGNED_OUT';
          const session = user ? { user: mapFirebaseUser(user) } : null;
          callback(event, session);
        });
      }
    },
    from(tableName) {
      return new QueryBuilder(tableName);
    }
  };
}

// Expose global `supabase` with a createClient method for compatibility
window.supabase = {
  createClient: function createClient() {
    return createClientShim();
  }
};

