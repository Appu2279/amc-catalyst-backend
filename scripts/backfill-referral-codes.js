/**
 * Give every existing account a referral code.
 *
 *   npm run referral:backfill
 *
 * The app is already in production, so users registered before the referral
 * programme have no code. ensureUserCode() also runs lazily the first time such
 * a user opens their profile, so this script is a convenience — it just means
 * nobody has to wait for that first visit, and the admin code list is complete
 * straight away.
 *
 * Idempotent: it skips anyone who already has a code, so it is safe to re-run.
 */
import { User, ReferralCode, sequelize } from '../src/models/index.js';
import { ensureUserCode } from '../src/services/referral.service.js';

const run = async () => {
  const users = await User.findAll({ attributes: ['id', 'fullName'], order: [['id', 'ASC']] });
  const withCode = new Set(
    (
      await ReferralCode.findAll({
        where: { owner_type: 'user' },
        attributes: ['owner_user_id'],
        raw: true,
      })
    ).map((row) => row.owner_user_id)
  );

  let created = 0;
  for (const user of users) {
    if (withCode.has(user.id)) continue;
    const code = await ensureUserCode(user);
    created += 1;
    console.log(`  ${user.id}  ${user.fullName ?? ''}  ->  ${code.code}`);
  }

  console.log(
    `\n✅ Done. ${created} code${created === 1 ? '' : 's'} created, ${users.length - created} already had one.`
  );
  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
