/**
 * Give existing subjects their AMC blueprint domain.
 *
 *   npm run db:set-exam-domains
 *
 * Run once after `db:create-new` adds `subjects.exam_domain`. The mapping below
 * is the one agreed with the client for the first weighted mocks (AMC Mock 1–3,
 * Sept 2026). It is matched by subject NAME, because ids differ between local
 * and production.
 *
 * Safe to re-run: it only fills subjects whose exam_domain is still empty, so it
 * never overwrites a choice an admin has made on the Subjects page. Anything it
 * cannot match is listed at the end — assign those on the Subjects page.
 */
import { Op } from 'sequelize';
import { sequelize, Subject } from '../src/models/index.js';

const SUBJECTS_BY_DOMAIN = {
  medicine: [
    'Addiction Medicine', 'Cardiology', 'Cardiology and Endocrinology', 'Critical Care',
    'Dermatology', 'Emergency Medicine', 'Emergency Medicine and Burns', 'Endocrinology',
    'Gastroenterology', 'Genetics', 'Geriatric Medicine', 'Geriatrics', 'Haematology',
    'Hepatology', 'Hepatology and Transplantation', 'Immunology', 'Infectious Diseases',
    'Intensive Care', 'Internal Medicine', 'Medicine', 'Nephrology', 'Neurology', 'Nutrition',
    'Oncology', 'Oncology and Endocrinology', 'Palliative Care', 'Pharmacology',
    'Renal Medicine', 'Respiratory', 'Respiratory and Emergency Medicine',
    'Respiratory and Occupational Medicine', 'Respiratory Medicine', 'Rheumatology',
    'Rheumatology and Nephrology', 'Rheumatology and Pharmacogenomics', 'Sexual Health',
    'Toxicology',
  ],
  surgery: [
    'Anaesthesia', 'Breast', 'Breast Surgery', 'Colorectal Surgery',
    'Emergency Medicine and Trauma', 'Emergency Medicine and Trauma Surgery', 'ENT',
    'ENT and Haematology', 'General Surgery', 'Neurosurgery', 'Ophthalmology',
    'Oral & Maxillofacial', 'Oral & Maxillofacial Surgery', 'Orthopaedic Oncology',
    'Orthopaedics', 'Otolaryngology', 'Post-operative Medicine', 'Sports Medicine', 'Surgery',
    'Trauma', 'Urology', 'Vascular', 'Vascular Surgery',
  ],
  womens_health: [
    'Gynaecological Oncology', 'Gynaecology', 'Gynaecology and Menopause',
    'Gynaecology and Reproductive Medicine', 'Obstetric Medicine', 'Obstetrics',
    'Obstetrics & Gynaecology', 'Obstetrics & Gynecology', 'Reproductive Endocrinology',
    'Reproductive Medicine', 'Sexual and Reproductive Health', 'Urogynaecology',
  ],
  child_health: [
    'Adolescent Psychiatry', 'Child Psychiatry', 'General Pediatrics', 'Neonatal Surgery',
    'Neonatology', 'Paediatric Cardiology', 'Paediatric Dermatology',
    'Paediatric Endocrinology', 'Paediatric ENT', 'Paediatric Gastroenterology',
    'Paediatric Haematology', 'Paediatric Infectious Diseases', 'Paediatric Nephrology',
    'Paediatric Neurology', 'Paediatric Oncology', 'Paediatric Orthopaedics',
    'Paediatric Psychiatry', 'Paediatric Respiratory', 'Paediatric Respiratory Medicine',
    'Paediatric Surgery', 'Paediatric Urology', 'Paediatrics',
    'Paediatrics and Speech Pathology', 'Pediatrics',
  ],
  mental_health: [
    'Geriatric Psychiatry', 'Psychiatry', 'Psychiatry and Aged Care',
    'Psychiatry and Medicolegal',
  ],
  population_health: [
    'Biostatistics', 'Colorectal Screening', 'Ethics', 'Ethics & Law', 'Forensic Medicine',
    'General Practice', 'General Practice and Biochemistry', 'General Practice & Ethics',
    'GP & Ethics', 'Medical Ethics', 'Occupational Health', 'Occupational Medicine',
    'Population Health', 'Preventive Health', 'Public Health', 'Public Health / Immunisation',
    'Sexual Assault', 'Sexual Health, Public Health and Ethics', 'Travel Medicine',
  ],
};

const normalise = (name) => name.trim().toLowerCase();

const DOMAIN_BY_NAME = new Map(
  Object.entries(SUBJECTS_BY_DOMAIN).flatMap(([domain, names]) => names.map((name) => [normalise(name), domain]))
);

const run = async () => {
  await sequelize.authenticate();

  const unassigned = await Subject.findAll({ where: { exam_domain: { [Op.is]: null } }, order: [['name', 'ASC']] });
  const unmatched = [];
  let updated = 0;

  for (const subject of unassigned) {
    const domain = DOMAIN_BY_NAME.get(normalise(subject.name));
    if (!domain) {
      unmatched.push(subject.name);
      continue;
    }
    await subject.update({ exam_domain: domain });
    updated++;
  }

  console.log(`set      ${updated} subject(s)`);
  if (unmatched.length) {
    console.log(`\nNo domain for ${unmatched.length} subject(s) — assign them on the admin Subjects page:`);
    unmatched.forEach((name) => console.log(`  - ${name}`));
  }

  await sequelize.close();
};

run().catch(async (err) => {
  console.error(err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
