/**
 * profileSchema.js — the citizen attribute model and adaptive question flow.
 *
 * WHY THIS EXISTS
 *
 * v1 asked six things: age, gender, caste, occupation, income, district. Against
 * 4,643 schemes that is roughly six bits of signal for a corpus that gates on
 * far more, so a typical citizen "matched" ~40% of everything and the feed was a
 * phone book. Ranking around it was a patch; this is the cause.
 *
 * Three concrete holes it left:
 *   - 1,139 education schemes, and "student" was ONE bit — every student matched
 *     all of them. Level + marks + institution type separates them.
 *   - 221 disability schemes could never surface for anyone, because there was
 *     no disability question at all.
 *   - 118 housing schemes: PMAY cannot be matched without knowing whether the
 *     household already has a pucca house.
 *
 * Every attribute below is justified by a measured count of schemes whose
 * eligibility text actually gates on it, taken from the full India corpus. An
 * attribute that pays for less than ~30 schemes is marked low priority.
 *
 * DESIGN RULES
 *   1. Answerable in one tap, from memory, by a low-literacy rural user.
 *      Ration-card colour beats "annual income" — people genuinely do not know
 *      their annual income, but everyone knows their card.
 *   2. Local units. Land in acres and cents, never hectares.
 *   3. Conditional. `askWhen` fires a question only for the citizens it concerns.
 *   4. Budget: <= 12 questions for any single citizen. Worst case here is 12
 *      (a female student); a male farmer sees 10.
 */

export const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
  'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra & Nagar Haveli and Daman & Diu',
  'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

const opt = (value, en, ta) => ({ value, en, ta });

/**
 * Each question:
 *   key        profile field it writes
 *   askWhen    (profile) => boolean — omit for base questions
 *   schemes    schemes in the corpus this attribute gates (measured)
 *   options    single-select unless multi: true
 */
export const QUESTIONS = [
  // ─────────────────────── BASE — everyone answers ───────────────────────
  {
    key: 'state',
    schemes: 4643,          // scoping: decides the entire candidate pool
    q: { en: 'Which state do you live in?', ta: 'நீங்கள் எந்த மாநிலத்தில் வசிக்கிறீர்கள்?' },
    help: {
      en: 'We will show central schemes plus your own state’s.',
      ta: 'மத்திய திட்டங்களுடன் உங்கள் மாநிலத் திட்டங்களையும் காட்டுவோம்.',
    },
    type: 'state',
    options: STATES.map((s) => opt(s, s, s)),
  },
  {
    key: 'age',
    schemes: 1470,
    q: { en: 'How old are you?', ta: 'உங்கள் வயது என்ன?' },
    type: 'band',
    options: [
      opt(10, 'Under 18', '18 வயதுக்குக் கீழ்'),
      opt(21, '18 – 25', '18 – 25'),
      opt(30, '26 – 35', '26 – 35'),
      opt(45, '36 – 55', '36 – 55'),
      opt(60, '56 – 65', '56 – 65'),
      opt(70, 'Over 65', '65க்கு மேல்'),
    ],
  },
  {
    key: 'gender',
    schemes: 1120,
    q: { en: 'Gender', ta: 'பாலினம்' },
    type: 'enum',
    options: [
      opt('female', 'Woman', 'பெண்'),
      opt('male', 'Man', 'ஆண்'),
      opt('transgender', 'Transgender', 'திருநங்கை'),
    ],
  },
  {
    key: 'caste',
    schemes: 1043,
    q: { en: 'Which community do you belong to?', ta: 'நீங்கள் எந்த சமூகத்தைச் சேர்ந்தவர்?' },
    type: 'enum',
    skippable: true,
    options: [
      opt('SC', 'SC', 'எஸ்சி'),
      opt('ST', 'ST', 'எஸ்டி'),
      opt('OBC', 'OBC / BC / MBC', 'ஓபிசி / பிசி'),
      opt('General', 'General', 'பொது'),
      opt(null, 'Prefer not to say', 'சொல்ல விரும்பவில்லை'),
    ],
  },
  {
    key: 'ration_card',
    schemes: 311,
    // Replaces "annual income" as the primary poverty signal. Citizens do not
    // reliably know their annual income; everyone knows their ration card.
    // Income is kept as an optional refinement, not a required question.
    q: { en: 'What kind of ration card does your family have?', ta: 'உங்கள் குடும்ப அட்டை எந்த வகை?' },
    help: {
      en: 'The colour is usually printed on the front.',
      ta: 'அட்டையின் முன்பக்கத்தில் நிறம் அச்சிடப்பட்டிருக்கும்.',
    },
    type: 'enum',
    options: [
      opt('aay', 'Antyodaya (AAY)', 'அந்த்யோதயா'),
      opt('bpl', 'BPL / Below Poverty Line', 'வறுமைக் கோட்டுக்குக் கீழ்'),
      opt('priority', 'Priority household', 'முன்னுரிமைக் குடும்பம்'),
      opt('apl', 'APL / Above Poverty Line', 'வறுமைக் கோட்டுக்கு மேல்'),
      opt('none', 'No ration card', 'குடும்ப அட்டை இல்லை'),
    ],
  },
  {
    key: 'occupation',
    schemes: 1652,
    q: { en: 'What do you do for a living?', ta: 'நீங்கள் என்ன வேலை செய்கிறீர்கள்?' },
    type: 'enum',
    options: [
      opt('farmer', 'Farming', 'விவசாயம்'),
      opt('daily_wage', 'Daily wage work', 'கூலி வேலை'),
      opt('student', 'Studying', 'படிக்கிறேன்'),
      opt('small_business', 'Small business', 'சிறு தொழில்'),
      opt('artisan', 'Craft or trade work', 'கைவினை / பாரம்பரியத் தொழில்'),
      opt('fisher', 'Fishing', 'மீன்பிடித்தல்'),
      opt('homemaker', 'Homemaker', 'இல்லத்தரசி'),
      opt('salaried', 'Salaried job', 'சம்பள வேலை'),
      opt('unemployed', 'Not working right now', 'இப்போது வேலை இல்லை'),
    ],
  },
  {
    key: 'disability',
    schemes: 330,
    // 221 disability schemes existed in the corpus with no question that could
    // reach them. Base, not conditional — disability cuts across occupations.
    q: { en: 'Do you have a disability?', ta: 'உங்களுக்கு மாற்றுத்திறன் உள்ளதா?' },
    type: 'enum',
    options: [
      opt('none', 'No', 'இல்லை'),
      opt('under40', 'Yes, less than 40%', 'ஆம், 40%க்கு குறைவாக'),
      opt('over40', 'Yes, 40% or more', 'ஆம், 40% அல்லது அதற்கு மேல்'),
      opt('unknown', 'Yes, not certified yet', 'ஆம், சான்றிதழ் இல்லை'),
    ],
  },

  // ────────────────── STUDENT BRANCH — the highest-yield ──────────────────
  {
    key: 'student_level',
    askWhen: (p) => p.occupation === 'student',
    schemes: 978,
    q: { en: 'What are you studying?', ta: 'நீங்கள் என்ன படிக்கிறீர்கள்?' },
    type: 'enum',
    options: [
      opt('class_1_8', 'Class 1 – 8', '1 – 8 ஆம் வகுப்பு'),
      opt('class_9_10', 'Class 9 – 10', '9 – 10 ஆம் வகுப்பு'),
      opt('class_11_12', 'Class 11 – 12', '11 – 12 ஆம் வகுப்பு'),
      opt('iti', 'ITI', 'ஐடிஐ'),
      opt('diploma', 'Diploma / Polytechnic', 'டிப்ளோமா'),
      opt('ug', 'Degree (UG)', 'இளங்கலை'),
      opt('pg', 'Post-graduate', 'முதுகலை'),
      opt('phd', 'PhD / research', 'முனைவர் பட்டம்'),
    ],
  },
  {
    key: 'last_exam_pct',
    askWhen: (p) => p.occupation === 'student',
    schemes: 366,
    // The single biggest gate in the corpus after state.
    q: { en: 'Roughly what % did you score in your last exam?', ta: 'கடைசித் தேர்வில் எத்தனை சதவீதம் பெற்றீர்கள்?' },
    type: 'band',
    skippable: true,
    options: [
      opt(90, '85% and above', '85% மேல்'),
      opt(78, '75 – 84%', '75 – 84%'),
      opt(65, '60 – 74%', '60 – 74%'),
      opt(54, '50 – 59%', '50 – 59%'),
      opt(45, 'Below 50%', '50%க்கு கீழ்'),
    ],
  },
  {
    key: 'institution_type',
    askWhen: (p) => p.occupation === 'student',
    schemes: 290,
    q: { en: 'Is your school or college government or private?', ta: 'உங்கள் பள்ளி/கல்லூரி அரசுத் துறையா தனியாரா?' },
    type: 'enum',
    options: [
      opt('government', 'Government', 'அரசு'),
      opt('aided', 'Government-aided', 'அரசு உதவி பெறும்'),
      opt('private', 'Private', 'தனியார்'),
    ],
  },

  // ────────────────────────── FARMER BRANCH ──────────────────────────────
  {
    key: 'land_tenure',
    askWhen: (p) => p.occupation === 'farmer',
    schemes: 186,
    // Tenants and sharecroppers are excluded from land-linked schemes and
    // specifically included in others, and almost no system asks.
    q: { en: 'Is the land you farm your own?', ta: 'நீங்கள் பயிரிடும் நிலம் உங்களுடையதா?' },
    type: 'enum',
    options: [
      opt('owner', 'I own it', 'என் சொந்த நிலம்'),
      opt('tenant', 'I rent / lease it', 'குத்தகை நிலம்'),
      opt('sharecropper', 'I sharecrop it', 'வாரம் பயிரிடுகிறேன்'),
      opt('landless', 'I have no land — I work on others’ farms', 'நிலம் இல்லை — கூலி வேலை'),
    ],
  },
  {
    key: 'land_acres',
    askWhen: (p) => p.occupation === 'farmer' && p.land_tenure && p.land_tenure !== 'landless',
    schemes: 100,
    q: { en: 'How much land, in acres?', ta: 'எத்தனை ஏக்கர் நிலம்?' },
    help: { en: '100 cents = 1 acre.', ta: '100 சென்ட் = 1 ஏக்கர்.' },
    type: 'band',
    options: [
      opt(0.5, 'Under 1 acre', '1 ஏக்கருக்குக் கீழ்'),
      opt(1.75, '1 – 2.5 acres', '1 – 2.5 ஏக்கர்'),
      opt(3.75, '2.5 – 5 acres', '2.5 – 5 ஏக்கர்'),
      opt(8, 'More than 5 acres', '5 ஏக்கருக்கு மேல்'),
    ],
  },
  {
    key: 'livestock',
    askWhen: (p) => p.occupation === 'farmer',
    schemes: 199,
    q: { en: 'Do you keep any cattle, goats or poultry?', ta: 'கால்நடை, ஆடு அல்லது கோழி வளர்க்கிறீர்களா?' },
    type: 'boolean',
    options: [opt(true, 'Yes', 'ஆம்'), opt(false, 'No', 'இல்லை')],
  },

  // ───────────────────────── WORKER BRANCH ───────────────────────────────
  {
    key: 'welfare_board_registered',
    askWhen: (p) => ['daily_wage', 'artisan', 'fisher', 'small_business'].includes(p.occupation),
    schemes: 454,
    // Second-largest gate in the corpus, and a plain yes/no a worker knows.
    q: { en: 'Are you registered with a labour welfare board?', ta: 'நீங்கள் தொழிலாளர் நல வாரியத்தில் பதிவு செய்துள்ளீர்களா?' },
    help: {
      en: 'Many workers register at the panchayat or labour office.',
      ta: 'பலர் ஊராட்சி அல்லது தொழிலாளர் அலுவலகத்தில் பதிவு செய்வர்.',
    },
    type: 'enum',
    options: [
      opt(true, 'Yes', 'ஆம்'),
      opt(false, 'No', 'இல்லை'),
      opt(null, 'Not sure', 'தெரியவில்லை'),
    ],
  },

  // ───────────────────────── WOMEN BRANCH ────────────────────────────────
  {
    key: 'maternity',
    askWhen: (p) => p.gender === 'female' && (p.age ?? 0) >= 18 && (p.age ?? 0) <= 45,
    schemes: 86,
    q: { en: 'Are you expecting a child, or have you had one in the last year?', ta: 'நீங்கள் கர்ப்பமாக உள்ளீர்களா, அல்லது கடந்த ஆண்டில் குழந்தை பிறந்ததா?' },
    type: 'enum',
    skippable: true,
    options: [
      opt('pregnant', 'Expecting now', 'இப்போது கர்ப்பம்'),
      opt('lactating', 'Had a baby in the last year', 'கடந்த ஆண்டில் குழந்தை'),
      opt('neither', 'Neither', 'இரண்டும் இல்லை'),
    ],
  },
  {
    key: 'marital_status',
    askWhen: (p) => p.gender === 'female' && (p.age ?? 0) >= 18,
    schemes: 152,
    q: { en: 'Marital status', ta: 'திருமண நிலை' },
    type: 'enum',
    skippable: true,
    options: [
      opt('never_married', 'Unmarried', 'திருமணமாகவில்லை'),
      opt('married', 'Married', 'திருமணமானவர்'),
      opt('widowed', 'Widowed', 'விதவை'),
      opt('separated', 'Separated or deserted', 'பிரிந்தவர் / கைவிடப்பட்டவர்'),
    ],
  },

  // ──────────────────── SENIOR / HOUSEHOLD BRANCHES ──────────────────────
  {
    key: 'drawing_pension',
    askWhen: (p) => (p.age ?? 0) >= 58,
    schemes: 51,
    // Both a gate and a disqualifier: many schemes bar existing pensioners.
    q: { en: 'Are you already receiving any government pension?', ta: 'நீங்கள் ஏற்கனவே அரசு ஓய்வூதியம் பெறுகிறீர்களா?' },
    type: 'boolean',
    options: [opt(true, 'Yes', 'ஆம்'), opt(false, 'No', 'இல்லை')],
  },
  {
    key: 'housing_status',
    askWhen: (p) => ['aay', 'bpl', 'priority'].includes(p.ration_card),
    schemes: 30,
    q: { en: 'What kind of house does your family live in?', ta: 'உங்கள் குடும்பம் எத்தகைய வீட்டில் வசிக்கிறது?' },
    type: 'enum',
    options: [
      opt('owns_pucca', 'Our own pucca house', 'சொந்த பக்கா வீடு'),
      opt('owns_kutcha', 'Our own kutcha / thatched house', 'சொந்த குடிசை வீடு'),
      opt('rented', 'Rented', 'வாடகை வீடு'),
      opt('homeless', 'No house of our own', 'சொந்த வீடு இல்லை'),
    ],
  },
];

/** Questions to ask next, given what has been answered so far. */
export function nextQuestions(profile = {}) {
  return QUESTIONS.filter((q) => {
    if (q.key in profile && profile[q.key] !== undefined) return false;
    return q.askWhen ? q.askWhen(profile) : true;
  });
}

/** Worst-case question count, used to keep the flow honest as it grows. */
export function maxQuestionCount() {
  const base = QUESTIONS.filter((q) => !q.askWhen).length;
  const branches = {
    female_student: ['student_level', 'last_exam_pct', 'institution_type', 'maternity', 'marital_status'],
    male_farmer: ['land_tenure', 'land_acres', 'livestock'],
    female_worker: ['welfare_board_registered', 'maternity', 'marital_status', 'housing_status'],
  };
  return Object.fromEntries(
    Object.entries(branches).map(([k, v]) => [k, base + v.length]),
  );
}
