import { hasSection } from './entitlement.service.js';
import { SECTIONS } from '../constants/sections.js';
import { FLASHCARD_DECK, isFreeFlashcardTopic } from '../content/flashcardDeck.js';

/**
 * The whole deck for this student.
 *
 * Everyone signed in gets the outline — subjects, topic names, card counts —
 * so a student without the section can see what the plan includes. The cards
 * and flowcharts themselves are only sent for free topics, or for every topic
 * when the student's plan includes Flashcards (admins always).
 */
export const getFlashcardDeck = async (user) => {
  const hasAccess = await hasSection(user, SECTIONS.FLASHCARDS);

  return {
    has_access: hasAccess,
    subjects: FLASHCARD_DECK.map((subject) => ({
      name: subject.name,
      topics: subject.topics.map((topic) => {
        const isFree = isFreeFlashcardTopic(topic.id);
        const isOpen = hasAccess || isFree;
        return {
          id: topic.id,
          name: topic.name,
          card_count: topic.cards.length,
          is_free: isFree,
          is_locked: !isOpen,
          cards: isOpen ? topic.cards : [],
          flowchart: isOpen ? topic.flowchart : [],
        };
      }),
    })),
  };
};
