// =============================================
// models/liveExam.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const NAME_DISPLAY_MODES = Object.freeze(['full', 'initials', 'hidden']);

/**
 * A scheduled, one-sitting exam open to every signed-in student — the
 * "real AMC-style exam" event — as opposed to a practice mock.
 *
 * The paper itself is an ordinary FIXED mock test (usually built by the
 * weighted-mock generator) that stays unpublished, so it never shows in the
 * regular Mock Exams list. What this row adds is the event around it: when it
 * opens and closes, whether students see it in the dashboard nav, and when the
 * results go public. Answers are recorded as usual in user_mock_attempts /
 * user_answers, but nothing about correctness is shown to a student until the
 * results are published.
 */
const LiveExam = sequelize.define(
  'LiveExam',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Public results address: /results/<slug>. Unique via the named index
    // below — see the note on `indexes` in user.model.js for why not here.
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
    },

    // Shown on the start screen, before a student begins.
    instructions: {
      type: DataTypes.TEXT,
    },

    // The paper. RESTRICT: a mock that students sat as a live exam must not be
    // deletable out from under its results.
    mock_test_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'mock_tests', key: 'id' },
      onDelete: 'RESTRICT',
    },

    // Students may START between these two moments. Every attempt also ends at
    // closes_at at the latest, whatever time it has left — so a fixed-start
    // exam is just closes_at = opens_at + duration (+ a little grace).
    opens_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    closes_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    // The on/off switch for students: off = gone from the dashboard nav and
    // the exam page, whatever the dates say. At most one exam has it on.
    show_in_nav: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    // Null until an admin publishes results; the public results page and each
    // student's own result exist only while this is set.
    results_published_at: {
      type: DataTypes.DATE,
    },

    // After publishing, may a student review each question with the correct
    // answer and explanation? Off = score and breakdown only.
    allow_answer_review: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    // How many top candidates the public page lists. 0 = statistics only.
    leaderboard_size: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 50,
    },

    // How candidates are named on the public leaderboard:
    // 'full' = "Priya Sharma", 'initials' = "Priya S.", 'hidden' = "Candidate #12".
    name_display: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'initials',
      validate: { isIn: [NAME_DISPLAY_MODES] },
    },

    // Public results page on/off, separate from publishing: off hides
    // /results/<slug> (even by direct URL) while each student still sees their
    // own result in the dashboard.
    public_results: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    // Once results are published, add a copy of the paper to the regular Mock
    // Exams as a practice mock. A copy, not the paper itself, so practice
    // attempts never mix with the live exam's.
    release_as_mock: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    // The practice copy made by that release. Informational, no FK: deleting
    // the practice mock must not touch the exam.
    released_mock_test_id: {
      type: DataTypes.INTEGER,
    },

    // Optional pass mark as a percentage of total marks; null = no pass/fail.
    pass_percent: {
      type: DataTypes.FLOAT,
      validate: { min: 0, max: 100 },
    },
  },
  {
    tableName: 'live_exams',
    underscored: true,
    indexes: [
      { name: 'live_exams_slug_unique', unique: true, fields: ['slug'] },
      { name: 'live_exams_mock_test_unique', unique: true, fields: ['mock_test_id'] },
    ],
  }
);

export default LiveExam;
