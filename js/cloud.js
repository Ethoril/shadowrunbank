/* ============================================================
   cloud.js — Module ES : pont entre le SDK Firebase (modules)
   et les scripts classiques de l'appli. Expose window.Cloud
   (auth Google + lecture/écriture du plan Firestore) puis
   émet l'événement 'cloud-ready'.

   Si ce module ne charge pas (file://, hors-ligne), l'appli
   fonctionne en mode localStorage comme avant.
   ============================================================ */

import { auth, db, ADMIN_EMAIL, PLAN_ID } from './firebase-init.js';
import {
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    doc, setDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const planRef = doc(db, 'plans', PLAN_ID);

window.Cloud = {
    ADMIN_EMAIL,

    isAdmin(user) {
        return !!user && user.email === ADMIN_EMAIL;
    },

    login() {
        return signInWithPopup(auth, new GoogleAuthProvider());
    },

    logout() {
        return signOut(auth);
    },

    /* cb(user|null) — appelé immédiatement avec la session restaurée */
    watchAuth(cb) {
        return onAuthStateChanged(auth, cb);
    },

    /* Écrase le document plans/main avec le plan complet (1 doc = 1 write) */
    savePlan(plan) {
        return setDoc(planRef, { ...plan, savedAt: serverTimestamp() });
    },

    /* cb(planData|null, hasPendingWrites) — null si le doc n'existe pas.
       onError(err) — ex. règles non déployées, projet mal configuré. */
    subscribePlan(cb, onError) {
        return onSnapshot(planRef, snap => {
            let data = null;
            if (snap.exists()) {
                data = snap.data();
                delete data.savedAt; // Timestamp Firestore, non sérialisable en JSON
            }
            cb(data, snap.metadata.hasPendingWrites);
        }, onError);
    }
};

document.dispatchEvent(new CustomEvent('cloud-ready'));
