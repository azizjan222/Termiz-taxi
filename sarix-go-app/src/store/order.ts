import { create } from 'zustand';
import type { ServiceType } from '../api/orders';
import type { DepartureCode } from '../utils/departureTime';

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
  /**
   * Stable preset code, NOT a display string. Rendered via `departure.<code>` and
   * converted to the canonical wire value with `DEPARTURE_WIRE` only at submit time.
   */
  departureTime: DepartureCode;
  note: string;
  paymentMethod: 'cash' | 'card' | 'balance';
  promoCode: string;
  hasRoofRack: boolean;
  femaleOnly: boolean;
}

interface OrderState extends OrderDraft {
  setField: <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) => void;
  /**
   * Set the party size, keeping `maleCount + femaleCount === personCount`.
   *
   * Use this instead of `setField('personCount', n)`. The counts are sent to the server
   * on every order, but they were only ever half-maintained: `femaleCount` was written
   * nowhere at all (so it stayed 0 forever) and `maleCount` was set on exactly one of the
   * four screens that change the party size. A 4-passenger order therefore went out as
   * `person_count: 4, male_count: 1, female_count: 0`, and the full-car path left
   * whatever the previous selection happened to be. There is no gender-breakdown UI, so
   * the honest representation is "all unspecified" — but it has to at least add up.
   */
  setPersonCount: (n: number) => void;
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
  departureTime: 'now',
  note: '',
  paymentMethod: 'cash',
  promoCode: '',
  hasRoofRack: false,
  femaleOnly: false,
};

export const useOrderStore = create<OrderState>((set) => ({
  ...initialDraft,

  setField: (key, value) => set({ [key]: value } as any),

  setPersonCount: (n) =>
    set((state) => {
      const total = Math.max(1, Math.round(n) || 1);
      // Preserve an explicit female count if one was ever set, but never let the two
      // exceed the party size.
      const female = Math.min(state.femaleCount, total);
      return { personCount: total, femaleCount: female, maleCount: total - female };
    }),

  setRoute: (from, to) => set({ fromCity: from, toCity: to }),

  reset: () => set(initialDraft),
}));
