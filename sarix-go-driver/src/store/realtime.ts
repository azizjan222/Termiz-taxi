import { create } from 'zustand';
import { type DriverOrder } from '../api/driver';

export type RealtimeStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface RealtimeEvent {
  kind: 'new_order' | 'order_cancelled';
  order?: DriverOrder;
  orderId?: number;
  seq: number;
}

interface RealtimeState {
  status: RealtimeStatus;
  lastEvent: RealtimeEvent | null;

  pushNewOrder: (order: DriverOrder) => void;
  pushCancelled: (orderId: number) => void;
  setStatus: (status: RealtimeStatus) => void;
}

// Monotonically increasing sequence so consumers can process each event exactly
// once and never re-process an event on an unrelated re-render.
let seqCounter = 0;

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'closed',
  lastEvent: null,

  pushNewOrder: (order) =>
    set({ lastEvent: { kind: 'new_order', order, seq: ++seqCounter } }),

  pushCancelled: (orderId) =>
    set({ lastEvent: { kind: 'order_cancelled', orderId, seq: ++seqCounter } }),

  setStatus: (status) => set({ status }),
}));
