import * as BookmarkService from '../services/bookmark.service.js';

export const listBookmarks = async (req, res) => {
  try {
    res.json(await BookmarkService.listBookmarks(req.user.id, req.query));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const addBookmark = async (req, res) => {
  try {
    const { created, id } = await BookmarkService.addBookmark(req.user.id, req.body.question_id);
    res.status(created ? 201 : 200).json({ message: created ? 'Bookmarked' : 'Already bookmarked', id });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const removeBookmark = async (req, res) => {
  try {
    res.json(await BookmarkService.removeBookmark(req.user.id, req.params.questionId));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
