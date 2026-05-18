import { QueryTypes } from 'sequelize';
import { sequelize, UserMockAttempt, MockTest } from '../models/index.js';

export const getSummary = async (userId) => {
  const [summary] = await sequelize.query(
    `SELECT
      COUNT(DISTINCT uma.id)                                              AS total_attempts,
      COALESCE(SUM(uma.total_correct), 0)                                 AS total_correct,
      COALESCE(SUM(uma.total_wrong), 0)                                   AS total_wrong,
      COALESCE(SUM(uma.total_unanswered), 0)                              AS total_unanswered,
      COALESCE(AVG(uma.score), 0)                                         AS avg_score,
      COALESCE(AVG(
        CASE WHEN (uma.total_correct + uma.total_wrong) > 0
        THEN uma.total_correct * 100.0 / (uma.total_correct + uma.total_wrong)
        ELSE 0 END
      ), 0)                                                               AS avg_accuracy
    FROM user_mock_attempts uma
    WHERE uma.user_id = :userId AND uma.status = 'completed'`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return summary;
};

export const getSubjectPerformance = (userId) =>
  sequelize.query(
    `SELECT
      s.id    AS subject_id,
      s.name  AS subject_name,
      COUNT(ua.id)                                                        AS total_answered,
      SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END)                     AS total_correct,
      SUM(CASE WHEN ua.is_correct = false THEN 1 ELSE 0 END)             AS total_wrong,
      ROUND(SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END) * 100.0
        / NULLIF(COUNT(ua.id), 0), 2)                                     AS accuracy_percent
    FROM user_answers ua
    JOIN user_mock_attempts uma ON ua.attempt_id = uma.id
    JOIN questions q            ON ua.question_id = q.id
    JOIN subjects s             ON q.subject_id = s.id
    WHERE uma.user_id = :userId AND uma.status = 'completed'
    GROUP BY s.id, s.name
    ORDER BY accuracy_percent ASC`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );

export const getWeakTopics = (userId) =>
  sequelize.query(
    `SELECT
      t.id    AS topic_id,
      t.name  AS topic_name,
      s.name  AS subject_name,
      COUNT(ua.id)                                                        AS total_answered,
      SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END)                     AS total_correct,
      ROUND(SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END) * 100.0
        / NULLIF(COUNT(ua.id), 0), 2)                                     AS accuracy_percent
    FROM user_answers ua
    JOIN user_mock_attempts uma ON ua.attempt_id = uma.id
    JOIN questions q            ON ua.question_id = q.id
    JOIN topics t               ON q.topic_id = t.id
    JOIN subjects s             ON q.subject_id = s.id
    WHERE uma.user_id = :userId AND uma.status = 'completed' AND q.topic_id IS NOT NULL
    GROUP BY t.id, t.name, s.name
    HAVING COUNT(ua.id) >= 5
    ORDER BY accuracy_percent ASC
    LIMIT 10`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );

export const getHistory = async (userId, query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 10);

  const { count, rows } = await UserMockAttempt.findAndCountAll({
    where: { user_id: userId },
    include: [{ model: MockTest, as: 'mock_test', attributes: ['id', 'title', 'duration_minutes', 'total_questions'] }],
    order: [['created_at', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  return { data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } };
};
