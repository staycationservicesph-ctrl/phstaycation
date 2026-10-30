/* Initial units, inserted ONLY when the units table is empty (first start).
   After that, rates are managed in the admin dashboard and this file is not used again.
   The default rates below are placeholders: the owner must confirm real rates (see README). */
const DESC = 'Flagship unit featuring modern amenities and premium comfort. Ideal for couples or solo travelers.';
const DESC_VIEW = 'Spacious, elegantly designed unit with enhanced views. Great for extended stays and business travelers.';

function seedUnits(env) {
  const wd = Number(env.DEFAULT_WEEKDAY_RATE) || 1999;
  const we = Number(env.DEFAULT_WEEKEND_RATE) || wd;
  const u = (id, tower, beds, o) => Object.assign({ id: String(id), tower, beds, desc: DESC, perks: 'Cozy Living Room + Netflix', base: 4, max: 4, extra: 0, price: wd, weekend: we }, o || {});
  return [
    u(595, 'Shore 1 Tower C2', 'Queen Bed + Sofa Bed'),
    u(1537, 'Shore 1 Tower C2', 'Queen Bed'),
    u(1567, 'Shore 1 Tower C2', 'Queen Bed'),
    u(1569, 'Shore 1 Tower C2', 'Queen Bed'),
    u(1583, 'Shore 1 Tower C2', 'Queen Bed'),
    u(1585, 'Shore 1 Tower C2', 'Queen Bed'),
    u(1586, 'Shore 1 Tower C2', 'Queen Bed + Sofa Bed'),
    u(1839, 'Shore 1 Tower C2', 'Double Bed + Sofa Bed', { desc: DESC_VIEW, perks: 'Amenities View' }),
    u(953, 'Shore 1 Tower D', 'Queen Bed'),
    u(963, 'Shore 1 Tower D', 'Queen Bed'),
    u(1407, 'Shore 2 Tower 1', 'Queen Bed', { base: 2, max: 4, extra: 300 }),
    u(372, 'Shore 3 Tower 1', '2 Queen Beds'),
    u(525, 'Shore 3 Tower 1', 'Queen Bed + Sofa Bed'),
    u(855, 'Shore 3 Tower 1', 'Queen Bed + Sofa Bed')
  ];
}
module.exports = { seedUnits };
