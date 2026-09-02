import * as EntitlementService from '../services/entitlement.service.js';

/**
 * What the signed-in user may open, and the subscriptions behind it.
 *
 * The client uses this to decide what to lock, so it answers for the whole
 * product in one call rather than making each section ask separately. It is a
 * convenience for rendering, never the enforcement: every gated service checks
 * entitlement again on its own, and a client that ignores this learns nothing
 * it could not already guess.
 */
export const getMyAccess = async (req, res) => {
  try {
    res.json(await EntitlementService.getAccessSummary(req.user));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
