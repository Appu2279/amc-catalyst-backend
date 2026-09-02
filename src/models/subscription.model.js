import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * What one user may open, and until when.
 *
 * The important property of this table is that it is a SNAPSHOT. A subscription
 * records what was sold at the moment it was sold — the sections, the plan
 * name, the end date — and nothing here is re-derived from the Course
 * afterwards. Plans get renamed, re-priced, narrowed and retired; none of that
 * may reach into access somebody has already paid for.
 *
 * Concretely: if "Standard" included notes and mocks for six months when a user
 * bought it, and in month three you drop mocks from Standard, that user keeps
 * mocks until their six months are up. The next person to buy Standard gets the
 * new, narrower version. Both are correct at once, which is only possible
 * because the entitlement lives here rather than on the Course.
 */
const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  /**
   * 'active'   — live, subject to end_date
   * 'inactive' — ended in the ordinary way
   * 'revoked'  — withdrawn deliberately (account sharing, reversed payment,
   *              granted in error). Kept distinct from 'inactive' so that
   *              "their year ran out" and "we took this away" remain
   *              answerable months later; they are indistinguishable otherwise.
   *
   * Status alone never means access. end_date decides that, and the resolver
   * checks both — a row can sit at 'active' long after it has expired.
   */
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'revoked'),
    defaultValue: 'active',
  },

  start_date: DataTypes.DATE,
  end_date: DataTypes.DATE,

  /**
   * The sections this subscription grants, frozen at grant time and already
   * flattened through plan inheritance — the resolver reads this and needs no
   * further lookups.
   *
   * Nullable, unlike everything else here, purely because rows created before
   * this column existed have no snapshot to show. Treat null as "fall back to
   * the course definition" for those legacy rows only; every row written from
   * now on has a real value.
   */
  granted_sections: {
    type: DataTypes.JSONB,
    allowNull: true,
  },

  /**
   * The plan's name as it read when sold.
   *
   * Denormalised deliberately. A course can be renamed, and its foreign key is
   * ON DELETE SET NULL, so a deleted plan leaves this row pointing at nothing —
   * this keeps the user's dashboard and your own records able to say what they
   * bought even then.
   */
  plan_title: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  /**
   * How this subscription came to exist.
   *
   * 'payment_claim' — an admin approved a QR payment; the PaymentClaim row
   *                   carries the UTR, amount, reviewer and note.
   * 'manual'        — granted directly, with no claim behind it: an offline
   *                   transfer, a comp, a tester. granted_by is the only
   *                   provenance these have, which is exactly why it exists.
   *
   * Null on legacy rows. Cannot be backfilled — there is no source to recover
   * it from — which is the reason to start recording it before launch rather
   * than after.
   */
  source: {
    type: DataTypes.ENUM('payment_claim', 'manual'),
    allowNull: true,
  },

  /** Admin who created it. Null on legacy rows and on anything automated. */
  granted_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  timestamps: true,
  underscored: true,
});

export default Subscription;
