// r2.12: score the current inventory, including removal events.
PlayerEvents.inventoryChanged(function (event) {
  if (typeof global.kjsProgressionRecalculateV1 === 'function') global.kjsProgressionRecalculateV1(event.getEntity());
});
