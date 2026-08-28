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
});
