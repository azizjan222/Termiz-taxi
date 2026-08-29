import { afterEach, describe, expect, it } from '@jest/globals';

import { useOrderStore } from '../order';

describe('useOrderStore', () => {
  afterEach(() => {
    useOrderStore.getState().reset();
  });

  it('restores every order draft field to its initial value', () => {
    const store = useOrderStore.getState();

    store.setRoute('Termiz', 'Denov');
    store.setField('fromAddress', 'Termiz markazi');
    store.setField('toAddress', 'Denov markazi');
    store.setField('fromLat', 37.224);
    store.setField('fromLon', 67.278);
    store.setField('toLat', 38.267);
    store.setField('toLon', 67.897);
    store.setField('serviceType', 'full_car');
    store.setField('personCount', 4);
    store.setField('maleCount', 2);
    store.setField('femaleCount', 2);
    store.setField('departureTime', 'tomorrow');
    store.setField('note', 'Test izohi');
    store.setField('paymentMethod', 'card');
    store.setField('promoCode', 'PROMO');
    store.setField('hasRoofRack', true);
    store.setField('femaleOnly', true);

    useOrderStore.getState().reset();

    expect(useOrderStore.getState()).toMatchObject({
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
    });
  });

  describe('setPersonCount', () => {
    // male_count/female_count are sent on every order. They used to be maintained by
    // hand on only one of the four screens that change the party size, so a 4-passenger
    // order went out as person_count: 4, male_count: 1, female_count: 0.
    it('keeps maleCount + femaleCount equal to personCount', () => {
      useOrderStore.getState().setPersonCount(4);

      const { personCount, maleCount, femaleCount } = useOrderStore.getState();
      expect(personCount).toBe(4);
      expect(maleCount + femaleCount).toBe(4);
    });

    it('preserves an explicit femaleCount and derives maleCount from it', () => {
      useOrderStore.getState().setField('femaleCount', 2);
      useOrderStore.getState().setPersonCount(3);

      expect(useOrderStore.getState()).toMatchObject({
        personCount: 3,
        femaleCount: 2,
        maleCount: 1,
      });
    });

    it('never lets femaleCount exceed a smaller new party size', () => {
      useOrderStore.getState().setField('femaleCount', 4);
      useOrderStore.getState().setPersonCount(2);

      expect(useOrderStore.getState()).toMatchObject({
        personCount: 2,
        femaleCount: 2,
        maleCount: 0,
      });
    });

    it('clamps a zero or negative count to a single passenger', () => {
      useOrderStore.getState().setPersonCount(0);

      expect(useOrderStore.getState()).toMatchObject({
        personCount: 1,
        maleCount: 1,
        femaleCount: 0,
      });
    });
  });
});
