import * as AdminUserService from '../services/adminUser.service.js';

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Something went wrong' });
  }
};

export const listUsers = handle((req) =>
  AdminUserService.listUsers({
    search: req.query.search,
    status: req.query.status,
    page: req.query.page,
    page_size: req.query.page_size,
  })
);

export const getUser = handle((req) => AdminUserService.getUser(req.params.id));

export const banUser = handle((req) =>
  AdminUserService.banUser(req.params.id, req.user.id, { days: req.body.days, reason: req.body.reason })
);

export const unbanUser = handle((req) => AdminUserService.unbanUser(req.params.id));

export const removeUser = handle((req) => AdminUserService.removeUser(req.params.id, req.user.id));

export const restoreUser = handle((req) => AdminUserService.restoreUser(req.params.id));

export const grantPlan = handle((req) =>
  AdminUserService.grantPlan(req.params.id, req.user.id, { course_id: req.body.course_id })
);

export const revokeSubscription = handle((req) =>
  AdminUserService.revokeSubscription(req.params.subscriptionId, req.user.id, { note: req.body.note })
);

export const extendSubscription = handle((req) =>
  AdminUserService.extendSubscription(req.params.subscriptionId, {
    months: req.body.months,
    end_date: req.body.end_date,
  })
);

export const changePlan = handle((req) =>
  AdminUserService.changePlan(req.params.subscriptionId, req.user.id, { course_id: req.body.course_id })
);

export const exportPaidUsersCsv = async (req, res) => {
  try {
    const { filename, body } = await AdminUserService.exportPaidUsersCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    console.error('Paid students export failed:', err.message);
    res.status(500).json({ message: 'Could not build the export' });
  }
};
