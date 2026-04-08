const { initializeApp } = require('firebase/app');
const { getFirestore, getDocs, collection } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyCSIZ00QQqAN_3bqj89r6YVrifZx9vGy20',
  authDomain: 'alozo-2633a.firebaseapp.com',
  projectId: 'alozo-2633a',
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Simple count
getDocs(collection(db, 'invoices')).then(snap => {
  console.log('Total invoices:', snap.size);
  process.exit(0);
}).catch(console.error);
