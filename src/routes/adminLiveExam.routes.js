import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  listExams, getExam, createExam, updateExam, deleteExam, setVisibility,
  publishResults, unpublishResults, releasePaper, getResults, getResultsCsv, getQuestionStats,
  getAttemptDetail, resetAttempt, getPaperPdf,
} from '../controllers/liveExam.controller.js';

const router = Router();

router.use(verifyToken, isAdmin);

router.get('/', listExams);
router.post('/', createExam);
router.get('/:id', getExam);
router.put('/:id', updateExam);
router.delete('/:id', deleteExam);
// The student-facing on/off switch (dashboard nav + exam page).
router.patch('/:id/visibility', setVisibility);
router.post('/:id/publish-results', publishResults);
router.post('/:id/unpublish-results', unpublishResults);
// Adds a practice copy of the paper to Mock Exams (also automatic on publish if set).
router.post('/:id/release-paper', releasePaper);
router.get('/:id/results', getResults);
router.get('/:id/results.csv', getResultsCsv);
router.get('/:id/questions', getQuestionStats);
// The paper as a PDF; ?answers=1 adds answers, explanations and an answer key.
router.get('/:id/paper.pdf', getPaperPdf);
router.get('/:id/attempts/:attemptId', getAttemptDetail);
// Lets one student sit again (technical problem, or an admin's rehearsal).
router.delete('/:id/attempts/:attemptId', resetAttempt);

export default router;
