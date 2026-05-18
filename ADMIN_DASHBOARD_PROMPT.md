# Admin Dashboard — Build Prompt for AMC Catalyst

Copy everything below this line and paste it into Claude (or any AI) to build the admin dashboard.

---

## PROMPT START

Build a complete **Admin Dashboard** for **AMC Catalyst** — a medical exam preparation platform (similar to UWorld/AMBOSS). The dashboard is exclusively for admins to manage questions, mock tests, import batches, subjects, and courses.

AMC Catalyst Admin
─────────────────
📊  Dashboard (Overview)
📚  Subjects & Topics
❓  Questions
📥  Import Batches
📝  Mock Tests
📖  Courses
─────────────────
👤  [Admin Name]
🚪  Logout
```

- Active link highlighted
- Collapsible on mobile
- Show admin name from decoded JWT or localStorage

---

## Pages — Build Each One

---

### 1. Dashboard Overview `/dashboard`

**Purpose**: High-level stats at a glance.

**Layout**: Stats cards row + two charts below.

**Stats Cards** (fetch in parallel):
- Total Questions → `GET /api/questions/admin?limit=1` → use `pagination.total`
- Total Mock Tests → `GET /api/admin/mock-tests` → `array.length`
- Total Import Batches → `GET /api/admin/import-batches` → `array.length`
- Total Subjects → `GET /api/subjects` → `array.length`

**Charts**:
- Bar chart: Questions by difficulty (easy/medium/hard) — fetch with `GET /api/questions/admin?difficulty=easy&limit=1` for each and compare totals
- Pie chart: Questions by source_type (qbank / recall / mock / previous_year)

**Recent Activity**:
- Last 5 import batches (status badge: processing/completed/failed)
- Last 5 mock tests (published/draft badge)

---

### 2. Subjects & Topics `/dashboard/subjects`

**Purpose**: Manage the subject and topic hierarchy.

**Layout**: Two panels side by side.

#### Left Panel — Subjects Table
Columns: Name | Slug | Active | Topics Count | Actions

Actions per row:
- **Edit** → inline edit name/description, toggle is_active
- **Delete** → confirm dialog

**Add Subject** button (top right) → slide-over or modal:
```
Fields: Name, Description
POST /api/subjects
```
On name input change, auto-preview the slug (toLowerCase, replace spaces with `-`).

#### Right Panel — Topics (shown when a subject is clicked)
Show topics for the selected subject.

Columns: Name | Slug | Active | Actions

**Add Topic** button → modal:
```
Fields: Name, Description
subject_id is auto-filled from selected subject
POST /api/subjects/topics/create
```

API calls:
- `GET /api/subjects` — load subjects with topics
- `GET /api/subjects/:id/topics` — load topics when subject selected
- `POST /api/subjects` — create subject
- `PUT /api/subjects/:id` — update subject
- `DELETE /api/subjects/:id` — delete (show warning: questions using this subject will break)
- `POST /api/subjects/topics/create` — create topic
- `PUT /api/subjects/topics/:id` — update topic
- `DELETE /api/subjects/topics/:id` — delete topic

---

### 3. Questions `/dashboard/questions`

**Purpose**: Browse, search, create, edit, and toggle questions.

#### Filter Bar (top)
Dropdowns + search input in a row:
- Subject (dropdown, from `GET /api/subjects`)
- Topic (dropdown, populated after subject is selected)
- Difficulty: All / Easy / Medium / Hard
- Source Type: All / QBank / Recall / Mock / Previous Year
- Active: All / Active / Inactive
- Search input (debounced 400ms)

#### Questions Table
Columns: # | Question (truncated 80 chars) | Subject | Topic | Difficulty | Source | Active | Actions

Actions per row:
- **Edit** → opens edit modal
- **Toggle** → `PATCH /api/questions/admin/:id/toggle` → flip the Active badge instantly
- **Delete** → confirm dialog → `DELETE /api/questions/admin/:id`

Pagination: Show page controls below table. Use `pagination` from API response.

**Create Question** button → full-page modal or slide-over with:
```
Fields:
- Subject (required, dropdown)
- Topic (dropdown, loads after subject selected)
- Question Text (textarea, required)
- Explanation (textarea)
- Difficulty (Easy / Medium / Hard)
- Question Type (Single Choice / Multiple Choice / True False / Image Based)
- Source Type (QBank / Recall / Mock / Previous Year)
- Source Year (number, optional)
- Marks (default 1)
- Negative Marks (default 0)
- Options (dynamic list):
  - Add/remove options
  - Each option: Key (A/B/C/D), Text, Is Correct (radio for single_choice)
  - Minimum 2 options required
  - Exactly one is_correct = true for single_choice
```

API calls:
- `GET /api/questions/admin` with query params for filters and pagination
- `GET /api/questions/admin/:id` — load for edit modal
- `POST /api/questions/admin` — create
- `PUT /api/questions/admin/:id` — update
- `DELETE /api/questions/admin/:id` — delete
- `PATCH /api/questions/admin/:id/toggle` — enable/disable

---

### 4. Import Batches `/dashboard/import-batches`

**Purpose**: Manage the Python PDF import pipeline.

**This is a multi-step workflow page — design it clearly.**

#### Batch List Table
Columns: Title | Questions PDF | Status | Total Q | Imported | Failed | Created At | Actions

Status badge colors:
- `processing` → yellow spinner badge
- `completed` → green badge
- `failed` → red badge

Actions:
- **Preview** → opens Preview Panel (see below)
- **Approve** → only if status = completed → confirm dialog → `POST /api/admin/import-batches/:id/approve`
- **Rollback/Delete** → red button, confirm dialog with warning text: "This will permanently delete all questions imported from this batch"

**New Import** button → modal:
```
Fields:
- Title (e.g., "Recall 2024 - Batch 1")
- Questions PDF path/URL
- Answers PDF path/URL

POST /api/admin/import-batches
```
After creating, show the returned `batch_id` with a note: "Share this batch_id with the Python service."

#### Preview Panel (slide-over, full height)
Opens when admin clicks Preview on a completed batch.

Shows:
- Batch metadata (title, stats)
- Scrollable list of parsed questions from `import_logs.questions`
- Each question shows: question text, options (with correct answer highlighted in green), subject, difficulty
- Warning count for any `failed_questions`
- **Approve** button at the bottom

API calls:
- `GET /api/admin/import-batches` — list
- `POST /api/admin/import-batches` — create
- `GET /api/admin/import-batches/:id` — load preview
- `POST /api/admin/import-batches/:id/approve` — approve
- `DELETE /api/admin/import-batches/:id` — rollback

---

### 5. Mock Tests `/dashboard/mock-tests`

**Purpose**: Create and manage fixed and dynamic mock tests.

#### Mock Test List Table
Columns: Title | Type | Questions | Duration | Published | Created At | Actions

Type badge: `fixed` (blue) / `dynamic` (purple)
Published badge: `Published` (green) / `Draft` (gray)

Actions:
- **View/Edit** → opens detail page
- **Publish Toggle** → `PATCH /api/admin/mock-tests/:id/publish`
- **Delete** → confirm

**Create Test** button → modal with two tabs:

**Tab 1 — Fixed Test**
```
Fields:
- Title (required)
- Description
- Duration (minutes)
- Total Marks
- Randomize Questions (toggle) — shuffles order per attempt
- Randomize Options (toggle)
- Starts At (datetime, optional)
- Ends At (datetime, optional)
test_type = "fixed" (sent automatically)
```

**Tab 2 — Dynamic Test**
```
Fields:
- Title (required)
- Description
- Duration (minutes)
- Total Marks
- Randomize Options (toggle)
- Subject Configuration (dynamic rows):
  Each row: Subject dropdown + Count number input
  Add/remove rows
- Difficulty Distribution (optional):
  Easy % + Medium % + Hard % (must total 100)
  Show a small pie chart preview as user types
test_type = "dynamic" (sent automatically)
configuration_json is built from the subject rows + difficulty
```

#### Mock Test Detail Page `/dashboard/mock-tests/:id`

Two sections:

**Top section — Test Info Card**
Shows: Title, Type, Duration, Published status, Total Questions
Edit button → opens same create modal pre-filled

**Bottom section — Questions (only for fixed tests)**

For `fixed` type:
- Searchable question picker
- Left: search questions from `GET /api/questions/admin` with filters
- Right: list of added questions (ordered, with drag-to-reorder or manual order number)
- Add question → `POST /api/admin/mock-tests/:id/questions` with `[{ question_id, question_order }]`
- Remove question → `DELETE /api/admin/mock-tests/:id/questions/:questionId`
- Show total question count

For `dynamic` type:
- Show `configuration_json` in a readable card format:
  - Table of subjects with counts
  - Difficulty breakdown as a small pie chart
- "Edit Configuration" button → re-opens the create modal

API calls:
- `GET /api/admin/mock-tests` — list
- `POST /api/admin/mock-tests` — create
- `GET /api/admin/mock-tests/:id` — detail
- `PUT /api/admin/mock-tests/:id` — update
- `DELETE /api/admin/mock-tests/:id` — delete
- `PATCH /api/admin/mock-tests/:id/publish` — toggle publish
- `POST /api/admin/mock-tests/:id/questions` — add questions (fixed)
- `DELETE /api/admin/mock-tests/:id/questions/:qId` — remove question

---

### 6. Courses `/dashboard/courses`

**Purpose**: Manage course listings shown on the pricing page.

#### Course List
Cards layout (not table) — each card shows:
- Course name
- Price tiers
- Feature count
- Edit / Delete buttons

**Create Course** button → modal with nested sections:
```
Basic Info:
- Name (required)
- Description
- Is Active toggle

Pricing Tiers (dynamic rows):
- Each row: Label (e.g., "Monthly"), Price, Duration Days, Is Popular toggle
- Add/remove rows

Features (dynamic rows):
- Each row: Feature text
- Add/remove rows

Benefits (dynamic rows):
- Each row: Benefit text
- Add/remove rows
```

API calls:
- `GET /api/courses` — list
- `POST /api/courses` — create
- `PUT /api/courses/:id` — update
- `DELETE /api/courses/:id` — delete

---


---

## Important Notes for the AI Building This

1. **Never show `is_correct`** on any student-facing UI. On admin question view, it is okay to show which option is correct (highlighted in green).

2. **Import Pipeline order matters**: Create Batch → (Python processes) → Receive (automatic) → Admin Previews → Admin Approves. The UI should make this flow visually clear with a step indicator on each batch card.

3. **Dynamic test `configuration_json`** must be built client-side from the form fields before sending to the API:
```js
configuration_json: {
  subjects: subjectRows.map(r => ({ subject_id: r.subject_id, count: r.count })),
  difficulty: { easy: easyPct, medium: mediumPct, hard: hardPct } // only if filled
}
```

4. **Slug preview**: When admin types a subject or topic name, show a live preview of the slug that will be generated (`name.toLowerCase().replace(/\s+/g, '-')`).

5. **Question option validation**: For `single_choice`, enforce exactly one `is_correct = true` using radio buttons, not checkboxes. For `multiple_choice`, use checkboxes.

6. **Publish toggle** should be instant (optimistic UI) — update the badge immediately, then call the API and revert on error.

7. **The sidebar** should show the count of draft (unpublished) mock tests as a red badge to prompt the admin to publish them.

---

## PROMPT END
