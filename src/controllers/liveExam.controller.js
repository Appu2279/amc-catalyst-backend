import * as LiveExamService from '../services/liveExam.service.js';
import { buildPaperPdf } from '../services/liveExamPaperPdf.service.js';

// Every handler here is "call the service, send JSON"; this keeps the error
// mapping (AppError status + extra data) in one place.
const handle = (fn, status = 200) => async (req, res) => {
  try {
    res.status(status).json(await fn(req));
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ message: err.message, ...err.data });
  }
};

// ── Student / public ─────────────────────────────────────────────────────────
export const getCurrentExam = handle((req) => LiveExamService.getCurrentExam(req.user ?? null));
export const startExam = handle((req) => LiveExamService.startExam(req.user, req.params.id), 201);
export const getMyAttempt = handle((req) => LiveExamService.getMyAttempt(req.user, req.params.id));
export const saveAnswer = handle((req) => LiveExamService.saveAnswer(req.user, req.params.id, req.body ?? {}));
export const submitExam = handle((req) => LiveExamService.submitExam(req.user, req.params.id));
export const getMyResult = handle((req) => LiveExamService.getMyResult(req.user, req.params.id));
export const listPublishedResults = handle(() => LiveExamService.listPublishedResults());
export const getPublicResults = handle((req) => LiveExamService.getPublicResults(req.params.slug));

// ── Admin ────────────────────────────────────────────────────────────────────
export const listExams = handle(() => LiveExamService.listExams());
export const getExam = handle((req) => LiveExamService.getExam(req.params.id));
export const createExam = handle((req) => LiveExamService.createExam(req.body ?? {}), 201);
export const updateExam = handle((req) => LiveExamService.updateExam(req.params.id, req.body ?? {}));
export const deleteExam = handle((req) => LiveExamService.deleteExam(req.params.id));
export const setVisibility = handle((req) => LiveExamService.setVisibility(req.params.id, req.body?.show_in_nav));
export const publishResults = handle((req) => LiveExamService.publishResults(req.params.id));
export const releasePaper = handle((req) => LiveExamService.releasePaper(req.params.id));
export const unpublishResults = handle((req) => LiveExamService.unpublishResults(req.params.id));
export const getResults = handle((req) => LiveExamService.getResults(req.params.id));
export const getQuestionStats = handle((req) => LiveExamService.getQuestionStats(req.params.id));
export const getAttemptDetail = handle((req) => LiveExamService.getAttemptDetail(req.params.id, req.params.attemptId));
export const resetAttempt = handle((req) => LiveExamService.resetAttempt(req.params.id, req.params.attemptId));

export const getResultsCsv = async (req, res) => {
  try {
    const { filename, body } = await LiveExamService.getResultsCsv(req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getPaperPdf = async (req, res) => {
  try {
    const { filename, bytes } = await buildPaperPdf(req.params.id, {
      withAnswers: req.query.answers === '1',
      timeZone: typeof req.query.tz === 'string' ? req.query.tz : 'UTC',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(bytes));
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ message: err.message });
  }
};
