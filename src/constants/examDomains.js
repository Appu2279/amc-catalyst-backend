/**
 * The client's AMC exam blueprint: the six domains a weighted mock is built
 * from, and the share of the paper each one gets.
 *
 * The weights are fixed by the client and must add up to 1. Which domain a
 * subject belongs to is data (`subjects.exam_domain`, set on the admin Subjects
 * page); only the domains and their weights live here.
 */
export const EXAM_DOMAINS = Object.freeze([
  { key: 'medicine', label: 'Adult Health — Medicine', weight: 0.30 },
  { key: 'surgery', label: 'Adult Health — Surgery', weight: 0.20 },
  { key: 'womens_health', label: "Women's Health", weight: 0.125 },
  { key: 'child_health', label: 'Child Health', weight: 0.125 },
  { key: 'mental_health', label: 'Mental Health', weight: 0.125 },
  { key: 'population_health', label: 'Population Health & Ethics', weight: 0.125 },
]);

export const EXAM_DOMAIN_KEYS = Object.freeze(EXAM_DOMAINS.map((d) => d.key));

export const isExamDomainKey = (value) => EXAM_DOMAIN_KEYS.includes(value);
