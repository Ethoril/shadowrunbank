/* ============================================================
   firebase-init.js — Module ES : config du projet Firebase,
   initialisation, exports app/auth/db + constantes.
   Chargé via <script type="module"> (cloud.js) ; le reste de
   l'appli reste en scripts classiques et passe par window.Cloud.
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyCysxbui4KEsgEZxLOXVL-tjOimQJNBa8g",
    authDomain: "shadowrun-bank-94628.firebaseapp.com",
    projectId: "shadowrun-bank-94628",
    storageBucket: "shadowrun-bank-94628.firebasestorage.app",
    messagingSenderId: "452618792223",
    appId: "1:452618792223:web:6697233218e445dfa2d42a"
};

export const ADMIN_EMAIL = 'ethoril@gmail.com';
export const PLAN_ID = 'main';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
