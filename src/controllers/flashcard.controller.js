import * as FlashcardService from '../services/flashcard.service.js';

// GET /api/flashcards — the deck, with paid topics' cards left out for
// students whose plan does not include Flashcards.
export const getFlashcardDeck = async (req, res) => {
  try {
    res.json({ data: await FlashcardService.getFlashcardDeck(req.user) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
