import * as SubjectService from '../services/subject.service.js';

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const listSubjects   = handle(() => SubjectService.listSubjects());
export const getSubject     = handle((req) => SubjectService.getSubject(req.params.id));
export const createSubject  = handle(async (req, res) => { res.status(201); return SubjectService.createSubject(req.body); });
export const updateSubject  = handle((req) => SubjectService.updateSubject(req.params.id, req.body));
export const deleteSubject  = handle((req) => SubjectService.deleteSubject(req.params.id));

export const listTopics     = handle((req) => SubjectService.listTopics(req.params.id));
export const createTopic    = handle(async (req, res) => { res.status(201); return SubjectService.createTopic(req.body); });
export const updateTopic    = handle((req) => SubjectService.updateTopic(req.params.id, req.body));
export const deleteTopic    = handle((req) => SubjectService.deleteTopic(req.params.id));
