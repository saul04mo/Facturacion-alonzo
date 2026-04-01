import { useEffect } from 'react';
import { collection, doc, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAppStore } from '@/store/appStore';
import type { Product, AppUser, Invoice, Employee, Coupon, Promotion } from '@/types';

export function useFirestoreListeners() {
  const currentUser = useAppStore((s) => s.currentUser);
  const setProducts = useAppStore((s) => s.setProducts);
  const setClients = useAppStore((s) => s.setClients);
  const setInvoices = useAppStore((s) => s.setInvoices);
  const setUsers = useAppStore((s) => s.setUsers);
  const setEmployees = useAppStore((s) => s.setEmployees);
  const setCoupons = useAppStore((s) => s.setCoupons);
  const setPromotions = useAppStore((s) => s.setPromotions);
  const setExchangeRate = useAppStore((s) => s.setExchangeRate);
  const setLoading = useAppStore((s) => s.setLoading);

  useEffect(() => {
    if (!currentUser) return;

    // Mark all as loading on fresh mount
    setLoading('products', true);
    setLoading('clients', true);
    setLoading('invoices', true);
    setLoading('exchangeRate', true);
    setLoading('users', true);

    const unsubs: (() => void)[] = [];

    // Exchange rate — tiny doc, loads first
    unsubs.push(
      onSnapshot(doc(db, 'config', 'exchangeRate'), (snap) => {
        setExchangeRate(snap.exists() && snap.data().value ? snap.data().value : 1);
      })
    );

    // Products
    unsubs.push(
      onSnapshot(collection(db, 'products'), (snap) => {
        setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Product[]);
      })
    );

    // Clients are no longer loaded en-masse globally to save bandwidth and cost (3000+ docs).
    // They are searched under demand via API.
    setLoading('clients', false);

    // Invoices — 500 most recent
    unsubs.push(
      onSnapshot(
        query(collection(db, 'invoices'), orderBy('date', 'desc'), limit(500)),
        (snap) => {
          setInvoices(snap.docs.map((d) => {
            const data = d.data();
            let s = data.status;
            if (data.deliveryPaidInStore === false && s === 'Finalizado') s = 'Pendiente de pago';
            if (data.deliveryPaidInStore === true && s === 'Pendiente de pago') s = 'Finalizado';
            return { id: d.id, ...data, status: s };
          }) as Invoice[]);
        }
      )
    );

    // Users (admin only)
    if (currentUser.rol === 'administrador') {
      unsubs.push(
        onSnapshot(collection(db, 'users'), (snap) => {
          setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppUser[]);
        })
      );
    } else {
      setLoading('users', false);
    }

    // Employees (for payroll module)
    unsubs.push(
      onSnapshot(collection(db, 'employees'), (snap) => {
        setEmployees(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Employee[]);
      })
    );

    // Coupons
    unsubs.push(
      onSnapshot(collection(db, 'coupons'), (snap) => {
        setCoupons(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Coupon[]);
      })
    );

    // Promotions
    unsubs.push(
      onSnapshot(collection(db, 'promotions'), (snap) => {
        setPromotions(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Promotion[]);
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [currentUser, setProducts, setClients, setInvoices, setUsers, setEmployees, setCoupons, setPromotions, setExchangeRate, setLoading]);
}
