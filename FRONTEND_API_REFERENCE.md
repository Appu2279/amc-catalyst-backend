# AMC Catalyst — Frontend API Reference

> Give this file to your frontend AI. It contains every endpoint, exact request bodies, and exact response shapes.

---

## Setup

**Base URL**: `http://localhost:3000/api` (dev) / `https://your-domain.com/api` (prod)

**Auth header** — attach to every protected request:
```
Authorization: Bearer <jwt_token>
```

**Axios instance** (recommended):
```js
import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL + '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
```

---

## Response Conventions

**Single object** → returns the object directly  
**Paginated list** → always this shape:
```json
{
  "data": [...],
  "pagination": {
    "total": 240,
    "page": 1,
    "limit": 20,
    "pages": 12
  }
}
```
**Error** → `{ "message": "..." }` or `{ "error": "..." }`

**Auth error** → `401 { "message": "Unauthorized" }`  
**Admin-only error** → `403 { "message": "Admin only" }`

---

## Enum Values (use exactly these strings)

| Field | Allowed values |
|---|---|
| `difficulty` | `easy` `medium` `hard` |
| `question_type` | `single_choice` `multiple_choice` `true_false` `image_based` |
| `source_type` | `qbank` `recall` `mock` `previous_year` |
| `test_type` | `fixed` `dynamic` |
| `attempt status` | `in_progress` `completed` `abandoned` |
| `import batch status` | `processing` `completed` `failed` |
| `user role` | `user` `admin` |

---

## AUTH

### Register
```
POST /auth/register
```
**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```
**Response 201:**
```json
{
  "token": "eyJhbGci...",
  "user": { "id": 1, "name": "John Doe", "email": "john@example.com", "role": "user" }
}
```

---

### Login
```
POST /auth/login
```
**Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```
**Response 200:**
```json
{
  "token": "eyJhbGci...",
  "user": { "id": 1, "name": "John Doe", "email": "john@example.com", "role": "admin" }
}
```
> Save `token` to localStorage. Decode it (with `jwt-decode`) to read `role`, `id`, `name`.

---

## SUBJECTS & TOPICS

### List all subjects (with topics)
```
GET /subjects
```
**Auth:** None  
**Response 200:**
```json
[
  {
    "id": 1,
    "name": "Anatomy",
    "slug": "anatomy",
    "description": "...",
    "is_active": true,
    "topics": [
      { "id": 3, "name": "Upper Limb", "slug": "upper-limb" }
    ]
  }
]
```

---

### Get single subject
```
GET /subjects/:id
```
**Auth:** None  
**Response 200:** Same as above (single object with topics array)

---

### Get topics for a subject
```
GET /subjects/:id/topics
```
**Auth:** None  
**Response 200:**
```json
[
  { "id": 3, "subject_id": 1, "name": "Upper Limb", "slug": "upper-limb", "is_active": true }
]
```

---

### Create subject (admin)
```
POST /subjects
```
**Auth:** Admin  
**Body:**
```json
{
  "name": "Physiology",
  "description": "Optional description"
}
```
**Response 201:** Subject object (slug auto-generated from name)

---

### Update subject (admin)
```
PUT /subjects/:id
```
**Auth:** Admin  
**Body:** (all optional, send only what changed)
```json
{
  "name": "Physiology Updated",
  "description": "...",
  "is_active": false
}
```
**Response 200:** Updated subject object

---

### Delete subject (admin)
```
DELETE /subjects/:id
```
**Auth:** Admin  
**Response 200:** `{ "message": "Subject deleted" }`

---

### Create topic (admin)
```
POST /subjects/topics/create
```
**Auth:** Admin  
**Body:**
```json
{
  "subject_id": 1,
  "name": "ECG",
  "description": "Optional"
}
```
**Response 201:** Topic object

---

### Update topic (admin)
```
PUT /subjects/topics/:id
```
**Auth:** Admin  
**Body:** (all optional)
```json
{
  "name": "ECG Interpretation",
  "is_active": true
}
```

---

### Delete topic (admin)
```
DELETE /subjects/topics/:id
```
**Auth:** Admin  
**Response 200:** `{ "message": "Topic deleted" }`

---

## QUESTIONS

### List questions — student view (no correct answers)
```
GET /questions
```
**Auth:** None  
**Query params:**
```
subject_id=1
topic_id=3
difficulty=hard          (easy | medium | hard)
question_type=single_choice
source_type=previous_year
search=ECG               (searches question_text)
page=1                   (default: 1)
limit=20                 (default: 20, max: 100)
```
**Response 200:**
```json
{
  "data": [
    {
      "id": 42,
      "question_text": "A 45-year-old presents with...",
      "explanation": null,
      "difficulty": "hard",
      "question_type": "single_choice",
      "source_type": "previous_year",
      "source_year": 2023,
      "marks": 1,
      "negative_marks": 0.25,
      "is_active": true,
      "subject": { "id": 1, "name": "Cardiology" },
      "topic": { "id": 5, "name": "ECG" },
      "QuestionOptions": [
        { "id": 101, "option_key": "A", "option_text": "Myocardial Infarction" },
        { "id": 102, "option_key": "B", "option_text": "Pericarditis" },
        { "id": 103, "option_key": "C", "option_text": "Aortic Dissection" },
        { "id": 104, "option_key": "D", "option_text": "Pulmonary Embolism" }
      ]
    }
  ],
  "pagination": { "total": 86, "page": 1, "limit": 20, "pages": 5 }
}
```
> `is_correct` is NOT in options here — never sent to students during practice/tests.

---

### Get single question — student view
```
GET /questions/:id
```
**Auth:** None  
**Response 200:** Same shape as above (single object, no `is_correct` in options)

---

### List questions — admin view (with correct answers)
```
GET /questions/admin
```
**Auth:** Admin  
**Query params:** Same as student + `is_active=true|false`  
**Response 200:** Same paginated shape but `QuestionOptions` includes `"is_correct": true/false`

---

### Get single question — admin view
```
GET /questions/admin/:id
```
**Auth:** Admin  
**Response 200:**
```json
{
  "id": 42,
  "question_text": "...",
  "explanation": "The correct answer is B because...",
  "difficulty": "hard",
  "question_type": "single_choice",
  "source_type": "previous_year",
  "source_year": 2023,
  "marks": 1,
  "negative_marks": 0.25,
  "is_active": true,
  "import_batch_id": 3,
  "subject": { "id": 1, "name": "Cardiology" },
  "topic": { "id": 5, "name": "ECG" },
  "QuestionOptions": [
    { "id": 101, "option_key": "A", "option_text": "MI", "is_correct": false },
    { "id": 102, "option_key": "B", "option_text": "Pericarditis", "is_correct": true },
    { "id": 103, "option_key": "C", "option_text": "Dissection", "is_correct": false },
    { "id": 104, "option_key": "D", "option_text": "PE", "is_correct": false }
  ]
}
```

---

### Create question (admin)
```
POST /questions/admin
```
**Auth:** Admin  
**Body:**
```json
{
  "subject_id": 1,
  "topic_id": 5,
  "question_text": "Which valve is most affected in rheumatic fever?",
  "explanation": "Mitral valve is most commonly affected...",
  "difficulty": "medium",
  "question_type": "single_choice",
  "source_type": "qbank",
  "source_year": null,
  "marks": 1,
  "negative_marks": 0.25,
  "options": [
    { "option_key": "A", "option_text": "Aortic valve",   "is_correct": false },
    { "option_key": "B", "option_text": "Mitral valve",   "is_correct": true  },
    { "option_key": "C", "option_text": "Tricuspid valve","is_correct": false },
    { "option_key": "D", "option_text": "Pulmonary valve","is_correct": false }
  ]
}
```
**Response 201:** Question object

> **Rules:** `options` array is required. For `single_choice`, exactly one option must have `is_correct: true`.

---

### Update question (admin)
```
PUT /questions/admin/:id
```
**Auth:** Admin  
**Body:** Same as create (all fields optional). If `options` array is included, all existing options are **replaced**.

---

### Delete question (admin)
```
DELETE /questions/admin/:id
```
**Auth:** Admin  
**Response 200:** `{ "message": "Question deleted" }`

---

### Toggle question active/inactive (admin)
```
PATCH /questions/admin/:id/toggle
```
**Auth:** Admin  
**Body:** None  
**Response 200:** `{ "id": 42, "is_active": false }`

---

## IMPORT BATCHES (admin only)

> Flow: Create → Python processes → Python POSTs to /receive → Admin previews → Admin approves

### List all batches
```
GET /admin/import-batches
```
**Auth:** Admin  
**Response 200:** Array of batch objects (import_logs excluded for performance)
```json
[
  {
    "id": 7,
    "title": "Recall 2024 - Batch 1",
    "questions_pdf": "/uploads/q.pdf",
    "answers_pdf": "/uploads/a.pdf",
    "status": "completed",
    "total_questions": 50,
    "imported_questions": 48,
    "failed_questions": 2,
    "createdAt": "2026-05-18T10:00:00Z"
  }
]
```

---

### Get single batch (with parsed questions preview)
```
GET /admin/import-batches/:id
```
**Auth:** Admin  
**Response 200:** Full batch object including `import_logs`
```json
{
  "id": 7,
  "title": "Recall 2024 - Batch 1",
  "status": "completed",
  "total_questions": 50,
  "import_logs": {
    "questions": [
      {
        "question_text": "Which of the following...",
        "explanation": "...",
        "subject_id": 1,
        "topic_id": 3,
        "difficulty": "medium",
        "source_type": "recall",
        "source_year": 2024,
        "options": [
          { "option_key": "A", "option_text": "...", "is_correct": false },
          { "option_key": "B", "option_text": "...", "is_correct": true }
        ]
      }
    ],
    "logs": ["Page 3: ambiguous answer skipped"]
  }
}
```

---

### Create batch (admin triggers Python)
```
POST /admin/import-batches
```
**Auth:** Admin  
**Body:**
```json
{
  "title": "Recall 2024 - Batch 1",
  "questions_pdf": "/uploads/questions.pdf",
  "answers_pdf": "/uploads/answers.pdf"
}
```
**Response 201:**
```json
{
  "batch_id": 7,
  "message": "Batch created and sent to processing"
}
```
> If `PYTHON_SERVICE_URL` env var is set on the server, Python is notified automatically. Otherwise pass the `batch_id` to Python manually.

---

### Receive parsed data (Python calls this, not admin UI)
```
POST /admin/import-batches/:id/receive
```
**Auth:** Admin  
**Body:** (sent by Python service)
```json
{
  "status": "completed",
  "total_questions": 50,
  "failed_questions": 2,
  "questions": [
    {
      "question_text": "...",
      "explanation": "...",
      "subject_id": 1,
      "topic_id": 3,
      "difficulty": "medium",
      "question_type": "single_choice",
      "source_type": "recall",
      "source_year": 2024,
      "marks": 1,
      "negative_marks": 0,
      "options": [
        { "option_key": "A", "option_text": "...", "is_correct": false },
        { "option_key": "B", "option_text": "...", "is_correct": true }
      ]
    }
  ],
  "logs": ["Skipped page 5 - ambiguous"]
}
```
**Response 200:** `{ "message": "Parsed data received", "batch_id": 7 }`

---

### Approve batch → saves questions to DB
```
POST /admin/import-batches/:id/approve
```
**Auth:** Admin  
**Body:** None  
**Response 200:**
```json
{ "message": "Batch approved", "imported": 48, "failed": 2 }
```
> Only works if batch `status === "completed"`. Reads `import_logs.questions` and creates them in the questions table.

---

### Rollback batch (delete batch + all its questions)
```
DELETE /admin/import-batches/:id
```
**Auth:** Admin  
**Response 200:** `{ "message": "Batch and all its questions have been rolled back" }`

---

## MOCK TESTS — ADMIN

### List all mock tests
```
GET /admin/mock-tests
```
**Auth:** Admin  
**Response 200:** Array of mock test objects (no questions included)
```json
[
  {
    "id": 3,
    "title": "Grand Mock — May 2026",
    "test_type": "dynamic",
    "duration_minutes": 180,
    "total_questions": 50,
    "total_marks": 50,
    "is_published": true,
    "randomize_questions": false,
    "randomize_options": false,
    "configuration_json": {
      "subjects": [
        { "subject_id": 1, "count": 20 },
        { "subject_id": 2, "count": 30 }
      ],
      "difficulty": { "easy": 30, "medium": 50, "hard": 20 }
    },
    "starts_at": null,
    "ends_at": null,
    "createdAt": "2026-05-18T10:00:00Z"
  }
]
```

---

### Get single mock test (with questions for fixed type)
```
GET /admin/mock-tests/:id
```
**Auth:** Admin  
**Response 200:**
```json
{
  "id": 3,
  "title": "Fixed Test — Anatomy",
  "test_type": "fixed",
  "is_published": false,
  "questions": [
    {
      "id": 1,
      "mock_test_id": 3,
      "question_id": 42,
      "question_order": 1,
      "question": {
        "id": 42,
        "question_text": "...",
        "QuestionOptions": [...]
      }
    }
  ]
}
```
> `questions` array only present for `test_type === "fixed"`. For dynamic tests, use `configuration_json`.

---

### Create mock test
```
POST /admin/mock-tests
```
**Auth:** Admin

**Body for fixed test:**
```json
{
  "title": "Anatomy Fixed Mock",
  "description": "Covers basic anatomy",
  "test_type": "fixed",
  "duration_minutes": 60,
  "total_marks": 100,
  "randomize_questions": true,
  "randomize_options": false,
  "starts_at": null,
  "ends_at": null
}
```

**Body for dynamic test:**
```json
{
  "title": "Grand Mock — May 2026",
  "test_type": "dynamic",
  "duration_minutes": 180,
  "total_marks": 50,
  "randomize_options": false,
  "configuration_json": {
    "subjects": [
      { "subject_id": 1, "count": 20 },
      { "subject_id": 2, "count": 15 },
      { "subject_id": 3, "count": 15 }
    ],
    "difficulty": { "easy": 30, "medium": 50, "hard": 20 }
  }
}
```
> `total_questions` is auto-calculated from `configuration_json.subjects` for dynamic tests.  
> `difficulty` percentages should add up to 100.

**Response 201:** Created mock test object

---

### Update mock test
```
PUT /admin/mock-tests/:id
```
**Auth:** Admin  
**Body:** Same as create (all optional, `test_type` cannot change)

---

### Delete mock test
```
DELETE /admin/mock-tests/:id
```
**Auth:** Admin  
**Response 200:** `{ "message": "Deleted successfully" }`

---

### Toggle publish
```
PATCH /admin/mock-tests/:id/publish
```
**Auth:** Admin  
**Body:** None  
**Response 200:** `{ "is_published": true }`

---

### Add questions to fixed test
```
POST /admin/mock-tests/:id/questions
```
**Auth:** Admin  
**Body:**
```json
{
  "questions": [
    { "question_id": 10, "question_order": 1 },
    { "question_id": 25, "question_order": 2 },
    { "question_id": 31, "question_order": 3 }
  ]
}
```
**Response 201:** `{ "message": "Questions added", "count": 3 }`

---

### Remove question from fixed test
```
DELETE /admin/mock-tests/:id/questions/:questionId
```
**Auth:** Admin  
**Response 200:** `{ "message": "Question removed" }`

---

## MOCK TESTS — STUDENT

### List published tests
```
GET /mock-tests
```
**Auth:** None  
**Response 200:** Array of published mock test objects (no `configuration_json`)

---

### Get test info
```
GET /mock-tests/:id
```
**Auth:** None  
**Response 200:** Single mock test object (published only)

---

### Start attempt
```
POST /mock-tests/:id/start
```
**Auth:** User  
**Body:** None  
**Response 201:**
```json
{ "attempt_id": 55, "total_questions": 50 }
```
> Creates an attempt and generates the question snapshot. For dynamic tests, random questions are picked from the DB at this point and frozen for this attempt. Returns 400 if the user already has an `in_progress` attempt for this test.

---

## ATTEMPTS

### Get attempt (load questions for active test)
```
GET /attempts/:id
```
**Auth:** User (must be the attempt owner)  
**Response 200:**
```json
{
  "id": 55,
  "status": "in_progress",
  "score": 0,
  "total_correct": 0,
  "started_at": "2026-05-19T10:00:00Z",
  "mock_test_id": 3,
  "attempt_questions": [
    {
      "id": 1,
      "question_order": 1,
      "question_id": 42,
      "question": {
        "id": 42,
        "question_text": "Which valve is most affected...",
        "difficulty": "medium",
        "marks": 1,
        "negative_marks": 0.25,
        "subject": { "id": 1, "name": "Cardiology" },
        "QuestionOptions": [
          { "id": 101, "option_key": "A", "option_text": "Aortic valve" },
          { "id": 102, "option_key": "B", "option_text": "Mitral valve" },
          { "id": 103, "option_key": "C", "option_text": "Tricuspid valve" },
          { "id": 104, "option_key": "D", "option_text": "Pulmonary valve" }
        ]
      }
    }
  ],
  "answers": [
    { "question_id": 42, "selected_option_id": 102, "answered_at": "2026-05-19T10:05:00Z" }
  ]
}
```
> **While `in_progress`:** `is_correct` is stripped from all options — never visible.  
> **After `completed`:** `is_correct` is visible in the result endpoint, not here.

---

### Save / update a single answer
```
POST /attempts/:id/answer
```
**Auth:** User  
**Body:**
```json
{
  "question_id": 42,
  "selected_option_id": 102
}
```
**Response 200:** `{ "message": "Answer saved" }` or `{ "message": "Answer updated" }`  
> Call this every time the student selects or changes an option. Safe to call multiple times for the same question.

---

### Submit attempt (finalize and score)
```
POST /attempts/:id/submit
```
**Auth:** User  
**Body:** None  
**Response 200:**
```json
{
  "message": "Test submitted",
  "score": 37.75,
  "total_correct": 40,
  "total_wrong": 7,
  "total_unanswered": 3
}
```
> Evaluates all answers, applies marks/negative marks, marks attempt as `completed`. Only works on `in_progress` attempts.

---

### Get result (after submission)
```
GET /attempts/:id/result
```
**Auth:** User  
**Response 200:**
```json
{
  "id": 55,
  "status": "completed",
  "score": 37.75,
  "total_correct": 40,
  "total_wrong": 7,
  "total_unanswered": 3,
  "time_taken_seconds": 5820,
  "completed_at": "2026-05-19T11:37:00Z",
  "attempt_questions": [
    {
      "question_order": 1,
      "question_id": 42,
      "question": {
        "id": 42,
        "question_text": "Which valve is most affected...",
        "explanation": "Mitral valve is most commonly affected in rheumatic fever due to...",
        "QuestionOptions": [
          { "id": 101, "option_key": "A", "option_text": "Aortic valve",   "is_correct": false },
          { "id": 102, "option_key": "B", "option_text": "Mitral valve",   "is_correct": true  },
          { "id": 103, "option_key": "C", "option_text": "Tricuspid valve","is_correct": false },
          { "id": 104, "option_key": "D", "option_text": "Pulmonary valve","is_correct": false }
        ]
      },
      "user_answer": {
        "selected_option_id": 102,
        "is_correct": true,
        "answered_at": "2026-05-19T10:05:00Z",
        "selected_option": { "option_key": "B", "option_text": "Mitral valve" }
      }
    }
  ]
}
```
> `user_answer` is `null` if the question was not answered. Only available when `status === "completed"`.

---

## BOOKMARKS

### List user bookmarks
```
GET /bookmarks
```
**Auth:** User  
**Query params:** `page=1` `limit=20`  
**Response 200:** Paginated list of bookmarks with full question and options (no `is_correct`)
```json
{
  "data": [
    {
      "id": 12,
      "question_id": 42,
      "createdAt": "2026-05-18T09:00:00Z",
      "question": {
        "id": 42,
        "question_text": "...",
        "subject": { "id": 1, "name": "Cardiology" },
        "QuestionOptions": [...]
      }
    }
  ],
  "pagination": { "total": 5, "page": 1, "limit": 20, "pages": 1 }
}
```

---

### Add bookmark
```
POST /bookmarks
```
**Auth:** User  
**Body:**
```json
{ "question_id": 42 }
```
**Response:** `201` if newly bookmarked, `200` if already bookmarked  
```json
{ "message": "Bookmarked", "id": 12 }
```

---

### Remove bookmark
```
DELETE /bookmarks/:questionId
```
**Auth:** User  
> `:questionId` is the question's ID, NOT the bookmark record's ID.  
**Response 200:** `{ "message": "Bookmark removed" }`

---

## ANALYTICS (student's own data only)

### Overall summary
```
GET /analytics/summary
```
**Auth:** User  
**Response 200:**
```json
{
  "total_attempts": "12",
  "total_correct": "380",
  "total_wrong": "110",
  "total_unanswered": "10",
  "avg_score": "31.50",
  "avg_accuracy": "77.55"
}
```
> All values come as strings from SQL aggregation — parse to numbers on the frontend.

---

### Performance by subject
```
GET /analytics/subjects
```
**Auth:** User  
**Response 200:** Array ordered by weakest subject first
```json
[
  {
    "subject_id": 3,
    "subject_name": "Biochemistry",
    "total_answered": "50",
    "total_correct": "30",
    "total_wrong": "20",
    "accuracy_percent": "60.00"
  },
  {
    "subject_id": 1,
    "subject_name": "Anatomy",
    "total_answered": "80",
    "total_correct": "65",
    "total_wrong": "15",
    "accuracy_percent": "81.25"
  }
]
```

---

### Weak topics
```
GET /analytics/weak-topics
```
**Auth:** User  
**Response 200:** Top 10 weakest topics (min 5 questions attempted), ordered by accuracy ascending
```json
[
  {
    "topic_id": 8,
    "topic_name": "Krebs Cycle",
    "subject_name": "Biochemistry",
    "total_answered": "12",
    "total_correct": "5",
    "accuracy_percent": "41.67"
  }
]
```

---

### Mock test history
```
GET /analytics/history
```
**Auth:** User  
**Query params:** `page=1` `limit=10`  
**Response 200:**
```json
{
  "data": [
    {
      "id": 55,
      "status": "completed",
      "score": 37.75,
      "total_correct": 40,
      "total_wrong": 7,
      "total_unanswered": 3,
      "time_taken_seconds": 5820,
      "started_at": "2026-05-19T10:00:00Z",
      "completed_at": "2026-05-19T11:37:00Z",
      "mock_test": {
        "id": 3,
        "title": "Grand Mock — May 2026",
        "duration_minutes": 180,
        "total_questions": 50
      }
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 10, "pages": 2 }
}
```

---

## COURSES

### List all courses
```
GET /courses
```
**Auth:** None  
**Response 200:** Array of courses with nested pricing, features, benefits
```json
[
  {
    "id": 1,
    "name": "AMC Cat Prep",
    "description": "...",
    "CoursePricings": [
      { "id": 1, "label": "Monthly", "price": 29.99, "duration_days": 30, "is_popular": true }
    ],
    "Features": [{ "id": 1, "name": "Unlimited QBank" }],
    "Benefits": [{ "id": 1, "description": "Full mock tests" }]
  }
]
```

---

### Get single course
```
GET /courses/:id
```
**Auth:** None  
**Response 200:** Same shape as above (single object)

---

### Subscribe to course
```
POST /courses/subscribe
```
**Auth:** User  
**Body:**
```json
{ "course_id": 1 }
```
**Response 201:** Subscription object

---

### Get my courses
```
GET /courses/my-courses
```
**Auth:** User  
**Response 200:** Array of subscriptions with course info

---

### Create course (admin)
```
POST /courses
```
**Auth:** Admin  
**Body:**
```json
{
  "name": "AMC Cat Prep",
  "description": "Complete AMC preparation",
  "pricing": [
    { "label": "Monthly", "price": 29.99, "duration_days": 30, "is_popular": false },
    { "label": "Yearly",  "price": 199.99, "duration_days": 365, "is_popular": true }
  ],
  "features": ["Unlimited QBank", "10,000+ Questions", "Mock Tests"],
  "benefits": ["24/7 Access", "Detailed Analytics"]
}
```

---

### Update course (admin)
```
PUT /courses/:id
```
**Auth:** Admin  
**Body:** Same as create

---

### Delete course (admin)
```
DELETE /courses/:id
```
**Auth:** Admin  
**Response 200:** `{ "message": "Course deleted" }`

---

## Common Frontend Patterns

### Debounced search
```js
// Wait 400ms after user stops typing before calling API
useEffect(() => {
  const t = setTimeout(() => fetchQuestions(), 400);
  return () => clearTimeout(t);
}, [searchTerm]);
```

### Cascading dropdowns (Subject → Topic)
```js
// Reset topic when subject changes
const handleSubjectChange = (subjectId) => {
  setSubjectId(subjectId);
  setTopicId(null); // reset topic
  fetchTopics(subjectId);
};
```

### Building configuration_json for dynamic tests
```js
const configuration_json = {
  subjects: subjectRows
    .filter(r => r.subject_id && r.count > 0)
    .map(r => ({ subject_id: r.subject_id, count: r.count })),
  ...(difficultyEnabled && {
    difficulty: { easy: easyPct, medium: mediumPct, hard: hardPct }
  })
};
```

### Pagination query
```js
const fetchQuestions = (page = 1) => {
  api.get('/questions/admin', {
    params: { subject_id, topic_id, difficulty, search, page, limit: 20 }
  });
};
```

### Handle 401 globally (axios interceptor)
```js
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
```
