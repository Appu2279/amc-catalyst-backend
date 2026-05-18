import * as AuthService from '../services/auth.service.js';

export const register = async (req, res) => {
  try {
    const result = await AuthService.register(req.body.fullName, req.body.email, req.body.password);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const result = await AuthService.login(req.body.email, req.body.password);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
