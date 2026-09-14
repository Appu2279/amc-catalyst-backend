import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// For routes that are public but behave differently for a signed-in admin
// (e.g. the courses list including inactive plans for management). A missing
// or invalid token is not an error here — it just means req.user stays unset.
export const attachUserIfPresent = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    // Ignore — the caller falls back to unauthenticated behaviour.
  }
  next();
};