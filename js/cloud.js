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
    collection, doc, onSnapshot, runTransaction, serverTimestamp,
    setDoc, updateDoc, deleteDoc, writeBatch, getDocs, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const planRef = doc(db, 'plans', PLAN_ID);
const tokensRef = collection(planRef, 'tokens');
const discoveriesRef = collection(planRef, 'discoveries');
const snapshotsRef = collection(planRef, 'snapshots');

function millis(value) {
    return value && typeof value.toMillis === 'function' ? value.toMillis() : (value || 0);
}

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

    /* Transaction optimiste : la révision locale doit correspondre à la
       révision distante. `force` reste réservé à une résolution explicite. */
    savePlan(plan, options = {}) {
        const baseRevision = Number.isInteger(plan.revision) ? plan.revision : 0;
        const force = options.force === true;

        return runTransaction(db, async transaction => {
            const snapshot = await transaction.get(planRef);
            const remote = snapshot.exists() ? snapshot.data() : null;
            const remoteRevision = remote && Number.isInteger(remote.revision)
                ? remote.revision : 0;

            if (snapshot.exists() && !force && remoteRevision !== baseRevision) {
                const remotePlan = { ...remote };
                delete remotePlan.savedAt;
                const error = new Error('Le plan distant a été modifié depuis le dernier chargement.');
                error.code = 'revision-conflict';
                error.remotePlan = remotePlan;
                throw error;
            }

            const revision = remoteRevision + 1;
            transaction.set(planRef, {
                ...plan,
                schemaVersion: 2,
                revision,
                savedAt: serverTimestamp()
            });
            return { revision };
        });
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
    },

    async createSnapshot(plan, label) {
        const createdAt = Date.now();
        const safeLabel = String(label || 'snapshot').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48);
        const snapshotId = createdAt + '-' + safeLabel;
        await setDoc(doc(snapshotsRef, snapshotId), {
            label: label || 'Snapshot manuel',
            sourceRevision: Number.isInteger(plan.revision) ? plan.revision : 0,
            schemaVersion: plan.schemaVersion,
            createdAt: serverTimestamp(),
            plan
        });
        await this.pruneSnapshots(15);
        return { id: snapshotId };
    },

    async listSnapshots() {
        const result = await getDocs(query(snapshotsRef, orderBy('createdAt', 'desc')));
        return result.docs.map(item => {
            const data = item.data();
            return {
                id: item.id,
                label: data.label || 'Snapshot',
                sourceRevision: data.sourceRevision || 0,
                schemaVersion: data.schemaVersion || 1,
                createdAt: millis(data.createdAt) || Number(item.id.split('-')[0]) || 0,
                plan: data.plan || null
            };
        });
    },

    deleteSnapshot(snapshotId) {
        return deleteDoc(doc(snapshotsRef, snapshotId));
    },

    async pruneSnapshots(maximum = 15) {
        const snapshots = await getDocs(query(snapshotsRef, orderBy('createdAt', 'desc')));
        const extras = snapshots.docs.slice(Math.max(0, maximum));
        if (!extras.length) return 0;
        const batch = writeBatch(db);
        extras.forEach(item => batch.delete(item.ref));
        await batch.commit();
        return extras.length;
    },

    saveToken(token) {
        return setDoc(doc(tokensRef, token.id), {
            name: token.name,
            shortLabel: token.shortLabel,
            color: token.color,
            icon: token.icon,
            floorId: token.floorId,
            x: token.x,
            y: token.y,
            playerMovable: token.playerMovable,
            visible: token.visible,
            locked: token.locked,
            updatedAt: serverTimestamp()
        });
    },

    updateTokenPosition(position) {
        return updateDoc(doc(tokensRef, position.id), {
            floorId: position.floorId,
            x: position.x,
            y: position.y,
            updatedAt: serverTimestamp()
        });
    },

    deleteToken(tokenId) {
        return deleteDoc(doc(tokensRef, tokenId));
    },

    subscribeTokens(cb, onError) {
        return onSnapshot(tokensRef, snapshot => {
            cb(snapshot.docs.map(item => ({
                id: item.id,
                ...item.data(),
                updatedAt: millis(item.data().updatedAt)
            })), snapshot.metadata.hasPendingWrites);
        }, onError);
    },

    saveDiscovery(discovery) {
        return setDoc(doc(discoveriesRef, discovery.id), {
            kind: discovery.kind,
            elementId: discovery.elementId,
            floorId: discovery.floorId,
            discoveredBy: discovery.discoveredBy,
            discoveredAt: serverTimestamp()
        });
    },

    async deleteDiscoveries(ids) {
        if (!ids.length) return;
        const batch = writeBatch(db);
        ids.forEach(id => batch.delete(doc(discoveriesRef, id)));
        return batch.commit();
    },

    subscribeDiscoveries(cb, onError) {
        return onSnapshot(discoveriesRef, snapshot => {
            cb(snapshot.docs.map(item => ({
                id: item.id,
                ...item.data(),
                discoveredAt: millis(item.data().discoveredAt)
            })), snapshot.metadata.hasPendingWrites);
        }, onError);
    }
};

document.dispatchEvent(new CustomEvent('cloud-ready'));
