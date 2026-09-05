import * as EntitlementService from '../services/entitlement.service.js';
import * as MeService from '../services/me.service.js';

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

/** The caller's own account details, for the profile screen. */
export const getMyProfile = async (req, res) => {
  try {
    res.json({ user: await MeService.getProfile(req.user.id) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

/** Edits the caller's own account. Returns the updated record. */
export const updateMyProfile = async (req, res) => {
  try {
    res.json({ user: await MeService.updateProfile(req.user.id, req.body) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

/** Uploads / replaces the caller's profile picture. */
export const uploadMyAvatar = async (req, res) => {
  try {
    const user = await MeService.setAvatar(req.user.id, {
      buffer: req.file?.buffer,
      contentType: req.file?.mimetype,
    });
    res.json({ user });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

/** Removes the caller's profile picture. */
export const deleteMyAvatar = async (req, res) => {
  try {
    res.json({ user: await MeService.removeAvatar(req.user.id) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

/**
 * Streams the caller's own profile picture.
 *
 * Stored as a private S3 object, fetched here with the app's credentials and
 * never exposed as a URL — the same arrangement as note files and payment
 * screenshots.
 */
export const streamMyAvatar = async (req, res) => {
  let object;
  try {
    object = await MeService.getAvatarObject(req.user.id);
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }

  res.set({
    'Content-Type': object.contentType || 'image/jpeg',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(object.buffer);
};
