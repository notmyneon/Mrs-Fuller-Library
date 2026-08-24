-- Future hosted database schema (not required for the local MVP)
-- Designed for PostgreSQL / Supabase.

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  isbn text unique not null,
  google_volume_id text,
  title text not null,
  subtitle text,
  authors jsonb not null default '[]'::jsonb,
  publisher text,
  published_date text,
  description text,
  page_count integer,
  categories jsonb not null default '[]'::jsonb,
  image_url text,
  shelf text,
  location_status text not null default 'classroom',
  date_added timestamptz not null default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  card_code text unique not null,
  display_name text not null,
  active boolean not null default true,
  school_year text,
  date_added timestamptz not null default now()
);

create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id),
  student_id uuid not null references students(id),
  checkout_date date not null default current_date,
  due_date date not null,
  return_date date
);

-- Prevent two active loans for the same book.
create unique index if not exists one_open_loan_per_book
on loans(book_id)
where return_date is null;
