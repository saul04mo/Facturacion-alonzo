const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyCSIZ00QQqAN_3bqj89r6YVrifZx9vGy20',
  projectId: 'alozo-2633a',
});
const db = getFirestore(app);

async function run() {
  const q = query(collection(db, 'invoices'), where('numericId', '==', 3892));
  const snap = await getDocs(q);
  snap.forEach(d => console.log(JSON.stringify(d.data(), null, 2)));
}
run().catch(console.error);
