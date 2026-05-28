import { BookmarkedQuestion, Question, QuestionOption, Subject, Topic } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const questionIncludes = [
  { model: QuestionOption, as: 'options', attributes: ['id', 'option_key', 'option_text'] },
  { model: Subject, as: 'subject', attributes: ['id', 'name'] },
  { model: Topic, as: 'topic', attributes: ['id', 'name'] },
];

export const listBookmarks = async (userId, query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 20);

  const { count, rows } = await BookmarkedQuestion.findAndCountAll({
    where: { user_id: userId },
    include: [{ model: Question, as: 'question', where: { is_active: true }, include: questionIncludes }],
    order: [['created_at', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } };
};

export const addBookmark = async (userId, questionId) => {
  const question = await Question.findOne({ where: { id: questionId, is_active: true } });
  if (!question) throw new AppError('Question not found', 404);

  const [bookmark, created] = await BookmarkedQuestion.findOrCreate({ where: { user_id: userId, question_id: questionId } });
  return { created, id: bookmark.id };
};

export const removeBookmark = async (userId, questionId) => {
  const deleted = await BookmarkedQuestion.destroy({ where: { user_id: userId, question_id: questionId } });
  if (!deleted) throw new AppError('Bookmark not found', 404);
  return { message: 'Bookmark removed' };
};
