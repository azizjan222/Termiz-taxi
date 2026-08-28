/**
 * Realtime store tests.
 *
 * The store is plain zustand with no React dependency, and it was completely untested even
 * though two screens consume `lastEvent` and rely on `seq` being strictly monotonic to
 * process each event exactly once. A regression here shows up as a phantom incoming-order
 * popup or a missed cancellation, both of which are hard to spot by hand.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { useRealtimeStore } from '../realtime';
import type { DriverOrder } from '../../api/driver';

const order = (id: number) =>
  ({
    id,
    from_city: 'Termiz',
    to_city: 'Denov',
    price: 90000,
    commission: 9000,
    service_type: 'taxi',
    person_count: 1,
  } as unknown as DriverOrder);

describe('useRealtimeStore', () => {
  beforeEach(() => {
    useRealtimeStore.setState({ status: 'closed', lastEvent: null });
  });

  it('starts closed with no event', () => {
    const s = useRealtimeStore.getState();
    expect(s.status).toBe('closed');
    expect(s.lastEvent).toBeNull();
  });

  it('publishes a new_order event carrying the order', () => {
    useRealtimeStore.getState().pushNewOrder(order(11));
    const ev = useRealtimeStore.getState().lastEvent!;
    expect(ev.kind).toBe('new_order');
    expect(ev.order?.id).toBe(11);
  });

  it('publishes cancelled / taken events carrying the order id', () => {
    useRealtimeStore.getState().pushCancelled(22);
    expect(useRealtimeStore.getState().lastEvent).toMatchObject({
      kind: 'order_cancelled',
      orderId: 22,
    });

    useRealtimeStore.getState().pushTaken(33);
    expect(useRealtimeStore.getState().lastEvent).toMatchObject({
      kind: 'order_taken',
      orderId: 33,
    });
  });

  it('increments seq strictly, across event kinds and across resets', () => {
    // Consumers de-dupe on `seq`, so it must never repeat or go backwards — including
    // after a screen resets the store, because the counter is module-global on purpose.
    const seqs: number[] = [];
    const s = useRealtimeStore.getState();
    s.pushNewOrder(order(1));
    seqs.push(useRealtimeStore.getState().lastEvent!.seq);
    s.pushCancelled(2);
    seqs.push(useRealtimeStore.getState().lastEvent!.seq);

    useRealtimeStore.setState({ lastEvent: null });

    s.pushTaken(3);
    seqs.push(useRealtimeStore.getState().lastEvent!.seq);

    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sorted);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('tracks connection status, including the unauthorized terminal state', () => {
    const s = useRealtimeStore.getState();
    (['connecting', 'open', 'reconnecting', 'closed', 'unauthorized'] as const).forEach(
      (st) => {
        s.setStatus(st);
        expect(useRealtimeStore.getState().status).toBe(st);
      }
    );
  });

  it('setStatus does not disturb lastEvent', () => {
    useRealtimeStore.getState().pushNewOrder(order(7));
    const before = useRealtimeStore.getState().lastEvent;
    useRealtimeStore.getState().setStatus('reconnecting');
    expect(useRealtimeStore.getState().lastEvent).toBe(before);
  });
});
