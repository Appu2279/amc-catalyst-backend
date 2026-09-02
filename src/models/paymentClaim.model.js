import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * One user's claim to have paid for a course by QR transfer.
 *
 * Payment is taken outside the application — the user scans a UPI QR, pays from
 * their own bank app, and then tells us they did. Nothing here proves a payment
 * happened; it is a queue item an admin works through against the bank
 * statement. Approving one is what creates a Subscription.
 *
 * Deliberately separate from Subscription. A claim is a workflow that resolves
 * once and then stays as a record of why access was granted; a subscription is
 * the live answer to "what can this user open right now". Keeping them apart is
 * also what lets a real gateway slot in later: a webhook writes the same row
 * with status 'approved' already set, and the manual review path stays as the
 * fallback for transfers that arrive some other way.
 */
const PaymentClaim = sequelize.define(
  'PaymentClaim',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    course_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    /**
     * Short human-readable code shown on the QR page ("AMC-7F3K2"), which the
     * user is asked to put in the payment remarks.
     *
     * Generated when the claim is created, before the user pays, so it can be
     * displayed alongside the QR. The ones who actually type it in become
     * instant approvals; for everyone else the UTR below is the fallback.
     */
    reference_code: {
      type: DataTypes.STRING(16),
      allowNull: false,
      // Uniqueness is declared as a NAMED index below, not `unique: true` here.
      // sync({ alter: true }) cannot match an anonymous unique constraint to the
      // one already in the database, so it adds another on every boot — this
      // database had accumulated 30 identical indexes on this column before the
      // declaration moved. A named index is matched by name and added once.
    },

    /**
     * What was owed at the moment the claim was made.
     *
     * Snapshotted rather than read back through CoursePricing at review time:
     * prices change, early-bird windows close, and a claim reviewed next week
     * must be judged against the number the user was actually shown.
     *
     * DECIMAL, not FLOAT. Note that Sequelize hands DECIMAL back as a string on
     * Postgres — compare with a decimal helper, never with ==.
     */
    amount_expected: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },

    /**
     * What the user says they sent. Usually equal to amount_expected, but
     * partial and rounded-down payments are common enough that the mismatch
     * needs to be visible in the review queue rather than discovered later.
     */
    amount_claimed: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },

    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'INR',
    },

    /**
     * The UPI/bank reference number for the transfer.
     *
     * This is the field that does the real work: it is what an admin searches
     * the bank statement for. Nullable at the database level only because a
     * gateway-created claim will not have one — the manual submit endpoint
     * should require it.
     */
    utr: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },

    /**
     * Optional supporting screenshot. Evidence for a human, not proof of
     * anything — payment screenshots take about thirty seconds to fake, so a
     * claim is approved against the bank statement and never against this.
     */
    screenshot_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'pending',
    },

    /**
     * When the user said they had paid.
     *
     * A claim is created when they open the QR page, so the reference code can
     * be shown before they pay — which means a pending row is not by itself a
     * claim on anything. Null here is "opened the page and wandered off"; a
     * timestamp is "said they paid, waiting on you". The review queue is
     * everything with this set, and your two-day promise is measured from it.
     */
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    /** Admin who resolved it. Null while pending. */
    reviewed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    /**
     * Why it was rejected, or anything worth recording about an approval —
     * "paid ₹200 short, accepted", "duplicate of #41". When access is granted
     * by hand this is the only reconstruction anyone gets later.
     */
    admin_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    /**
     * The Subscription an approval created. Null while pending or rejected.
     * Kept so a granted subscription can be traced back to the money.
     */
    subscription_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: 'payment_claims',
    underscored: true,
    indexes: [
      { name: 'payment_claims_reference_code_unique', unique: true, fields: ['reference_code'] },

      // The review queue reads by status and works oldest-first, over claims the
      // user has actually submitted.
      { name: 'payment_claims_status_submitted_at', fields: ['status', 'submitted_at'] },

      // Duplicate detection. Not unique: the same UTR legitimately reappears on
      // a resubmission after a rejection, and the admin needs to see both rows
      // rather than have the second one refused at the database.
      { name: 'payment_claims_utr', fields: ['utr'] },

      // At most one open claim per user per course. Partial, so a user may
      // still buy the same course again after their first claim is resolved —
      // this stops the double-click and the impatient resubmit, not the repeat
      // customer. Postgres-specific; there is no portable way to write it.
      {
        name: 'payment_claims_one_pending_per_user_course',
        unique: true,
        fields: ['user_id', 'course_id'],
        where: { status: 'pending' },
      },
    ],
  }
);

export default PaymentClaim;
