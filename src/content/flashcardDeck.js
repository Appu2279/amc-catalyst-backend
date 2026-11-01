import { readFileSync } from 'fs';

/**
 * The flashcards deck: AMC CAT 1 learning points, grouped subject → topic,
 * each topic with its cards (question → learning point) and a flowchart.
 *
 * Kept as a JSON file in the repo rather than in the database: the deck is
 * edited as a whole and shipped with a release, so it needs no new tables.
 * Students only ever receive it through flashcard.service.js, which leaves
 * out paid topics for anyone without the Flashcards section.
 */
export const FLASHCARD_DECK = JSON.parse(readFileSync(new URL('./flashcardDeck.json', import.meta.url), 'utf8'));

// Open to every signed-in student as the free sample, so the paywall has
// something real to show — the topic the overview points new students at.
const FREE_TOPIC_IDS = Object.freeze(['topic-017']);

export const isFreeFlashcardTopic = (topicId) => FREE_TOPIC_IDS.includes(topicId);

export const countFreeFlashcards = () => FLASHCARD_DECK
  .flatMap((subject) => subject.topics)
  .filter((topic) => isFreeFlashcardTopic(topic.id))
  .reduce((sum, topic) => sum + topic.cards.length, 0);
