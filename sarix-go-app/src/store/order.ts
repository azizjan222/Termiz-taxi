import { create } from 'zustand';
import type { ServiceType } from '../api/orders';

interface OrderDraft {
  fromCity: string | null;
  toCity: string | null;
  fromAddress: string;
  toAddress: string;
  fromLat: number | null;
  fromLon: number | null;
  toLat: number | null;
  toLon: number | null;
  serviceType: ServiceType;
  personCount: number;
  maleCount: number;
  femaleCount: number;
  departureTime: string;
  note: string;
  paymentMethod: 'cash' | 'card' | 'balance';
  promoCode: string;
  hasRoofRack: boolean;
  femaleOnly: boolean;
}

interface OrderState extends OrderDraft {
  setField: <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) => void;
  setRoute: (from: string, to: string) => void;
  reset: () => void;
}

const initialDraft: OrderDraft = {
  fromCity: null,
  toCity: null,
  fromAddress: '',
  toAddress: '',
  fromLat: null,
  fromLon: null,
  toLat: null,
  toLon: null,
  serviceType: 'taxi',
  personCount: 1,
  maleCount: 1,
  femaleCount: 0,
  departureTime: 'Hozir',
  note: '',
  paymentMethod: 'cash',
  promoCode: '',
  hasRoofRack: false,
  femaleOnly: false,
};

export const useOrderStore = create<OrderState>((set) => ({
  ...initialDraft,

  setField: (key, value) => set({ [key]: value } as any),

  setRoute: (from, to) => set({ fromCity: from, toCity: to }),

  reset: () => set(initialDraft),
}));
