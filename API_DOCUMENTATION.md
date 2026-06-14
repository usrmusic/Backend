# USRMusic Backend — API Documentation

**Base URL:** `/api`  
**Auth:** JWT access token via `Authorization: Bearer <token>` header. Refresh token stored in httpOnly cookie.

---

## Authentication & Tokens

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/user/auth` | Sign in with email/password. Returns JWT access token + refresh token cookie. |
| POST | `/user/refresh` | Issue a new access token using the refresh token cookie. |
| POST | `/user/signout` | Invalidate the current refresh token (sign out). |
| POST | `/user/forgot` | Request a password-reset email with a one-time token. |
| POST | `/user/:id/reset-password` | Reset a user's password (admin). |
| POST | `/user/verify` | Verify a user's email address using the emailed token. |
| POST | `/user/verify/request` | Resend the email-verification token to the authenticated user. |

---

## Users (`/api/user`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/user/` | Return the authenticated user's own profile, or paginated list of all users (with filters). |
| POST | `/user/` | Create a new user account. Accepts optional profile photo upload. Auto-generates a password and can trigger a welcome email. |
| GET | `/user/:id` | Fetch a single user by ID. |
| PUT | `/user/:id` | Update a user profile. Owners can edit their own; admins can edit any. Accepts profile photo upload. |
| DELETE | `/user/:id` | Delete a user by ID (admin). |
| POST | `/user/delete-many` | Delete multiple users in one request (admin). |
| GET | `/user/get-dropdown` | Return a minimal id/name list of users for dropdown menus. |
| GET | `/user/roles` | Return the list of all available roles. |

---

## Clients (`/api/client`)

Clients are users with a specific "client" role, representing event customers.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/client/` | Paginated list of clients with search and filtering. |
| POST | `/client/` | Create a new client. Accepts profile photo. Can simultaneously create associated events. |
| GET | `/client/:id` | Fetch a single client's details. |
| PUT | `/client/:id` | Update client profile and photo. |
| DELETE | `/client/:id` | Delete a single client. |
| POST | `/client/delete-many` | Delete multiple clients at once. |
| GET | `/client/get-dropdown` | Return minimal client list for dropdowns. |

---

## Venues (`/api/venue`)

Event locations/venues with optional attachments (PDF floor plans, images, etc.).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/venue/` | Paginated list of venues with search and filtering. |
| POST | `/venue/` | Create a venue. Accepts an attachment file (PDF or image). |
| GET | `/venue/:id` | Fetch a single venue's details. |
| PUT | `/venue/:id` | Update venue info and attachment. |
| DELETE | `/venue/:id` | Delete a single venue. |
| POST | `/venue/delete-many` | Delete multiple venues at once. |
| GET | `/venue/get-dropdown` | Return minimal venue list for dropdowns. |

---

## Suppliers (`/api/supplier`)

External suppliers/vendors used for equipment or services.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/supplier/` | Paginated list of suppliers with search and filtering. |
| POST | `/supplier/` | Create a new supplier record. |
| GET | `/supplier/:id` | Fetch a single supplier's details. |
| PUT | `/supplier/:id` | Update supplier info. |
| DELETE | `/supplier/:id` | Delete a single supplier. |
| POST | `/supplier/delete-many/:ids` | Delete multiple suppliers by comma-separated IDs. |
| GET | `/supplier/get-dropdown` | Return minimal supplier list for dropdowns. |

---

## Equipment (`/api/equipment`)

Gear/equipment inventory linked to suppliers.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/equipment/` | Paginated list of equipment with search and filtering. |
| POST | `/equipment/` | Create new equipment. Can create a new supplier inline if one doesn't exist yet. |
| GET | `/equipment/:id` | Fetch a single equipment item. |
| PUT | `/equipment/:id` | Update equipment details. |
| DELETE | `/equipment/:id` | Delete a single equipment item. |
| DELETE | `/equipment/delete-many/:ids` | Delete multiple equipment items by comma-separated IDs. |
| GET | `/equipment/get-dropdown` | Return minimal equipment list for dropdowns. |

---

## Packages (`/api/package`)

Service/pricing packages that can be attached to events.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/package/` | Paginated list of packages with search and filtering. |
| POST | `/package/` | Create a new package for a user. |
| GET | `/package/:id` | Fetch a single package's details. |
| PUT | `/package/:id` | Update a package. |
| DELETE | `/package/:id` | Delete a single package. |
| POST | `/package/delete-many` | Delete multiple packages at once. |
| GET | `/package/get-dropdown` | Return minimal package list for dropdowns. |

---

## Companies (`/api/company`)

Business/company profiles used for branding, invoices, and contracts.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/company/` | Paginated list of companies with search and filtering. |
| POST | `/company/` | Create a company. Accepts company logo, brochure PDF, and admin signature image, all stored in S3. |
| GET | `/company/:id` | Fetch company details. Returns a signed S3 URL for the admin signature image. |
| PUT | `/company/:id` | Update company info and associated file uploads. |
| DELETE | `/company/:id` | Delete a single company. |
| POST | `/company/delete-many` | Delete multiple companies at once. |
| GET | `/company/get-dropdown` | Return minimal company list for dropdowns. |

---

## Roles & Permissions (`/api/roles-permissions`)

RBAC management — create roles, define permissions, and assign them.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/roles-permissions/manage-access` | Return the full list of roles and permissions combined. |
| POST | `/roles-permissions/roles` | Create a new role. |
| PUT | `/roles-permissions/roles/:id` | Update an existing role's name/details. |
| DELETE | `/roles-permissions/roles/:id` | Delete a role. |
| GET | `/roles-permissions/roles/:id/permissions` | Get all permissions assigned to a specific role. |
| POST | `/roles-permissions/permissions` | Create a new permission. |
| PUT | `/roles-permissions/permissions/:id` | Update a permission's name/details. |
| DELETE | `/roles-permissions/permissions/:id` | Delete a permission. |
| POST | `/roles-permissions/assign` | Assign a set of permissions to a role (replaces the role's current permissions). |

---

## Email Content (`/api/email-content`)

Manage reusable email template bodies (e.g., quote emails, invoice emails).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/email-content/` | Paginated list of email content templates with search. |
| GET | `/email-content/:id` | Fetch a single email template's content. |
| POST | `/email-content/:id` | Update the body of an email template. |

---

## Enquiries (`/api/enquiry`)

An enquiry is a pre-confirmed event — a lead or booking request being processed.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/enquiry/` | Paginated list of open enquiries with filtering by date range, status, client, venue. |
| POST | `/enquiry/` | Create a new enquiry. Accepts client, venue, and package details. Creates a new client or venue on the fly if they don't exist yet. |
| GET | `/enquiry/:id` | Fetch full enquiry details including related client, venue, and packages. |
| PUT | `/enquiry/:id` | Update enquiry information and related records. |
| DELETE | `/enquiry/:id` | Delete a single enquiry. |
| DELETE | `/enquiry/delete-many/:ids` | Delete multiple enquiries by comma-separated IDs. |
| GET | `/enquiry/staff-equipment` | List available equipment for staff/package assignment. |
| GET | `/enquiry/get-email` | Get the client email associated with an enquiry. |
| POST | `/enquiry/brochure` | Generate and email the company brochure PDF to the enquiry's client. |
| POST | `/enquiry/email-update` | Send an update email to the client about their enquiry status. |
| POST | `/enquiry/quote` | Generate a quote PDF and email it to the client. |
| POST | `/enquiry/add-note/:id` | Add an internal staff note to an enquiry. |

---

## Confirmed Events (`/api/confirm-event`)

Events that have been confirmed (booked). Covers invoicing, payments, and cancellations.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/confirm-event/` | Paginated list of confirmed events pending invoicing. |
| GET | `/confirm-event/completed` | Paginated list of fully completed/settled events. |
| POST | `/confirm-event/:id` | Confirm an enquiry — converts it to a confirmed event, creates an invoice and initial payment record. |
| GET | `/confirm-event/:id` | Fetch full confirmed event details. Respects per-user scope (clients see only their own). |
| PUT | `/confirm-event/:id` | Update a confirmed event's details. |
| POST | `/confirm-event/send-invoice` | Generate an invoice PDF and email it to the client. |
| POST | `/confirm-event/download-invoice/:id` | Download the invoice for an event as a PDF file. |
| POST | `/confirm-event/payment` | Record a payment transaction against an event. |
| POST | `/confirm-event/refund` | Record a refund payment against an event. |
| POST | `/confirm-event/cancel` | Cancel a confirmed event and update its status. |
| POST | `/confirm-event/email/:id` | Send an event-confirmation email to the client. |

---

## Todos (`/api/todos`)

Task checklists attached to events, assignable to staff members.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/todos/mine` | Return all todos currently assigned to the authenticated user across all events. |
| GET | `/todos/:id` | List all todos for a specific event. |
| POST | `/todos/:id` | Create a new todo on an event (admin only). |
| PUT | `/todos/:eventId/:todoId` | Update a todo's text or assignee (admin only). |
| DELETE | `/todos/:eventId/:todoId` | Delete a todo from an event (admin only). |
| PATCH | `/todos/:eventId/:todoId/complete` | Toggle a todo's completion status. Assignee or admin only. |

---

## File Uploads (`/api/files`)

General file storage and media/downloads management backed by S3.

### Uploaded Files

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/files/uploads` | Paginated list of the user's uploaded files. |
| POST | `/files/uploads` | Upload a file to S3. Creates a `FileUpload` database record. |
| GET | `/files/uploads/:id` | Fetch file metadata (name, description, S3 key, etc.). |
| PUT | `/files/uploads/:id` | Update a file's name or description. |
| DELETE | `/files/uploads/:id` | Delete a file from S3 and remove its database record. |
| GET | `/files/uploads/:id/download` | Stream a file directly from S3 to the client. |

### Media / Downloads

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/files/media` | List media/downloadable files available in the system. |
| POST | `/files/media` | Upload a media file to S3 (supports `media` and `file` form fields). |
| GET | `/files/media/:id/` | Stream a media file from S3 to the client. |
| DELETE | `/files/media/:id/` | Delete a media file from S3 and remove its record. |

---

## Calendar (`/api/calendar`)

Read-only view of confirmed events formatted for calendar display.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/calendar/` | Return all confirmed events for a given year (defaults to current year), formatted for a calendar UI. |

---

## Rig List (`/api/rig-list`)

Pre-event logistics — van assignments, crew, and equipment notes for upcoming confirmed events.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/rig-list/drop-down` | Return upcoming confirmed events (today or later) as a dropdown list. |
| GET | `/rig-list/:id` | Fetch an event with its packages and any saved rig list notes. |
| POST | `/rig-list/:id` | Save rig list data for an event (notes, van assignment, crew details). |

---

## Reports (`/api/reports`)

Aggregated reporting views for admins and suppliers.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/reports/suppliers` | Supplier report — paginated list of events filtered by supplier, with optional date range. |
| GET | `/reports/admin` | Admin dashboard report — event statistics, revenue totals, and other KPIs for a selected period. |

---

## Dashboard (`/api/dashboard`)

High-level stats and quick-access data for the main dashboard.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/dashboard/` | Return summary statistics: total events, revenue, pending payments, and other counters. |
| GET | `/dashboard/upcoming-events` | Return the next upcoming confirmed events. |
| GET | `/dashboard/drop-down` | Search/filter events for a dropdown widget. Respects user scope (clients see only their events). |
| POST | `/dashboard/recalculate-profits` | Trigger a background job to recalculate profit figures for all events (super-admin only). |

---

## Contracts (`/api/contract`)

Digital contract signing — admins generate a public link; clients sign via a token-protected page without needing to log in.

### Admin Endpoints (require authentication + `confirm event` permission)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/contract/event/:id/token` | Generate (or return existing) a unique signing token for an event's contract. |
| POST | `/contract/event/:id/send` | Email the public contract-signing URL to the client. |
| GET | `/contract/event/:id/list` | List all signed contracts and signatures associated with an event. |
| GET | `/contract/admin/:id/download` | Download a signed contract PDF from S3. |
| DELETE | `/contract/admin/:id` | Delete a contract record. |

### Public Endpoints (token-based, no login required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/contract/:token` | Load the contract signing page — returns event details and the contract form for a given token. |
| POST | `/contract/:token/sign` | Submit the signed contract. Accepts a signature image, generates a signed PDF, stores it in S3, and sends confirmation emails to the client and admin. |

---

## Cross-Cutting Concerns

### Authorization
- All protected routes require `Authorization: Bearer <token>`.
- Role-based permissions are checked via `checkPermission("<permission name>")` middleware.
- The special permission `manage_all` grants super-admin access and bypasses all other checks.
- Permission checks are cached for 60 seconds to reduce database load.

### Pagination
Most list endpoints accept `page` and `limit` query parameters and return `{ data, total, page, limit }`.

### File Storage
Files are stored in AWS S3. Sensitive files (signatures, contracts) are accessed via short-lived signed URLs.

### Background Jobs
- **Complete Events Job** — automatically marks events as completed on a schedule.
- **Recalculate Profits Job** — recomputes profit figures for all events (triggerable via dashboard).
