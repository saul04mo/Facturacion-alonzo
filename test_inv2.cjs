const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, orderBy, limit, getDocs } = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyCSIZ00QQqAN_3bqj89r6YVrifZx9vGy20',
  projectId: 'alozo-2633a',
});
const db = getFirestore(app);

async function run() {
  const q = query(collection(db, 'invoices'), orderBy('date', 'desc'), limit(1));
  const snap = await getDocs(q);
  snap.forEach(d => console.log(Object.keys(d.data())));
}
run().catch(console.error);
