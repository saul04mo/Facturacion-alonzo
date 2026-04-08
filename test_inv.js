import { initializeApp } from 'firebase/app';
import { getFirestore, query, collection, where, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCSIZ00QQqAN_3bqj89r6YVrifZx9vGy20',
  authDomain: 'alozo-2633a.firebaseapp.com',
  projectId: 'alozo-2633a',
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const q = query(collection(db, 'invoices'), where('numericId', '==', 3892));
getDocs(q).then(snap => {
  snap.forEach(doc => {
    console.log(JSON.stringify(doc.data(), null, 2));
  });
  process.exit(0);
}).catch(console.error);
