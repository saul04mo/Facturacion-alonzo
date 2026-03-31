import { create } from 'zustand';
import type { AppUser, Product, Client, Invoice, CurrentSale, Employee } from '@/types';
import type { Currency } from '@/config/constants';

type Theme = 'light' | 'dark';

interface LoadingState {
  products: boolean;
  clients: boolean;
  invoices: boolean;
  users: boolean;
  exchangeRate: boolean;
}

interface AppState {
  currentUser: AppUser | null;
  setCurrentUser: (user: AppUser | null) => void;

  loading: LoadingState;
  setLoading: (key: keyof LoadingState, value: boolean) => void;
  isDataReady: () => boolean;

  products: Product[];
  setProducts: (products: Product[]) => void;
  clients: Client[];
  setClients: (clients: Client[]) => void;
  invoices: Invoice[];
  setInvoices: (invoices: Invoice[]) => void;
  users: AppUser[];
  setUsers: (users: AppUser[]) => void;

  exchangeRate: number;
  setExchangeRate: (rate: number) => void;

  displayCurrency: Currency;
  toggleCurrency: () => void;
  setCurrency: (currency: Currency) => void;

  currentSale: CurrentSale;
  setCurrentSale: (sale: CurrentSale) => void;
  resetCurrentSale: () => void;

  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  employees: Employee[];
  setEmployees: (employees: Employee[]) => void;
}

const INITIAL_SALE: CurrentSale = {
  items: [], clientId: null, total: 0, payments: [],
  totalDiscount: { type: 'none', value: 0 }, deliveryType: 'pickup',
  deliveryCostUsd: 0, deliveryPaidInStore: true, observation: null,
};

// Read saved theme from localStorage
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem('pos-alonzo-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  // Respect system preference
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export const useAppStore = create<AppState>((set, get) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  loading: { products: true, clients: true, invoices: true, users: true, exchangeRate: true },
  setLoading: (key, value) => set((s) => ({ loading: { ...s.loading, [key]: value } })),
  isDataReady: () => { const l = get().loading; return !l.products && !l.invoices && !l.exchangeRate; },

  products: [],
  setProducts: (products) => set({ products, loading: { ...get().loading, products: false } }),
  clients: [],
  setClients: (clients) => set({ clients, loading: { ...get().loading, clients: false } }),
  invoices: [],
  setInvoices: (invoices) => set({ invoices, loading: { ...get().loading, invoices: false } }),
  users: [],
  setUsers: (users) => set({ users, loading: { ...get().loading, users: false } }),

  exchangeRate: 1,
  setExchangeRate: (rate) => set({ exchangeRate: rate, loading: { ...get().loading, exchangeRate: false } }),

  displayCurrency: 'usd',
  toggleCurrency: () => set((s) => ({ displayCurrency: s.displayCurrency === 'usd' ? 'ves' : 'usd' })),
  setCurrency: (currency) => set({ displayCurrency: currency }),

  currentSale: { ...INITIAL_SALE },
  setCurrentSale: (sale) => set({ currentSale: sale }),
  resetCurrentSale: () => set({ currentSale: { ...INITIAL_SALE, items: [], payments: [] } }),

  // Theme
  theme: getInitialTheme(),
  setTheme: (theme) => {
    localStorage.setItem('pos-alonzo-theme', theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('pos-alonzo-theme', next);
    set({ theme: next });
  },

  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  employees: [],
  setEmployees: (employees) => set({ employees }),
}));
