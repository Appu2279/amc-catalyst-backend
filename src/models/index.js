import sequelize from '../config/db.js';

import User from './user.model.js';
import Course from './course.model.js';
import CoursePricing from './coursePricing.model.js';
import Feature from './feature.model.js';
import CourseFeature from './courseFeature.model.js';
import Benefit from './benefit.model.js';
import CourseBenefit from './courseBenefit.model.js';
import Subscription from './subscription.model.js';
import Subject from './subject.model.js';
import Topic from './topic.model.js';
import Question from './question.model.js';
import QuestionOption from './questionOption.model.js';
import MockTest from './mockTest.model.js';
import MockTestQuestion from './mockTestQuestion.model.js';
import UserMockAttempt from './userMockAttempt.model.js';
import UserAnswer from './userAnswer.model.js';
import BookmarkedQuestion from './bookmarkedQuestion.model.js';
import ImportBatch from './importBatch.model.js';
import AttemptQuestion from './attemptQuestion.model.js';

// 🔗 Relationships

// Course ↔ Pricing
Course.hasMany(CoursePricing, { foreignKey: 'course_id' });
CoursePricing.belongsTo(Course);

// Course ↔ Feature
Course.belongsToMany(Feature, { through: CourseFeature });
Feature.belongsToMany(Course, { through: CourseFeature });

// Course ↔ Course — tiered plans ("Everything in Standard PLUS …")
Course.belongsTo(Course, { as: 'inherits_from', foreignKey: 'inherits_from_course_id' });

// Course ↔ Benefit (many-to-many — shared across courses)
Course.belongsToMany(Benefit, { through: CourseBenefit, foreignKey: 'course_id' });
Benefit.belongsToMany(Course, { through: CourseBenefit, foreignKey: 'benefit_id' });

// Subscription
User.hasMany(Subscription, { foreignKey: 'user_id' });
Subscription.belongsTo(User);

Course.hasMany(Subscription, { foreignKey: 'course_id' });
Subscription.belongsTo(Course);

// SUBJECT -> TOPIC
Subject.hasMany(Topic, {
  foreignKey: 'subject_id',
  as: 'topics',
});

Topic.belongsTo(Subject, {
  foreignKey: 'subject_id',
  as: 'subject',
});

// SUBJECT -> QUESTION
Subject.hasMany(Question, {
  foreignKey: 'subject_id',
  as: 'questions',
});

Question.belongsTo(Subject, {
  foreignKey: 'subject_id',
  as: 'subject',
});

// TOPIC -> QUESTION
Topic.hasMany(Question, {
  foreignKey: 'topic_id',
  as: 'questions',
});

Question.belongsTo(Topic, {
  foreignKey: 'topic_id',
  as: 'topic',
});

// QUESTION -> OPTIONS
Question.hasMany(QuestionOption, {
  foreignKey: 'question_id',
  as: 'options',
});

QuestionOption.belongsTo(Question, {
  foreignKey: 'question_id',
  as: 'question',
});

// MOCK TEST -> QUESTIONS (fixed tests)
MockTest.belongsToMany(Question, {
  through: MockTestQuestion,
  foreignKey: 'mock_test_id',
  otherKey: 'question_id',
  as: 'questions',
});

Question.belongsToMany(MockTest, {
  through: MockTestQuestion,
  foreignKey: 'question_id',
  otherKey: 'mock_test_id',
  as: 'mock_tests',
});

MockTest.hasMany(MockTestQuestion, { foreignKey: 'mock_test_id', as: 'mock_test_questions' });
MockTestQuestion.belongsTo(MockTest, { foreignKey: 'mock_test_id' });
MockTestQuestion.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });

// USER MOCK ATTEMPT
UserMockAttempt.belongsTo(MockTest, { foreignKey: 'mock_test_id', as: 'mock_test' });
MockTest.hasMany(UserMockAttempt, { foreignKey: 'mock_test_id', as: 'attempts' });

UserMockAttempt.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(UserMockAttempt, { foreignKey: 'user_id', as: 'attempts' });

// ATTEMPT QUESTIONS (snapshot)
UserMockAttempt.hasMany(AttemptQuestion, { foreignKey: 'attempt_id', as: 'attempt_questions' });
AttemptQuestion.belongsTo(UserMockAttempt, { foreignKey: 'attempt_id' });
AttemptQuestion.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });

// USER ANSWERS
UserMockAttempt.hasMany(UserAnswer, { foreignKey: 'attempt_id', as: 'answers' });
UserAnswer.belongsTo(UserMockAttempt, { foreignKey: 'attempt_id' });
UserAnswer.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });
UserAnswer.belongsTo(QuestionOption, { foreignKey: 'selected_option_id', as: 'selected_option' });

// BOOKMARKS
User.hasMany(BookmarkedQuestion, { foreignKey: 'user_id' });
BookmarkedQuestion.belongsTo(User, { foreignKey: 'user_id' });
BookmarkedQuestion.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });
Question.hasMany(BookmarkedQuestion, { foreignKey: 'question_id' });

// IMPORT BATCHES
ImportBatch.hasMany(Question, { foreignKey: 'import_batch_id', as: 'questions' });
Question.belongsTo(ImportBatch, { foreignKey: 'import_batch_id', as: 'import_batch' });

export {
  sequelize,
  User,
  Course,
  CoursePricing,
  Feature,
  CourseFeature,
  Benefit,
  CourseBenefit,
  Subscription,
  Subject,
  Topic,
  Question,
  QuestionOption,
  MockTest,
  MockTestQuestion,
  UserMockAttempt,
  UserAnswer,
  BookmarkedQuestion,
  ImportBatch,
  AttemptQuestion,
};