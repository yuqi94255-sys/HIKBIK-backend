/**
 * 站點庫存數據（全球資產）
 */
const INVENTORY = [
  {
    id: 'sf-embarcadero',
    name: 'Embarcadero Station',
    location: 'Embarcadero, San Francisco',
    pricePerHour: 12,
    currency: 'USD',
    type: 'electric',
    bikesAvailable: 24,
  },
  {
    id: 'sf-fishermans',
    name: 'Fisherman\'s Wharf Station',
    location: 'Fisherman\'s Wharf, San Francisco',
    pricePerHour: 10,
    currency: 'USD',
    type: 'classic',
    bikesAvailable: 18,
  },
  {
    id: 'sf-golden-gate',
    name: 'Golden Gate Park Station',
    location: 'Golden Gate Park, San Francisco',
    pricePerHour: 14,
    currency: 'USD',
    type: 'electric',
    bikesAvailable: 16,
  },
];

module.exports = { INVENTORY };
