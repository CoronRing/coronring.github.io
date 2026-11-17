-- The NewsRing subscriber list.
--
-- This is the first table in the `coronring` project, and the project is the
-- site's rather than any one piece of it: one database for whatever this site
-- comes to keep, with each table named for the project that owns it. Hence
-- `newsring_subscribers` in `public` and not a schema or a database called
-- `newsring`. The next project adds its own tables here beside this one.
--
-- Why this table is not on the host it serves
-- -------------------------------------------
-- Everything else in that deployment is a container rebuilt from git on every
-- deploy. This is the exception: a confirmed address exists nowhere else, and
-- you do not get to ask people to subscribe twice. The host is a free-tier box
-- that its provider can reclaim without notice, disks included, which is not a
-- theory — it has happened to this deployment.

create table if not exists public.newsring_subscribers (
    -- The local part keeps its case and the domain is lower-cased before it
    -- arrives, so plain text compares correctly and `citext` buys nothing.
    email          text primary key,
    created_at     timestamptz not null default now(),

    -- The date of the last digest this reader was sent, or null for someone
    -- who has not had one. This is what makes a re-run of the daily send
    -- harmless: the broadcast asks for everyone whose last date is not
    -- today's, so a workflow dispatched twice mails nobody twice.
    last_sent_date date,

    source         text not null default 'site'
);

comment on table public.newsring_subscribers is
    'Confirmed readers of the NewsRing daily digest. Written only by the '
    'subscriptions service using the service-role key. An unsubscribe deletes '
    'the row rather than flagging it.';

-- No secondary indexes. The list is capped in the tens by the mailbox behind
-- it, so the primary key is the only one that earns its keep; an index here
-- would be decoration.

-- Locked by default, and left with no policies on purpose. Row-level security
-- with zero policies denies every anon and authenticated caller outright,
-- while the service-role key the backend holds bypasses it. So the publishable
-- key that ships in a browser bundle cannot read this table even if it leaks,
-- and there is no policy to get subtly wrong.
alter table public.newsring_subscribers enable row level security;
