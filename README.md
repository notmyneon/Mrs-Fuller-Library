# Classroom Library MVP

A first working prototype for a classroom library circulation system.

## What works now

- Rapid ISBN scanning / entry
- Open Library ISBN metadata lookup with Google Books fallback
- Duplicate ISBN detection
- Manual book entry fallback
- Searchable library catalogue
- Student roster
- Bulk-paste a class list
- Automatically generated student IDs
- Printable Code 128 student library cards
- Student-card + book-barcode checkout
- Book-only return workflow
- 14-day due dates
- Current loans and overdue counts
- Loan history
- JSON backup export/import
- Responsive layout

## Run it

The easiest option is to place these files in a GitHub Pages repository.

You can also open `index.html` directly in a browser, but browser security rules may sometimes restrict remote API calls when a page is opened as `file://`. If that happens, serve the folder through any simple local web server.

## Important first-version limitation

Data is currently saved in **localStorage in the browser**. That makes this prototype easy to test without accounts or setup, but it is not yet the permanent architecture.

Do not rely on one browser/device as the only copy. Use **Export backup** regularly while testing.

The next build should replace localStorage with a protected hosted database (for example Supabase/PostgreSQL) so the same library is available from multiple devices and student data is access-controlled.

## Barcode notes

### Books
The app expects the existing ISBN barcode on the book. It accepts ISBN-10 and ISBN-13.

### Students
Student cards use generated IDs such as `STU-0001`. The barcode contains only that ID, not the student's name.

## Book metadata lookup

The app now uses **Open Library first** for ISBN metadata and cover information.

If an ISBN is not found there, it falls back to **Google Books**. This avoids making the normal rapid-scanning workflow dependent on Google's unauthenticated browser quota, which can return HTTP 429 (Too Many Requests).

No API keys are required for this prototype.

## Recommended next build

1. Supabase authentication and database
2. Teacher-only login
3. Dedicated student kiosk screen
4. Book editing: shelf, genres/tags, reading level, display/storage
5. Holds and student wish lists
6. Inventory mode
7. Reports and circulation analytics
8. PWA / installable Chromebook-tablet experience
